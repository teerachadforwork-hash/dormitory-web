import 'dotenv/config'
import { hash } from 'bcryptjs'
import { pool } from '../server/db.js'

const username = process.env.BOOTSTRAP_ADMIN_USERNAME?.trim()
const password = process.env.BOOTSTRAP_ADMIN_PASSWORD
const displayName = process.env.BOOTSTRAP_ADMIN_DISPLAY_NAME?.trim() || 'ผู้ดูแลระบบ'

if (!username || !password || password.length < 12) {
  console.error('Set BOOTSTRAP_ADMIN_USERNAME and BOOTSTRAP_ADMIN_PASSWORD (at least 12 characters) before running npm run admin:create.')
  process.exitCode = 1
} else {
  const permissions = [
    'properties.read', 'properties.create', 'properties.update',
    'rooms.read', 'rooms.create', 'rooms.update',
    'customers.read', 'customers.create',
    'bookings.read', 'bookings.create', 'bookings.update',
    'contracts.read', 'contracts.create', 'contracts.update',
    'maintenance.read', 'maintenance.create', 'maintenance.update',
    'complaints.read', 'complaints.create', 'complaints.update',
    'settings.manage',
    'billing.read', 'billing.create', 'billing.issue',
    'invoices.read', 'invoices.issue',
    'payments.read', 'payments.create', 'payments.confirm',
    'funds.read', 'funds.create', 'funds.confirm',
    'expenses.read', 'expenses.create', 'expenses.post',
    'reports.read', 'reports.export',
    'audit.read', 'users.manage', 'tenant.portal',
  ]
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const roleResult = await client.query(
      `INSERT INTO roles (code, name) VALUES ('admin', 'ผู้ดูแลระบบ')
       ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name RETURNING id`,
    )
    const roleId = roleResult.rows[0].id
    const existingUser = await client.query<{ id: string }>('SELECT id FROM users WHERE username = $1', [username])
    if (existingUser.rowCount) {
      const adminRole = await client.query(
        'SELECT 1 FROM user_roles WHERE user_id=$1 AND role_id=$2',
        [existingUser.rows[0].id, roleId],
      )
      if (!adminRole.rowCount) {
        throw new Error('This username already exists without the administrator role; no credentials or roles were changed.')
      }
    }

    for (const permissionCode of permissions) {
      const permissionResult = await client.query(
        `INSERT INTO permissions (code, description) VALUES ($1, $2)
         ON CONFLICT (code) DO UPDATE SET description = EXCLUDED.description RETURNING id`,
        [permissionCode, permissionCode],
      )
      if (permissionCode === 'tenant.portal') continue
      await client.query(
        'INSERT INTO role_permissions (role_id, permission_id) VALUES ($1,$2) ON CONFLICT (role_id,permission_id) DO NOTHING',
        [roleId, permissionResult.rows[0].id],
      )
    }

    if (!existingUser.rowCount) {
      const passwordHash = await hash(password, 12)
      const userResult = await client.query(
        'INSERT INTO users (username, password_hash, display_name) VALUES ($1,$2,$3) RETURNING id',
        [username, passwordHash, displayName],
      )
      await client.query('INSERT INTO user_roles (user_id, role_id) VALUES ($1,$2)', [userResult.rows[0].id, roleId])
    }
    await client.query('COMMIT')
    console.info(existingUser.rowCount
      ? `Administrator permissions synchronized for "${username}"; credentials were not changed.`
      : `Administrator "${username}" created successfully.`)
  } catch (error) {
    await client.query('ROLLBACK')
    console.error('Admin creation failed.', error)
    process.exitCode = 1
  } finally {
    client.release()
  }
}

await pool.end()
