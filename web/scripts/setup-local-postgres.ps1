$ErrorActionPreference = 'Stop'

$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$envFile = Join-Path $projectRoot '.env'
if (Test-Path -LiteralPath $envFile) {
  throw "A .env file already exists at $envFile. Back it up and remove it only if you intend to replace its credentials."
}

$postgresRoot = 'C:\Program Files\PostgreSQL'
$psqlCommand = Get-Command psql.exe -ErrorAction SilentlyContinue
if ($psqlCommand) {
  $psqlPath = $psqlCommand.Source
} else {
  $psqlPath = Get-ChildItem -Path $postgresRoot -Filter psql.exe -File -Recurse -ErrorAction SilentlyContinue |
    Sort-Object FullName -Descending |
    Select-Object -First 1 -ExpandProperty FullName
}
if (-not $psqlPath) {
  throw 'Could not find psql.exe. Install PostgreSQL and ensure its bin folder is available.'
}

$healthTool = Join-Path (Split-Path $psqlPath) 'pg_isready.exe'
if (Test-Path -LiteralPath $healthTool) {
  & $healthTool -h 127.0.0.1 -p 5432
  if ($LASTEXITCODE -ne 0) {
    throw 'PostgreSQL is not accepting connections on 127.0.0.1:5432. Start the PostgreSQL service and retry.'
  }
}

$adminUsername = $env:RENTAL_POSTGRES_ADMIN_USERNAME
if ($adminUsername) {
  Remove-Item Env:RENTAL_POSTGRES_ADMIN_USERNAME
  $adminUsername = $adminUsername.Trim()
} else {
  $adminUsername = (Read-Host 'PostgreSQL administrator username [postgres]').Trim()
}
if (-not $adminUsername) { $adminUsername = 'postgres' }
if ($adminUsername -notmatch '^[A-Za-z_][A-Za-z0-9_]*$') {
  throw 'Use a PostgreSQL username containing only ASCII letters, digits, and underscores.'
}

$adminPassword = $env:RENTAL_POSTGRES_ADMIN_PASSWORD
if ($adminPassword) {
  Remove-Item Env:RENTAL_POSTGRES_ADMIN_PASSWORD
} else {
  $securePassword = Read-Host "Password for PostgreSQL user '$adminUsername' (entered locally; not saved)" -AsSecureString
  $passwordPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePassword)
  try {
    $adminPassword = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($passwordPointer)
  } finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($passwordPointer)
  }
}
if (-not $adminPassword) { throw 'The PostgreSQL password cannot be empty.' }

function New-RandomHex([int] $byteCount) {
  $bytes = New-Object byte[] $byteCount
  $random = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  try {
    $random.GetBytes($bytes)
    return ([BitConverter]::ToString($bytes)).Replace('-', '').ToLowerInvariant()
  } finally {
    $random.Dispose()
  }
}

function Invoke-PostgresSql([string] $database, [string] $sql, [switch] $Scalar) {
  $startInfo = New-Object System.Diagnostics.ProcessStartInfo
  $startInfo.FileName = $psqlPath
  $startInfo.Arguments = "-X -w -h 127.0.0.1 -p 5432 -U $adminUsername -d $database -v ON_ERROR_STOP=1"
  if ($Scalar) { $startInfo.Arguments += ' -A -t -q' }
  $startInfo.UseShellExecute = $false
  $startInfo.CreateNoWindow = $true
  $startInfo.RedirectStandardInput = $true
  $startInfo.RedirectStandardOutput = $true
  $startInfo.RedirectStandardError = $true
  $process = New-Object System.Diagnostics.Process
  $process.StartInfo = $startInfo
  $process.Start() | Out-Null
  $stdoutTask = $process.StandardOutput.ReadToEndAsync()
  $stderrTask = $process.StandardError.ReadToEndAsync()
  $process.StandardInput.WriteLine($sql)
  $process.StandardInput.Close()
  $process.WaitForExit()
  $stdout = $stdoutTask.Result.Trim()
  $stderr = $stderrTask.Result.Trim()
  $exitCode = $process.ExitCode
  $process.Dispose()
  if ($exitCode -ne 0) {
    throw "PostgreSQL command failed (exit $exitCode): $stderr"
  }
  if ($stderr) { Write-Warning $stderr }
  return $stdout
}

$previousPassword = $env:PGPASSWORD
$previousDirectory = Get-Location
$appPassword = New-RandomHex 32
$jwtSecret = New-RandomHex 48
$adminLogin = "rentaladmin_$(New-RandomHex 6)"
$bootstrapPassword = New-RandomHex 24
$env:PGPASSWORD = $adminPassword
try {
  Invoke-PostgresSql 'postgres' 'SELECT current_user;' -Scalar | Out-Null

  $roleSql = @"
DO `$setup`$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'rental_app') THEN
    ALTER ROLE rental_app WITH LOGIN PASSWORD '$appPassword';
  ELSE
    CREATE ROLE rental_app WITH LOGIN PASSWORD '$appPassword';
  END IF;
END
`$setup`$;
"@
  Invoke-PostgresSql 'postgres' $roleSql | Out-Null

  $databaseExists = Invoke-PostgresSql 'postgres' "SELECT CASE WHEN EXISTS (SELECT 1 FROM pg_database WHERE datname='rental_web') THEN 'yes' ELSE 'no' END;" -Scalar
  if ($databaseExists -eq 'no') {
    Invoke-PostgresSql 'postgres' 'CREATE DATABASE rental_web OWNER rental_app;' | Out-Null
  }
  Invoke-PostgresSql 'postgres' 'GRANT CONNECT, CREATE ON DATABASE rental_web TO rental_app;' | Out-Null

  $schemaState = Invoke-PostgresSql 'rental_web' "SELECT CASE WHEN to_regclass('public.company_settings') IS NULL THEN 'missing' ELSE 'present' END;" -Scalar
  $tableCount = Invoke-PostgresSql 'rental_web' "SELECT count(*)::text FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE';" -Scalar
  if ($schemaState -eq 'present' -and $tableCount -ne '50') {
    throw "Found company_settings but expected 50 public tables; found $tableCount. Leaving the existing schema untouched for manual review."
  }
  if ($schemaState -eq 'missing' -and $tableCount -ne '0') {
    throw "Found $tableCount public tables without company_settings. Leaving this partial/existing schema untouched for manual review."
  }

  if ($schemaState -eq 'missing') {
    Invoke-PostgresSql 'rental_web' 'GRANT USAGE, CREATE ON SCHEMA public TO rental_app;' | Out-Null
  } else {
    Invoke-PostgresSql 'rental_web' 'GRANT USAGE, CREATE ON SCHEMA public TO rental_app; GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO rental_app; GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO rental_app;' | Out-Null
  }

  $databaseUrl = "postgresql://rental_app:$appPassword@127.0.0.1:5432/rental_web"
  $envContent = @(
    "DATABASE_URL=$databaseUrl"
    "JWT_SECRET=$jwtSecret"
    'API_PORT=3000'
    'NODE_ENV=development'
    ''
  ) -join "`n"
  $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($envFile, $envContent, $utf8NoBom)

  Push-Location $projectRoot
  try {
    if ($schemaState -eq 'missing') {
      Write-Host 'Installing the PostgreSQL schema...'
      & npm.cmd run db:setup
      if ($LASTEXITCODE -ne 0) { throw "Schema setup failed (exit $LASTEXITCODE)." }
    } else {
      Write-Host 'The database schema is already installed; skipping schema setup.'
    }

    $env:BOOTSTRAP_ADMIN_USERNAME = $adminLogin
    $env:BOOTSTRAP_ADMIN_PASSWORD = $bootstrapPassword
    $env:BOOTSTRAP_ADMIN_DISPLAY_NAME = 'ผู้ดูแลระบบ'
    & npm.cmd run admin:create
    if ($LASTEXITCODE -ne 0) { throw "Administrator account setup failed (exit $LASTEXITCODE)." }
  } finally {
    Remove-Item Env:BOOTSTRAP_ADMIN_USERNAME, Env:BOOTSTRAP_ADMIN_PASSWORD, Env:BOOTSTRAP_ADMIN_DISPLAY_NAME -ErrorAction SilentlyContinue
    Pop-Location
  }

  Write-Host ''
  Write-Host 'Local database setup succeeded.'
  Write-Host "Database: rental_web (PostgreSQL at 127.0.0.1:5432)"
  Write-Host "Administrator username: $adminLogin"
  Write-Host "Administrator password: $bootstrapPassword"
  Write-Host 'Save the administrator password now; it is not written to a file.'
  Write-Host 'Start the app with: npm run dev'
} finally {
  $env:PGPASSWORD = $previousPassword
  Set-Location $previousDirectory
  $adminPassword = $null
  $appPassword = $null
  $jwtSecret = $null
  $bootstrapPassword = $null
}
