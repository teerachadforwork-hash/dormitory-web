import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { after, before, describe, it } from 'node:test'
import { PGlite } from '@electric-sql/pglite'

const database = new PGlite()
const schemaPath = fileURLToPath(new URL('../../Rental_Database_PostgreSQL.sql', import.meta.url))

describe('PostgreSQL baseline schema', () => {
  before(async () => {
    await database.exec(await readFile(schemaPath, 'utf8'))
  })

  after(async () => {
    await database.close()
  })

  it('creates all documented entities', async () => {
    const result = await database.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM information_schema.tables
       WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`,
    )
    assert.equal(result.rows[0].count, '50')
  })

  it('enforces unique room codes within a floor but permits them on another floor', async () => {
    const property = await database.query<{ id: string }>(
      "INSERT INTO properties (code, name) VALUES ('P1','Property') RETURNING id",
    )
    const building = await database.query<{ id: string }>(
      "INSERT INTO buildings (property_id, code, name) VALUES ($1,'A','Building') RETURNING id",
      [property.rows[0].id],
    )
    const firstFloor = await database.query<{ id: string }>(
      "INSERT INTO floors (building_id, code) VALUES ($1,'1') RETURNING id",
      [building.rows[0].id],
    )
    const secondFloor = await database.query<{ id: string }>(
      "INSERT INTO floors (building_id, code) VALUES ($1,'2') RETURNING id",
      [building.rows[0].id],
    )
    const roomType = await database.query<{ id: string }>(
      "INSERT INTO room_types (code, name, default_rent, capacity) VALUES ('STD','Standard',3700,2) RETURNING id",
    )
    const firstRoomValues = [firstFloor.rows[0].id, roomType.rows[0].id]
    await database.query(
      "INSERT INTO rooms (floor_id, room_type_id, code, base_rent) VALUES ($1,$2,'101',3700)",
      firstRoomValues,
    )
    await assert.rejects(
      database.query("INSERT INTO rooms (floor_id, room_type_id, code, base_rent) VALUES ($1,$2,'101',3700)", firstRoomValues),
    )
    await database.query(
      "INSERT INTO rooms (floor_id, room_type_id, code, base_rent) VALUES ($1,$2,'101',3700)",
      [secondFloor.rows[0].id, roomType.rows[0].id],
    )
  })

  it('rejects operational room statuses that belong to derived tenancy state', async () => {
    await assert.rejects(
      database.query(
        "INSERT INTO rooms (floor_id, room_type_id, code, operational_status, base_rent) VALUES (1,1,'bad','occupied',3700)",
      ),
    )
  })

  it('links portal accounts to an existing customer record', async () => {
    const customer = await database.query<{ id: string }>(
      "INSERT INTO customers (code,full_name) VALUES ('PORTAL-TEST','Portal Test') RETURNING id",
    )
    const user = await database.query<{ customer_id: string }>(
      "INSERT INTO users (username,password_hash,display_name,customer_id) VALUES ('portal-test','hash','Portal Test',$1) RETURNING customer_id",
      [customer.rows[0].id],
    )
    assert.equal(user.rows[0].customer_id, customer.rows[0].id)
    await assert.rejects(
      database.query(
        "INSERT INTO users (username,password_hash,display_name,customer_id) VALUES ('portal-invalid-test','hash','Portal Invalid',999999)",
      ),
    )
  })

  it('preserves room and resident history at a next-day room move boundary', async () => {
    const property = await database.query<{ id: string }>(
      "INSERT INTO properties (code,name) VALUES ('MOVE-TEST','Move test') RETURNING id",
    )
    const building = await database.query<{ id: string }>(
      "INSERT INTO buildings (property_id,code,name) VALUES ($1,'MOVE','Move test') RETURNING id",
      [property.rows[0].id],
    )
    const floor = await database.query<{ id: string }>(
      "INSERT INTO floors (building_id,code) VALUES ($1,'1') RETURNING id",
      [building.rows[0].id],
    )
    const roomType = await database.query<{ id: string }>(
      "INSERT INTO room_types (code,name,default_rent,capacity) VALUES ('MOVE-TEST','Move test',1000,2) RETURNING id",
    )
    const rooms = await database.query<{ id: string }>(
      `INSERT INTO rooms (floor_id,room_type_id,code,base_rent)
       VALUES ($1,$2,'MOVE-OLD',1000),($1,$2,'MOVE-NEW',1200) RETURNING id`,
      [floor.rows[0].id, roomType.rows[0].id],
    )
    const customer = await database.query<{ id: string }>(
      "INSERT INTO customers (code,full_name) VALUES ('MOVE-TEST','Move Test') RETURNING id",
    )
    const user = await database.query<{ id: string }>(
      "INSERT INTO users (username,password_hash,display_name) VALUES ('move-test','hash','Move Test') RETURNING id",
    )
    const contract = await database.query<{ id: string }>(
      `INSERT INTO contracts
       (customer_id,created_by,document_no,start_date,end_date,rental_cycle,rent_amount,billing_day,status)
       VALUES ($1,$2,'CON-MOVE-TEST','2026-10-01','2026-10-31','monthly',1000,25,'active') RETURNING id`,
      [customer.rows[0].id, user.rows[0].id],
    )
    await database.query(
      `INSERT INTO contract_room_assignments (contract_id,room_id,start_date,end_date,rent_snapshot)
       VALUES ($1,$2,'2026-10-01','2026-10-31',1000)`,
      [contract.rows[0].id, rooms.rows[0].id],
    )
    await database.query(
      `INSERT INTO contract_residents (contract_id,customer_id,move_in)
       VALUES ($1,$2,'2026-10-01')`,
      [contract.rows[0].id, customer.rows[0].id],
    )
    const resident = await database.query<{ customer_id: string }>(
      `SELECT customer_id FROM contract_residents
       WHERE contract_id=$1 AND move_in<$2::date AND (move_out IS NULL OR move_out>=$2::date)`,
      [contract.rows[0].id, '2026-10-15'],
    )
    await database.query(
      `UPDATE contract_room_assignments SET end_date=$1::date-1
       WHERE contract_id=$2`,
      ['2026-10-15', contract.rows[0].id],
    )
    await database.query(
      `INSERT INTO contract_room_assignments (contract_id,room_id,start_date,end_date,rent_snapshot)
       VALUES ($1,$2,$3,'2026-10-31',1200)`,
      [contract.rows[0].id, rooms.rows[1].id, '2026-10-15'],
    )
    await database.query(
      `UPDATE contract_residents SET move_out=$1::date-1
       WHERE contract_id=$2 AND move_out IS NULL AND move_in<$3::date`,
      ['2026-10-15', contract.rows[0].id, '2026-10-15'],
    )
    for (const currentResident of resident.rows) {
      await database.query(
        `INSERT INTO contract_residents (contract_id,customer_id,move_in)
         VALUES ($1,$2,$3) ON CONFLICT (contract_id,customer_id,move_in) DO NOTHING`,
        [contract.rows[0].id, currentResident.customer_id, '2026-10-15'],
      )
    }
    const assignments = await database.query<{ room_id: string; start_date: string; end_date: string }>(
      `SELECT room_id,start_date::text AS start_date,end_date::text AS end_date FROM contract_room_assignments
       WHERE contract_id=$1 ORDER BY start_date`,
      [contract.rows[0].id],
    )
    assert.equal(assignments.rows.length, 2)
    assert.equal(assignments.rows[0].end_date, '2026-10-14')
    assert.equal(assignments.rows[1].start_date, '2026-10-15')
    const residentHistory = await database.query<{ move_in: string; move_out: string | null }>(
      'SELECT move_in::text AS move_in,move_out::text AS move_out FROM contract_residents WHERE contract_id=$1 ORDER BY move_in',
      [contract.rows[0].id],
    )
    assert.deepEqual(residentHistory.rows, [
      { move_in: '2026-10-01', move_out: '2026-10-14' },
      { move_in: '2026-10-15', move_out: null },
    ])
  })

  it('supports draft expenses and enforces one original journal per expense', async () => {
    const user = await database.query<{ id: string }>(
      "INSERT INTO users (username,password_hash,display_name) VALUES ('expense-test','hash','Expense Test') RETURNING id",
    )
    const bankAccountGl = await database.query<{ id: string }>(
      "INSERT INTO accounts (code,name,account_type) VALUES ('BANK-EXP-TEST','Expense test bank','asset') RETURNING id",
    )
    const bankAccount = await database.query<{ id: string }>(
      "INSERT INTO bank_accounts (account_id,code,name,kind) VALUES ($1,'BANK-EXP-TEST','Expense test bank','bank') RETURNING id",
      [bankAccountGl.rows[0].id],
    )
    const expense = await database.query<{ id: string }>(
      `INSERT INTO expenses (bank_account_id,created_by,document_no,expense_date,payment_method,total,payment_category)
       VALUES ($1,$2,'EXP-TEST-1','2026-10-02','transfer',107,'repair') RETURNING id`,
      [bankAccount.rows[0].id, user.rows[0].id],
    )
    const expenseAccount = await database.query<{ id: string }>(
      "INSERT INTO accounts (code,name,account_type) VALUES ('EXP-TEST','Expense test','expense') RETURNING id",
    )
    await database.query(
      `INSERT INTO expense_items
       (expense_id,account_id,description,net_amount,tax_mode,tax_rate,tax_amount,line_total)
       VALUES ($1,$2,'Test expense',100,'exclusive',7,7,107)`,
      [expense.rows[0].id, expenseAccount.rows[0].id],
    )
    const journal = await database.query<{ id: string }>(
      `INSERT INTO journal_entries (expense_id,posted_by,document_no,entry_date,description,status)
       VALUES ($1,$2,'JV-EXP-TEST-1','2026-10-02','Expense test','posted') RETURNING id`,
      [expense.rows[0].id, user.rows[0].id],
    )
    await assert.rejects(
      database.query(
        `INSERT INTO journal_entries (expense_id,posted_by,document_no,entry_date,description,status)
         VALUES ($1,$2,'JV-EXP-TEST-2','2026-10-02','Duplicate posting','posted')`,
        [expense.rows[0].id, user.rows[0].id],
      ),
    )
    await database.query(
      `INSERT INTO journal_entries (reverses_id,posted_by,document_no,entry_date,description,status)
       VALUES ($1,$2,'JVR-EXP-TEST-1','2026-10-02','Expense reversal','posted')`,
      [journal.rows[0].id, user.rows[0].id],
    )
  })
})
