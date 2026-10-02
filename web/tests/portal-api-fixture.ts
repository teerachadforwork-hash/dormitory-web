import { randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { createServer } from 'node:net'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { hash } from 'bcryptjs'
import { Pool } from 'pg'

export type PortalFixture = {
  baseUrl: string
  password: string
  tenantA: { username: string; customerId: string; invoiceId: string }
  tenantB: { username: string; customerId: string; invoiceId: string }
  login: (username: string) => Promise<string>
  cleanup: () => Promise<void>
}

async function availablePort() {
  const server = createServer()
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve())
  })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Unable to reserve an API test port')
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  return address.port
}

export async function createPortalFixture(): Promise<PortalFixture> {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required for portal API integration tests')
  if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
    throw new Error('JWT_SECRET must contain at least 32 characters for portal API integration tests')
  }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL })
  const suffix = randomUUID().replaceAll('-', '').slice(0, 18)
  const password = `Portal-test-${randomUUID()}`
  const passwordHash = await hash(password, 4)
  const storagePath = await mkdtemp(path.join(os.tmpdir(), 'rental-portal-evidence-'))
  const port = await availablePort()
  const baseUrl = `http://127.0.0.1:${port}`
  const server = spawn(process.execPath, [path.resolve('node_modules/tsx/dist/cli.mjs'), 'server/index.ts'], {
    cwd: process.cwd(),
    env: { ...process.env, API_PORT: String(port), ATTACHMENT_STORAGE_PATH: storagePath, NODE_ENV: 'test' },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let serverOutput = ''
  server.stdout?.on('data', (chunk: Buffer) => { serverOutput = `${serverOutput}${chunk.toString()}`.slice(-8000) })
  server.stderr?.on('data', (chunk: Buffer) => { serverOutput = `${serverOutput}${chunk.toString()}`.slice(-8000) })
  let tenantA: PortalFixture['tenantA'] | undefined
  let tenantB: PortalFixture['tenantB'] | undefined
  let roleId: string | undefined
  const setupClient = await pool.connect()

  try {
    await setupClient.query('BEGIN')
    await setupClient.query(
      `INSERT INTO permissions(code,description) VALUES ('tenant.portal','Portal test permission')
       ON CONFLICT (code) DO NOTHING`,
    )
    const role = await setupClient.query<{ id: string }>(
      'INSERT INTO roles(code,name) VALUES ($1,$2) RETURNING id',
      [`portal_${suffix}`, `Portal test ${suffix}`],
    )
    roleId = role.rows[0].id
    await setupClient.query(
      `INSERT INTO role_permissions(role_id,permission_id)
       SELECT $1,id FROM permissions WHERE code='tenant.portal'`,
      [roleId],
    )

    const createTenant = async (letter: 'a' | 'b') => {
      const customer = await setupClient.query<{ id: string }>(
        'INSERT INTO customers(code,full_name) VALUES ($1,$2) RETURNING id',
        [`PT-${suffix}-${letter}`, `Portal Test ${letter.toUpperCase()} ${suffix}`],
      )
      const user = await setupClient.query<{ id: string }>(
        `INSERT INTO users(username,password_hash,display_name,customer_id)
         VALUES ($1,$2,$3,$4) RETURNING id`,
        [`portal_${suffix}_${letter}`, passwordHash, `Portal Test ${letter.toUpperCase()}`, customer.rows[0].id],
      )
      await setupClient.query('INSERT INTO user_roles(user_id,role_id) VALUES ($1,$2)', [user.rows[0].id, roleId])
      const invoice = await setupClient.query<{ id: string }>(
        `INSERT INTO invoices
         (document_no,issued_at,due_date,status,subtotal,tax_total,total,created_by,customer_id,invoice_kind,document_snapshot)
         VALUES ($1,CURRENT_DATE,CURRENT_DATE+7,'issued',100,0,100,$2,$3,'one_off',$4::jsonb)
         RETURNING id`,
        [`PTI-${suffix}-${letter}`, user.rows[0].id, customer.rows[0].id,
          JSON.stringify({ customer: { name: `Portal Test ${letter.toUpperCase()}` }, lines: [] })],
      )
      return { username: `portal_${suffix}_${letter}`, customerId: customer.rows[0].id, invoiceId: invoice.rows[0].id }
    }

    tenantA = await createTenant('a')
    tenantB = await createTenant('b')
    await setupClient.query('COMMIT')
  } catch (error) {
    await setupClient.query('ROLLBACK')
    await pool.end()
    await rm(storagePath, { recursive: true, force: true })
    server.kill()
    throw error
  } finally {
    setupClient.release()
  }

  const login = async (username: string) => {
    const response = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    })
    if (!response.ok) throw new Error(`Test tenant login failed (${response.status}): ${await response.text()}`)
    const cookie = response.headers.get('set-cookie')?.split(';', 1)[0]
    if (!cookie) throw new Error('Login response did not include a session cookie')
    return cookie
  }

  try {
    let ready = false
    for (let attempt = 0; attempt < 80; attempt += 1) {
      if (server.exitCode !== null) break
      try {
        const response = await fetch(`${baseUrl}/api/health`)
        if (response.ok) {
          ready = true
          break
        }
      } catch {
        await delay(250)
      }
    }
    if (!ready) throw new Error(`Test API did not become ready.\n${serverOutput}`)
  } catch (error) {
    server.kill()
    await once(server, 'exit')
    const cleanup = await pool.connect()
    try {
      await cleanup.query('BEGIN')
      await cleanup.query('DELETE FROM attachments WHERE entity_type=$1 AND entity_id=ANY($2::bigint[])', [
        'invoice', [tenantA.invoiceId, tenantB.invoiceId],
      ])
      await cleanup.query('DELETE FROM invoices WHERE id=ANY($1::bigint[])', [[tenantA.invoiceId, tenantB.invoiceId]])
      await cleanup.query('DELETE FROM user_roles WHERE role_id=$1', [roleId])
      await cleanup.query('DELETE FROM role_permissions WHERE role_id=$1', [roleId])
      await cleanup.query('DELETE FROM roles WHERE id=$1', [roleId])
      await cleanup.query('DELETE FROM users WHERE username LIKE $1', [`portal_${suffix}_%`])
      await cleanup.query('DELETE FROM customers WHERE id=ANY($1::bigint[])', [[tenantA.customerId, tenantB.customerId]])
      await cleanup.query('COMMIT')
    } catch (cleanupError) {
      await cleanup.query('ROLLBACK')
      console.error('Unable to clean up failed portal test fixture', cleanupError)
    } finally {
      cleanup.release()
      await pool.end()
      await rm(storagePath, { recursive: true, force: true })
    }
    throw error
  }

  return {
    baseUrl,
    password,
    tenantA,
    tenantB,
    login,
    cleanup: async () => {
      if (server.exitCode === null) {
        const exitServer = once(server, 'exit')
        server.kill()
        await Promise.race([exitServer, delay(5000)])
      }
      const client = await pool.connect()
      try {
        await client.query('BEGIN')
        await client.query('DELETE FROM attachments WHERE entity_type=$1 AND entity_id=ANY($2::bigint[])', [
          'invoice', [tenantA.invoiceId, tenantB.invoiceId],
        ])
        await client.query('DELETE FROM invoices WHERE id=ANY($1::bigint[])', [[tenantA.invoiceId, tenantB.invoiceId]])
        await client.query('DELETE FROM user_roles WHERE role_id=$1', [roleId])
        await client.query('DELETE FROM role_permissions WHERE role_id=$1', [roleId])
        await client.query('DELETE FROM roles WHERE id=$1', [roleId])
        await client.query('DELETE FROM users WHERE username LIKE $1', [`portal_${suffix}_%`])
        await client.query('DELETE FROM customers WHERE id=ANY($1::bigint[])', [[tenantA.customerId, tenantB.customerId]])
        await client.query('COMMIT')
      } catch (error) {
        await client.query('ROLLBACK')
        throw error
      } finally {
        client.release()
        await pool.end()
        await rm(storagePath, { recursive: true, force: true })
      }
    },
  }
}

export async function uploadPdf(baseUrl: string, cookie: string, invoiceId: string, bytes = Buffer.from('%PDF-1.7\nportal test')) {
  const form = new FormData()
  form.append('file', new Blob([new Uint8Array(bytes)], { type: 'application/pdf' }), '../../receipt.pdf')
  return fetch(`${baseUrl}/api/portal/invoices/${invoiceId}/evidence`, {
    method: 'POST',
    headers: { Cookie: cookie },
    body: form,
  })
}
