import 'dotenv/config'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { pool } from '../server/db.js'

const schemaPath = fileURLToPath(new URL('../../Rental_Database_PostgreSQL.sql', import.meta.url))

try {
  const schema = await readFile(schemaPath, 'utf8')
  await pool.query(schema)
  console.info('PostgreSQL schema installed successfully.')
} catch (error) {
  console.error('Database setup failed. Verify DATABASE_URL and ensure PostgreSQL is running.', error)
  process.exitCode = 1
} finally {
  await pool.end()
}
