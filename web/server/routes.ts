import { randomUUID } from 'node:crypto'
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { Router } from 'express'
import { hash } from 'bcryptjs'
import multer from 'multer'
import { z } from 'zod'
import { pool } from './db.js'
import { asyncHandler, HttpError } from './http.js'
import { requirePermission } from './auth.js'
import { detectEvidenceFileType, safeEvidenceFileName } from './attachment-validation.js'

export const apiRouter = Router()
const attachmentStoragePath = path.resolve(process.env.ATTACHMENT_STORAGE_PATH || path.join(process.cwd(), 'private-uploads'))
const evidenceUpload = multer({
  storage: multer.memoryStorage(),
  limits: { files: 1, fileSize: 5 * 1024 * 1024 },
  fileFilter: (_request, file, callback) => {
    const acceptedMimeTypes = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp']
    if (!acceptedMimeTypes.includes(file.mimetype)) {
      callback(new HttpError(400, 'รองรับเฉพาะไฟล์ PDF, JPEG, PNG หรือ WebP'))
      return
    }
    callback(null, true)
  },
})

const roomStatusValues = ['available', 'maintenance', 'disabled'] as const

const propertySchema = z.object({
  code: z.string().trim().min(1).max(30),
  name: z.string().trim().min(1).max(200),
  address: z.string().trim().max(5000).optional(),
})
const buildingSchema = z.object({
  propertyId: z.coerce.number().int().positive(),
  code: z.string().trim().min(1).max(30),
  name: z.string().trim().min(1).max(200),
})
const floorSchema = z.object({
  buildingId: z.coerce.number().int().positive(),
  code: z.string().trim().min(1).max(30),
})
const roomTypeSchema = z.object({
  code: z.string().trim().min(1).max(30),
  name: z.string().trim().min(1).max(100),
  defaultRent: z.coerce.number().finite().nonnegative(),
  capacity: z.coerce.number().int().positive(),
})
const accountSchema = z.object({
  code: z.string().trim().min(1).max(30),
  name: z.string().trim().min(1).max(150),
  accountType: z.enum(['asset', 'liability', 'equity', 'income', 'expense']),
  parentId: z.coerce.number().int().positive().optional(),
})
const bankAccountSchema = z.object({
  accountId: z.coerce.number().int().positive(),
  code: z.string().trim().min(1).max(30),
  name: z.string().trim().min(1).max(150),
  kind: z.enum(['cash', 'bank', 'clearing']),
  bankName: z.string().trim().max(150).optional(),
  accountReference: z.string().trim().max(100).optional(),
})
const chargeSchema = z.object({
  accountId: z.coerce.number().int().positive(),
  code: z.string().trim().min(1).max(30),
  name: z.string().trim().min(1).max(150),
  category: z.string().trim().min(1).max(30),
  defaultAmount: z.coerce.number().finite().nonnegative(),
  taxMode: z.enum(['none', 'inclusive', 'exclusive']),
  taxRate: z.coerce.number().finite().nonnegative().max(100),
})
const supplierSchema = z.object({
  code: z.string().trim().min(1).max(30),
  name: z.string().trim().min(1).max(200),
  taxId: z.string().trim().max(30).optional(),
  phone: z.string().trim().max(40).optional(),
  address: z.string().trim().max(5000).optional(),
})
const tariffSchema = z.object({
  propertyId: z.coerce.number().int().positive(),
  chargeId: z.coerce.number().int().positive(),
  utilityType: z.enum(['water', 'electricity']),
  name: z.string().trim().min(1).max(150),
  pricingMethod: z.enum(['meter', 'flat', 'tiered']),
  unitRate: z.coerce.number().finite().nonnegative().default(0),
  fixedAmount: z.coerce.number().finite().nonnegative().default(0),
  effectiveFrom: z.string().date(),
  effectiveTo: z.union([z.string().date(), z.literal('')]).optional(),
  tiers: z.array(z.object({
    lowerUnit: z.coerce.number().finite().nonnegative(),
    upperUnit: z.union([z.coerce.number().finite().positive(), z.null()]).optional(),
    unitRate: z.coerce.number().finite().nonnegative(),
  })).max(20).default([]),
}).refine((value) => value.pricingMethod !== 'tiered' || value.tiers.length > 0, {
  path: ['tiers'],
  message: 'อัตราแบบขั้นบันไดต้องระบุอย่างน้อยหนึ่งขั้น',
})
const meterSchema = z.object({
  roomId: z.coerce.number().int().positive(),
  tariffId: z.coerce.number().int().positive(),
  serialNo: z.string().trim().min(1).max(100),
  rolloverValue: z.union([z.coerce.number().finite().positive(), z.literal(''), z.null()]).optional()
    .transform((value) => value === '' ? undefined : value),
  installedAt: z.string().date(),
})
const utilityAssignmentSchema = z.object({
  roomId: z.coerce.number().int().positive(),
  tariffId: z.coerce.number().int().positive(),
  effectiveFrom: z.string().date(),
  effectiveTo: z.union([z.string().date(), z.literal('')]).optional(),
}).refine((value) => !value.effectiveTo || value.effectiveTo >= value.effectiveFrom, {
  path: ['effectiveTo'],
  message: 'วันสิ้นสุดต้องไม่ก่อนวันเริ่มต้น',
})
const periodSchema = z.object({
  propertyId: z.coerce.number().int().positive(),
  code: z.string().trim().min(1).max(30),
  startDate: z.string().date(),
  endDate: z.string().date(),
}).refine((value) => value.endDate >= value.startDate, { path: ['endDate'], message: 'วันสิ้นงวดต้องไม่ก่อนวันเริ่มงวด' })
const readingSchema = z.object({
  meterId: z.coerce.number().int().positive(),
  billingPeriodId: z.coerce.number().int().positive(),
  previousValue: z.coerce.number().finite().nonnegative(),
  currentValue: z.coerce.number().finite().nonnegative(),
  rolloverCount: z.coerce.number().int().nonnegative().default(0),
})
const invoiceIssueSchema = z.object({
  receivableAccountId: z.coerce.number().int().positive(),
  taxPayableAccountId: z.coerce.number().int().positive().optional(),
})
const paymentSchema = z.object({
  customerId: z.coerce.number().int().positive(),
  bankAccountId: z.coerce.number().int().positive(),
  amount: z.coerce.number().finite().positive().max(999999999999.99),
  method: z.enum(['cash', 'transfer', 'cheque', 'card']),
  reference: z.string().trim().max(150).optional(),
  allocations: z.array(z.object({
    invoiceId: z.coerce.number().int().positive(),
    amount: z.coerce.number().finite().positive().max(999999999999.99),
  })).max(100).default([]),
}).refine((value) => new Set(value.allocations.map((allocation) => allocation.invoiceId)).size === value.allocations.length, {
  path: ['allocations'],
  message: 'ห้ามจัดสรรใบแจ้งหนี้ซ้ำในรายการเดียวกัน',
}).refine((value) => Math.round(value.allocations.reduce((sum, allocation) => sum + allocation.amount, 0) * 100) <= Math.round(value.amount * 100), {
  path: ['allocations'],
  message: 'ยอดจัดสรรรวมต้องไม่เกินยอดรับชำระ',
})
const paymentConfirmationSchema = z.object({
  receivableAccountId: z.coerce.number().int().positive(),
  advanceLiabilityAccountId: z.coerce.number().int().positive().optional(),
})
const paymentVoidSchema = z.object({
  reason: z.string().trim().min(3).max(500),
})
const fundTransactionSchema = z.object({
  fundType: z.enum(['reservation', 'deposit', 'advance']),
  transactionType: z.enum(['receive', 'refund', 'apply_invoice']),
  bookingId: z.coerce.number().int().positive().optional(),
  contractId: z.coerce.number().int().positive().optional(),
  invoiceId: z.coerce.number().int().positive().optional(),
  bankAccountId: z.coerce.number().int().positive().optional(),
  method: z.enum(['cash', 'transfer', 'cheque', 'card']).optional(),
  amount: z.coerce.number().finite().positive().max(999999999999.99),
  liabilityAccountId: z.coerce.number().int().positive(),
  receivableAccountId: z.coerce.number().int().positive().optional(),
}).superRefine((value, context) => {
  if (Boolean(value.bookingId) === Boolean(value.contractId)) {
    context.addIssue({ code: 'custom', message: 'ระบุ bookingId หรือ contractId อย่างใดอย่างหนึ่งเท่านั้น' })
  }
  if (value.transactionType === 'receive' || value.transactionType === 'refund') {
    if (!value.bankAccountId || !value.method) {
      context.addIssue({ code: 'custom', message: 'รายการรับ/คืนเงินจริงต้องระบุสมุดเงินและวิธีชำระ' })
    }
  }
  if (value.transactionType === 'apply_invoice' && (!value.contractId || !value.invoiceId || !value.receivableAccountId)) {
    context.addIssue({ code: 'custom', message: 'รายการหักบิลต้องระบุสัญญา ใบแจ้งหนี้ และบัญชีลูกหนี้' })
  }
})
const fundTransferSchema = z.object({
  fromFundType: z.enum(['reservation', 'deposit', 'advance']),
  toFundType: z.enum(['reservation', 'deposit', 'advance']),
  fromBookingId: z.coerce.number().int().positive(),
  toContractId: z.coerce.number().int().positive(),
  amount: z.coerce.number().finite().positive().max(999999999999.99),
  sourceLiabilityAccountId: z.coerce.number().int().positive(),
  destinationLiabilityAccountId: z.coerce.number().int().positive(),
})
const expenseCreateSchema = z.object({
  bankAccountId: z.coerce.number().int().positive(),
  expenseAccountId: z.coerce.number().int().positive(),
  supplierId: z.union([z.coerce.number().int().positive(), z.literal('')]).optional(),
  expenseDate: z.string().date(),
  paymentMethod: z.enum(['cash', 'transfer', 'cheque', 'card']),
  supplierDocumentNo: z.string().trim().max(100).optional(),
  paymentCategory: z.string().trim().min(1).max(30),
  description: z.string().trim().min(1).max(1000),
  taxMode: z.enum(['none', 'inclusive', 'exclusive']),
  taxRate: z.coerce.number().finite().min(0).max(100),
  amount: z.coerce.number().finite().positive().max(999999999999.99),
}).refine((value) => value.taxMode !== 'none' || value.taxRate === 0, {
  path: ['taxRate'],
  message: 'รายการไม่คิดภาษีต้องมีอัตราภาษีเป็น 0',
})
const expensePostSchema = z.object({
  inputTaxAccountId: z.coerce.number().int().positive().optional(),
})
const expenseVoidSchema = z.object({
  reason: z.string().trim().min(3).max(500),
})
const fundReverseSchema = z.object({
  reason: z.string().trim().min(3).max(500),
})
const managedUserSchema = z.object({
  username: z.string().trim().min(1).max(100),
  displayName: z.string().trim().min(1).max(200),
  password: z.string().min(12).max(200),
  roleIds: z.array(z.coerce.number().int().positive()).min(1).max(100),
  customerId: z.union([z.coerce.number().int().positive(), z.literal('')]).optional().transform((value) => value === '' ? null : value ?? null),
}).refine((value) => new Set(value.roleIds).size === value.roleIds.length, {
  path: ['roleIds'],
  message: 'เลือกบทบาทซ้ำไม่ได้',
})
const managedUserUpdateSchema = z.object({
  active: z.boolean(),
  roleIds: z.array(z.coerce.number().int().positive()).max(100),
  customerId: z.union([z.coerce.number().int().positive(), z.literal('')]).optional().transform((value) => value === '' ? null : value ?? undefined),
}).refine((value) => !value.active || value.roleIds.length > 0, {
  path: ['roleIds'],
  message: 'บัญชีที่เปิดใช้งานต้องมีอย่างน้อยหนึ่งบทบาท',
}).refine((value) => new Set(value.roleIds).size === value.roleIds.length, {
  path: ['roleIds'],
  message: 'เลือกบทบาทซ้ำไม่ได้',
})
const managedRoleSchema = z.object({
  code: z.string().trim().min(1).max(30),
  name: z.string().trim().min(1).max(100),
  permissionCodes: z.array(z.string().trim().min(1).max(100)).max(100),
}).refine((value) => new Set(value.permissionCodes).size === value.permissionCodes.length, {
  path: ['permissionCodes'],
  message: 'เลือกสิทธิ์ซ้ำไม่ได้',
})
const managedRolePermissionsSchema = z.object({
  permissionCodes: z.array(z.string().trim().min(1).max(100)).max(100),
}).refine((value) => new Set(value.permissionCodes).size === value.permissionCodes.length, {
  path: ['permissionCodes'],
  message: 'เลือกสิทธิ์ซ้ำไม่ได้',
})
const roomSchema = z.object({
  floorId: z.coerce.number().int().positive(),
  roomTypeId: z.coerce.number().int().positive(),
  code: z.string().trim().min(1).max(30),
  baseRent: z.coerce.number().finite().nonnegative(),
  operationalStatus: z.enum(roomStatusValues).default('available'),
})
const customerSchema = z.object({
  fullName: z.string().trim().min(1).max(200),
  phone: z.string().trim().max(40).optional(),
  email: z.union([z.string().trim().email().max(254), z.literal('')]).optional(),
  birthDate: z.union([z.string().date(), z.literal('')]).optional(),
  address: z.string().trim().max(5000).optional(),
})
const contractSchema = z.object({
  bookingId: z.union([z.coerce.number().int().positive(), z.literal('')]).optional().transform((v) => v === '' ? undefined : v),
  customerId: z.coerce.number().int().positive(),
  roomId: z.coerce.number().int().positive(),
  startDate: z.string().date(),
  endDate: z.string().date(),
  rentalCycle: z.enum(['monthly', 'yearly']),
  rentAmount: z.coerce.number().finite().nonnegative(),
  depositRequired: z.coerce.number().finite().nonnegative().default(0),
  billingDay: z.coerce.number().int().min(1).max(28).default(25),
  dueDays: z.coerce.number().int().min(0).max(365).default(7),
  residents: z.array(z.coerce.number().int().positive()).max(20).default([]),
}).refine((value) => value.endDate >= value.startDate, { path: ['endDate'], message: 'วันสิ้นสุดต้องไม่ก่อนวันเริ่มสัญญา' })
const contractMoveSchema = z.object({
  roomId: z.coerce.number().int().positive(),
  effectiveDate: z.string().date(),
  rentAmount: z.coerce.number().finite().nonnegative().max(999999999999.99),
  meterHandoverNote: z.string().trim().max(2000).optional(),
})
const contractEndSchema = z.object({
  endDate: z.string().date(),
})

function parseInput<T extends z.ZodType>(schema: T, input: unknown) {
  const parsed = schema.safeParse(input)
  if (!parsed.success) {
    throw new HttpError(400, parsed.error.issues.map((issue) => issue.message).join(' • '))
  }
  return parsed.data
}

async function lockUserAdministration(client: import('pg').PoolClient) {
  await client.query('SELECT pg_advisory_xact_lock(90421731)')
}

async function ensureAnActiveUserManager(client: import('pg').PoolClient) {
  const result = await client.query<{ count: string }>(
    `SELECT COUNT(DISTINCT u.id)::text AS count
     FROM users u
     JOIN user_roles ur ON ur.user_id=u.id
     JOIN role_permissions rp ON rp.role_id=ur.role_id
     JOIN permissions p ON p.id=rp.permission_id AND p.code='users.manage'
     WHERE u.active=true`,
  )
  if (Number(result.rows[0].count) === 0) {
    throw new HttpError(409, 'ต้องมีผู้ใช้ที่เปิดใช้งานและมีสิทธิ์จัดการผู้ใช้อย่างน้อยหนึ่งบัญชี')
  }
}

async function ensureUserRetainsManagement(client: import('pg').PoolClient, userId: string) {
  const result = await client.query(
    `SELECT 1
     FROM users u
     JOIN user_roles ur ON ur.user_id=u.id
     JOIN role_permissions rp ON rp.role_id=ur.role_id
     JOIN permissions p ON p.id=rp.permission_id AND p.code='users.manage'
     WHERE u.id=$1 AND u.active=true
     LIMIT 1`,
    [userId],
  )
  if (!result.rowCount) {
    throw new HttpError(409, 'ไม่สามารถตัดสิทธิ์จัดการผู้ใช้ของบัญชีที่กำลังดำเนินการได้')
  }
}

async function ensureTenantAccountLink(
  client: import('pg').PoolClient,
  roleIds: number[],
  customerId: number | string | null | undefined,
) {
  if (customerId) {
    const customer = await client.query('SELECT 1 FROM customers WHERE id=$1', [customerId])
    if (!customer.rowCount) throw new HttpError(400, 'ไม่พบผู้เช่าที่ผูกกับบัญชี')
  }
  const tenantRole = await client.query(
    `SELECT 1
     FROM role_permissions rp
     JOIN permissions p ON p.id=rp.permission_id AND p.code='tenant.portal'
     WHERE rp.role_id=ANY($1::bigint[])
     LIMIT 1`,
    [roleIds],
  )
  if (tenantRole.rowCount && !customerId) {
    throw new HttpError(400, 'บทบาทพอร์ทัลผู้เช่าต้องผูกกับข้อมูลผู้เช่า')
  }
}

async function ensureTenantRoleAssignmentsLinked(client: import('pg').PoolClient, roleId: number) {
  const result = await client.query(
    `SELECT 1
     FROM role_permissions rp
     JOIN permissions p ON p.id=rp.permission_id AND p.code='tenant.portal'
     JOIN user_roles ur ON ur.role_id=rp.role_id
     JOIN users u ON u.id=ur.user_id
     WHERE rp.role_id=$1 AND u.customer_id IS NULL
     LIMIT 1`,
    [roleId],
  )
  if (result.rowCount) {
    throw new HttpError(409, 'ผู้ใช้ในบทบาทพอร์ทัลทุกบัญชีต้องผูกกับข้อมูลผู้เช่าก่อน')
  }
}

async function nextDocumentNumber(client: import('pg').PoolClient, documentType: string, prefix: string) {
  const period = new Date().toISOString().slice(0, 7).replace('-', '')
  const result = await client.query<{ prefix: string; issued_number: string }>(
    `INSERT INTO document_sequences (document_type, period_key, prefix, next_number)
     VALUES ($1, $2, $3, 2)
     ON CONFLICT (document_type, period_key)
     DO UPDATE SET next_number = document_sequences.next_number + 1
     RETURNING prefix, (next_number - 1)::text AS issued_number`,
    [documentType, period, prefix],
  )
  const row = result.rows[0]
  return `${row.prefix}${period}-${row.issued_number.padStart(5, '0')}`
}

async function fundBalance(
  client: import('pg').PoolClient,
  fundType: 'reservation' | 'deposit' | 'advance',
  owner: { bookingId?: number; contractId?: number },
) {
  const result = await client.query<{ balance: string }>(
    `SELECT COALESCE(SUM(
       CASE
         WHEN ft.transaction_type IN ('receive','transfer_in') THEN ft.amount
         WHEN ft.transaction_type IN ('refund','transfer_out','apply_invoice') THEN -ft.amount
         WHEN ft.transaction_type='reversal' AND original.transaction_type IN ('receive','transfer_in') THEN -ft.amount
         WHEN ft.transaction_type='reversal' THEN ft.amount
         ELSE 0
       END
     ),0)::numeric(14,2)::text AS balance
     FROM fund_transactions ft
     LEFT JOIN fund_transactions original ON original.id=ft.related_transaction_id
     WHERE ft.fund_type=$1 AND ft.status='posted'
       AND (($2::bigint IS NOT NULL AND ft.booking_id=$2)
         OR ($3::bigint IS NOT NULL AND ft.contract_id=$3))`,
    [fundType, owner.bookingId ?? null, owner.contractId ?? null],
  )
  return result.rows[0].balance
}

apiRouter.get('/health', asyncHandler(async (_request, response) => {
  await pool.query('SELECT 1')
  response.json({ status: 'ok', database: 'connected' })
}))

apiRouter.get('/lookups', requirePermission('properties.read'), asyncHandler(async (_request, response) => {
  const [properties, buildings, floors, roomTypes, accounts, bankAccounts, charges, tariffs, suppliers] = await Promise.all([
    pool.query('SELECT id, code, name FROM properties ORDER BY name'),
    pool.query('SELECT id, property_id AS "propertyId", code, name FROM buildings ORDER BY name'),
    pool.query('SELECT id, building_id AS "buildingId", code FROM floors ORDER BY code'),
    pool.query('SELECT id, code, name, default_rent AS "defaultRent", capacity FROM room_types ORDER BY name'),
    pool.query('SELECT id, code, name, account_type AS "accountType" FROM accounts ORDER BY code'),
    pool.query('SELECT id, account_id AS "accountId", code, name, kind, bank_name AS "bankName" FROM bank_accounts ORDER BY name'),
    pool.query('SELECT id, code, name, category, default_amount AS "defaultAmount", tax_mode AS "taxMode", tax_rate AS "taxRate", account_id AS "accountId" FROM charges ORDER BY name'),
    pool.query('SELECT id, property_id AS "propertyId", utility_type AS "utilityType", name, pricing_method AS "pricingMethod", unit_rate AS "unitRate", fixed_amount AS "fixedAmount", effective_from AS "effectiveFrom", effective_to AS "effectiveTo", charge_id AS "chargeId" FROM utility_tariffs ORDER BY name'),
    pool.query('SELECT id,code,name,tax_id AS "taxId",phone FROM suppliers ORDER BY name'),
  ])
  response.json({ properties: properties.rows, buildings: buildings.rows, floors: floors.rows, roomTypes: roomTypes.rows, accounts: accounts.rows, bankAccounts: bankAccounts.rows, charges: charges.rows, tariffs: tariffs.rows, suppliers: suppliers.rows })
}))

apiRouter.get('/admin/users', requirePermission('users.manage'), asyncHandler(async (_request, response) => {
  const result = await pool.query(
    `SELECT u.id,u.username,u.display_name AS "displayName",u.active,
            u.customer_id AS "customerId",customer.full_name AS "customerName",
            COALESCE(array_agg(DISTINCT r.id) FILTER (WHERE r.id IS NOT NULL),'{}') AS "roleIds",
            COALESCE(string_agg(DISTINCT r.name,', ' ORDER BY r.name),'') AS "roleNames"
     FROM users u LEFT JOIN user_roles ur ON ur.user_id=u.id
     LEFT JOIN roles r ON r.id=ur.role_id
     LEFT JOIN customers customer ON customer.id=u.customer_id
     GROUP BY u.id,customer.full_name ORDER BY u.username`,
  )
  response.json({ users: result.rows })
}))

apiRouter.get('/admin/customers', requirePermission('users.manage'), asyncHandler(async (_request, response) => {
  const result = await pool.query('SELECT id,code,full_name AS "fullName" FROM customers ORDER BY full_name')
  response.json({ customers: result.rows })
}))

apiRouter.get('/admin/roles', requirePermission('users.manage'), asyncHandler(async (_request, response) => {
  const [roles, permissions] = await Promise.all([
    pool.query(
      `SELECT r.id,r.code,r.name,
              COALESCE(array_agg(DISTINCT p.code) FILTER (WHERE p.code IS NOT NULL),'{}') AS "permissionCodes"
       FROM roles r LEFT JOIN role_permissions rp ON rp.role_id=r.id
       LEFT JOIN permissions p ON p.id=rp.permission_id
       GROUP BY r.id ORDER BY r.name`,
    ),
    pool.query('SELECT code,description FROM permissions ORDER BY code'),
  ])
  response.json({ roles: roles.rows, permissions: permissions.rows })
}))

apiRouter.post('/admin/users', requirePermission('users.manage'), asyncHandler(async (request, response) => {
  const input = parseInput(managedUserSchema, request.body)
  const passwordHash = await hash(input.password, 12)
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await lockUserAdministration(client)
    const roles = await client.query('SELECT id FROM roles WHERE id=ANY($1::bigint[])', [input.roleIds])
    if (roles.rowCount !== input.roleIds.length) throw new HttpError(400, 'มีบทบาทที่ไม่พบในระบบ')
    await ensureTenantAccountLink(client, input.roleIds, input.customerId)
    const user = await client.query<{ id: string }>(
      'INSERT INTO users (username,password_hash,display_name,customer_id) VALUES ($1,$2,$3,$4) RETURNING id',
      [input.username, passwordHash, input.displayName, input.customerId],
    )
    for (const roleId of input.roleIds) {
      await client.query('INSERT INTO user_roles (user_id,role_id) VALUES ($1,$2)', [user.rows[0].id, roleId])
    }
    await ensureAnActiveUserManager(client)
    await ensureUserRetainsManagement(client, request.user!.id)
    await client.query(
      `INSERT INTO audit_logs (user_id,action,entity_type,entity_id,after_data)
       VALUES ($1,'create','user',$2,$3::jsonb)`,
      [request.user!.id, user.rows[0].id, JSON.stringify({ username: input.username, roleIds: input.roleIds })],
    )
    await client.query('COMMIT')
    response.status(201).json({ id: user.rows[0].id, username: input.username, active: true })
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}))

apiRouter.patch('/admin/users/:id', requirePermission('users.manage'), asyncHandler(async (request, response) => {
  const userId = z.coerce.number().int().positive().parse(request.params.id)
  const input = parseInput(managedUserUpdateSchema, request.body)
  if (String(userId) === request.user!.id && !input.active) {
    throw new HttpError(409, 'ไม่สามารถปิดใช้งานบัญชีที่กำลังเข้าสู่ระบบ')
  }
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await lockUserAdministration(client)
    const user = await client.query<{ id: string; customerId: string | null }>(
      'SELECT id,customer_id AS "customerId" FROM users WHERE id=$1 FOR UPDATE',
      [userId],
    )
    if (!user.rowCount) throw new HttpError(404, 'ไม่พบผู้ใช้')
    const roles = await client.query('SELECT id FROM roles WHERE id=ANY($1::bigint[])', [input.roleIds])
    if (roles.rowCount !== input.roleIds.length) throw new HttpError(400, 'มีบทบาทที่ไม่พบในระบบ')
    const customerId = input.customerId === undefined ? user.rows[0].customerId : input.customerId
    await ensureTenantAccountLink(client, input.roleIds, customerId)
    await client.query('UPDATE users SET active=$1,customer_id=$2 WHERE id=$3', [input.active, customerId, userId])
    await client.query('DELETE FROM user_roles WHERE user_id=$1', [userId])
    for (const roleId of input.roleIds) {
      await client.query('INSERT INTO user_roles (user_id,role_id) VALUES ($1,$2)', [userId, roleId])
    }
    await ensureAnActiveUserManager(client)
    await ensureUserRetainsManagement(client, request.user!.id)
    await client.query(
      `INSERT INTO audit_logs (user_id,action,entity_type,entity_id,after_data)
       VALUES ($1,'update','user',$2,$3::jsonb)`,
      [request.user!.id, userId, JSON.stringify({ active: input.active, roleIds: input.roleIds })],
    )
    await client.query('COMMIT')
    response.json({ id: userId, active: input.active, roleIds: input.roleIds, customerId })
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}))

apiRouter.post('/admin/users/:id/reset-password', requirePermission('users.manage'), asyncHandler(async (request, response) => {
  const userId = z.coerce.number().int().positive().parse(request.params.id)
  const input = parseInput(z.object({ password: z.string().min(12).max(200) }), request.body)
  const passwordHash = await hash(input.password, 12)
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const result = await client.query('UPDATE users SET password_hash=$1 WHERE id=$2 RETURNING id', [passwordHash, userId])
    if (!result.rowCount) throw new HttpError(404, 'ไม่พบผู้ใช้')
    await client.query(
      `INSERT INTO audit_logs (user_id,action,entity_type,entity_id,after_data)
       VALUES ($1,'reset-password','user',$2,'{}'::jsonb)`,
      [request.user!.id, userId],
    )
    await client.query('COMMIT')
    response.json({ id: userId, passwordReset: true })
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}))

apiRouter.post('/admin/roles', requirePermission('users.manage'), asyncHandler(async (request, response) => {
  const input = parseInput(managedRoleSchema, request.body)
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await lockUserAdministration(client)
    const permissions = await client.query<{ id: string; code: string }>(
      'SELECT id,code FROM permissions WHERE code=ANY($1::text[])',
      [input.permissionCodes],
    )
    if (permissions.rowCount !== input.permissionCodes.length) throw new HttpError(400, 'มีรหัสสิทธิ์ที่ไม่พบในระบบ')
    const role = await client.query<{ id: string }>(
      'INSERT INTO roles (code,name) VALUES ($1,$2) RETURNING id',
      [input.code, input.name],
    )
    for (const permission of permissions.rows) {
      await client.query('INSERT INTO role_permissions (role_id,permission_id) VALUES ($1,$2)', [role.rows[0].id, permission.id])
    }
    await ensureAnActiveUserManager(client)
    await client.query(
      `INSERT INTO audit_logs (user_id,action,entity_type,entity_id,after_data)
       VALUES ($1,'create','role',$2,$3::jsonb)`,
      [request.user!.id, role.rows[0].id, JSON.stringify({ code: input.code, permissionCodes: input.permissionCodes })],
    )
    await client.query('COMMIT')
    response.status(201).json({ id: role.rows[0].id, code: input.code, name: input.name })
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}))

apiRouter.patch('/admin/roles/:id/permissions', requirePermission('users.manage'), asyncHandler(async (request, response) => {
  const roleId = z.coerce.number().int().positive().parse(request.params.id)
  const input = parseInput(managedRolePermissionsSchema, request.body)
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await lockUserAdministration(client)
    const role = await client.query('SELECT id FROM roles WHERE id=$1 FOR UPDATE', [roleId])
    if (!role.rowCount) throw new HttpError(404, 'ไม่พบบทบาท')
    const permissions = await client.query<{ id: string; code: string }>(
      'SELECT id,code FROM permissions WHERE code=ANY($1::text[])',
      [input.permissionCodes],
    )
    if (permissions.rowCount !== input.permissionCodes.length) throw new HttpError(400, 'มีรหัสสิทธิ์ที่ไม่พบในระบบ')
    await client.query('DELETE FROM role_permissions WHERE role_id=$1', [roleId])
    for (const permission of permissions.rows) {
      await client.query('INSERT INTO role_permissions (role_id,permission_id) VALUES ($1,$2)', [roleId, permission.id])
    }
    await ensureTenantRoleAssignmentsLinked(client, roleId)
    await ensureAnActiveUserManager(client)
    await ensureUserRetainsManagement(client, request.user!.id)
    await client.query(
      `INSERT INTO audit_logs (user_id,action,entity_type,entity_id,after_data)
       VALUES ($1,'permissions-update','role',$2,$3::jsonb)`,
      [request.user!.id, roleId, JSON.stringify({ permissionCodes: input.permissionCodes })],
    )
    await client.query('COMMIT')
    response.json({ id: roleId, permissionCodes: input.permissionCodes })
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}))

apiRouter.get('/portal', requirePermission('tenant.portal'), asyncHandler(async (request, response) => {
  const customerId = request.user!.customerId
  if (!customerId) throw new HttpError(403, 'บัญชีนี้ยังไม่ได้ผูกกับข้อมูลผู้เช่า')
  const [customer, contracts, invoices, maintenance, complaints] = await Promise.all([
    pool.query('SELECT id,code,full_name AS "fullName" FROM customers WHERE id=$1', [customerId]),
    pool.query(
      `SELECT c.id,c.document_no AS "documentNo",c.status,c.start_date AS "startDate",c.end_date AS "endDate",
              room.code AS "roomCode",building.name AS building
       FROM contracts c
       LEFT JOIN LATERAL (
         SELECT cra.room_id FROM contract_room_assignments cra
         WHERE cra.contract_id=c.id AND cra.start_date<=CURRENT_DATE
           AND (cra.end_date IS NULL OR cra.end_date>=CURRENT_DATE)
         ORDER BY cra.start_date DESC LIMIT 1
       ) assignment ON true
       LEFT JOIN rooms room ON room.id=assignment.room_id
       LEFT JOIN floors floor ON floor.id=room.floor_id
       LEFT JOIN buildings building ON building.id=floor.building_id
       WHERE c.customer_id=$1 ORDER BY c.start_date DESC,c.id DESC`,
      [customerId],
    ),
    pool.query(
      `SELECT i.id,i.document_no AS "documentNo",i.status,i.due_date AS "dueDate",i.total,
              COALESCE((SELECT SUM(pa.amount) FROM payment_allocations pa
                        JOIN payments pay ON pay.id=pa.payment_id AND pay.status='confirmed'
                        WHERE pa.invoice_id=i.id),0)
              + COALESCE((SELECT SUM(ft.amount) FROM fund_transactions ft
                          WHERE ft.invoice_id=i.id AND ft.transaction_type='apply_invoice' AND ft.status='posted'
                            AND NOT EXISTS (
                              SELECT 1 FROM fund_transactions rev
                              WHERE rev.related_transaction_id=ft.id AND rev.transaction_type='reversal' AND rev.status='posted'
                            )),0) AS "paidAmount"
              ,COALESCE((SELECT jsonb_agg(jsonb_build_object(
                          'id',a.id::text,'fileName',a.file_name,'mimeType',a.mime_type,'createdAt',a.created_at
                        ) ORDER BY a.created_at DESC,a.id DESC)
                         FROM attachments a WHERE a.entity_type='invoice' AND a.entity_id=i.id),'[]'::jsonb) AS attachments
       FROM invoices i WHERE i.customer_id=$1 AND i.status<>'draft'
       ORDER BY i.issued_at DESC,i.id DESC`,
      [customerId],
    ),
    pool.query(
      `SELECT mr.id,mr.document_no AS "documentNo",mr.description,mr.priority,mr.status,mr.reported_at AS "reportedAt",
              room.code AS "roomCode"
       FROM maintenance_requests mr
       JOIN contracts c ON c.id=mr.contract_id AND c.customer_id=$1
       JOIN rooms room ON room.id=mr.room_id
       ORDER BY mr.reported_at DESC,mr.id DESC LIMIT 100`,
      [customerId],
    ),
    pool.query(
      `SELECT complaint.id,complaint.document_no AS "documentNo",complaint.description,complaint.resolution,
              complaint.status,complaint.reported_at AS "reportedAt",room.code AS "roomCode"
       FROM complaints complaint
       JOIN contracts c ON c.id=complaint.contract_id AND c.customer_id=$1
       JOIN rooms room ON room.id=complaint.room_id
       ORDER BY complaint.reported_at DESC,complaint.id DESC LIMIT 100`,
      [customerId],
    ),
  ])
  if (!customer.rowCount) throw new HttpError(403, 'ไม่พบข้อมูลผู้เช่าที่ผูกกับบัญชี')
  response.json({
    customer: customer.rows[0],
    contracts: contracts.rows,
    invoices: invoices.rows,
    maintenanceRequests: maintenance.rows,
    complaints: complaints.rows,
  })
}))

apiRouter.get('/portal/invoices/:id/print-data', requirePermission('tenant.portal'), asyncHandler(async (request, response) => {
  const invoiceId = z.coerce.number().int().positive().parse(request.params.id)
  const customerId = request.user!.customerId
  if (!customerId) throw new HttpError(403, 'บัญชีนี้ยังไม่ได้ผูกกับข้อมูลผู้เช่า')
  const [invoice, items] = await Promise.all([
    pool.query(
      `SELECT id,document_no AS "documentNo",issued_at AS "issuedAt",due_date AS "dueDate",
              status,subtotal,tax_total AS "taxTotal",total,document_snapshot AS snapshot
       FROM invoices WHERE id=$1 AND customer_id=$2 AND status<>'draft'`,
      [invoiceId, customerId],
    ),
    pool.query(
      `SELECT ii.id,ii.description,ii.quantity,ii.unit_price AS "unitPrice",
              ii.net_amount AS "netAmount",ii.tax_rate AS "taxRate",ii.tax_amount AS "taxAmount",
              ii.line_total AS "lineTotal",ii.tax_mode AS "taxMode"
       FROM invoice_items ii JOIN invoices i ON i.id=ii.invoice_id
       WHERE i.id=$1 AND i.customer_id=$2 AND i.status<>'draft' ORDER BY ii.id`,
      [invoiceId, customerId],
    ),
  ])
  if (!invoice.rowCount) throw new HttpError(404, 'ไม่พบใบแจ้งหนี้')
  response.json({ invoice: invoice.rows[0], items: items.rows })
}))

apiRouter.post('/portal/invoices/:id/evidence', requirePermission('tenant.portal'), evidenceUpload.single('file'), asyncHandler(async (request, response) => {
  const invoiceId = z.coerce.number().int().positive().parse(request.params.id)
  const customerId = request.user!.customerId
  if (!customerId) throw new HttpError(403, 'บัญชีนี้ยังไม่ได้ผูกกับข้อมูลผู้เช่า')
  const file = request.file
  if (!file) throw new HttpError(400, 'กรุณาเลือกไฟล์หลักฐานการชำระเงิน')
  const detectedType = detectEvidenceFileType(file.buffer)
  if (!detectedType || detectedType.mimeType !== file.mimetype) {
    throw new HttpError(400, 'เนื้อหาไฟล์ไม่ตรงกับชนิดไฟล์ที่รองรับ')
  }

  const objectKey = `${randomUUID()}.${detectedType.extension}`
  const filePath = path.join(attachmentStoragePath, objectKey)
  const client = await pool.connect()
  let transactionStarted = false
  let fileWritten = false
  try {
    await client.query('BEGIN')
    transactionStarted = true
    const invoice = await client.query(
      `SELECT i.id FROM invoices i
       WHERE i.id=$1 AND i.customer_id=$2 AND i.status='issued'
         AND i.total > COALESCE((SELECT SUM(pa.amount) FROM payment_allocations pa
                                 JOIN payments p ON p.id=pa.payment_id AND p.status='confirmed'
                                 WHERE pa.invoice_id=i.id),0)
           + COALESCE((SELECT SUM(ft.amount) FROM fund_transactions ft
                       WHERE ft.invoice_id=i.id AND ft.transaction_type='apply_invoice' AND ft.status='posted'
                         AND NOT EXISTS (
                           SELECT 1 FROM fund_transactions rev
                           WHERE rev.related_transaction_id=ft.id AND rev.transaction_type='reversal' AND rev.status='posted'
                         )),0)
       FOR UPDATE`,
      [invoiceId, customerId],
    )
    if (!invoice.rowCount) throw new HttpError(404, 'ไม่พบใบแจ้งหนี้ที่ยังมียอดค้างชำระ')

    const count = await client.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM attachments WHERE entity_type='invoice' AND entity_id=$1`,
      [invoiceId],
    )
    if (Number(count.rows[0].count) >= 5) throw new HttpError(409, 'ใบแจ้งหนี้นี้แนบหลักฐานได้ไม่เกิน 5 ไฟล์')

    await mkdir(attachmentStoragePath, { recursive: true })
    await writeFile(filePath, file.buffer, { flag: 'wx', mode: 0o600 })
    fileWritten = true
    const result = await client.query(
      `INSERT INTO attachments (uploaded_by,entity_type,entity_id,object_key,file_name,mime_type)
       VALUES ($1,'invoice',$2,$3,$4,$5)
       RETURNING id,file_name AS "fileName",mime_type AS "mimeType",created_at AS "createdAt"`,
      [request.user!.id, invoiceId, objectKey, safeEvidenceFileName(file.originalname), detectedType.mimeType],
    )
    await client.query('COMMIT')
    transactionStarted = false
    fileWritten = false
    response.status(201).json({ attachment: result.rows[0] })
  } catch (error) {
    if (transactionStarted) {
      try {
        await client.query('ROLLBACK')
      } catch (rollbackError) {
        console.error('Unable to roll back tenant evidence upload', rollbackError)
      }
    }
    if (fileWritten) {
      try {
        await unlink(filePath)
      } catch (cleanupError) {
        console.error('Unable to remove incomplete tenant evidence upload', cleanupError)
      }
    }
    throw error
  } finally {
    client.release()
  }
}))

apiRouter.get('/portal/attachments/:id', requirePermission('tenant.portal'), asyncHandler(async (request, response) => {
  const attachmentId = z.coerce.number().int().positive().parse(request.params.id)
  const customerId = request.user!.customerId
  if (!customerId) throw new HttpError(403, 'บัญชีนี้ยังไม่ได้ผูกกับข้อมูลผู้เช่า')
  const result = await pool.query<{ objectKey: string; fileName: string; mimeType: string }>(
    `SELECT a.object_key AS "objectKey",a.file_name AS "fileName",a.mime_type AS "mimeType"
     FROM attachments a JOIN invoices i ON a.entity_type='invoice' AND a.entity_id=i.id
     WHERE a.id=$1 AND i.customer_id=$2 AND i.status<>'draft'`,
    [attachmentId, customerId],
  )
  if (!result.rowCount) throw new HttpError(404, 'ไม่พบไฟล์แนบ')
  const attachment = result.rows[0]
  if (!/^[0-9a-f-]{36}\.(?:pdf|jpg|png|webp)$/.test(attachment.objectKey)) {
    throw new HttpError(500, 'ข้อมูลไฟล์แนบไม่ถูกต้อง')
  }
  const content = await readFile(path.join(attachmentStoragePath, attachment.objectKey))
  response.set('Content-Type', attachment.mimeType)
    .set('Content-Disposition', `attachment; filename="evidence"; filename*=UTF-8''${encodeURIComponent(attachment.fileName)}`)
    .set('X-Content-Type-Options', 'nosniff')
    .send(content)
}))

apiRouter.post('/portal/maintenance-requests', requirePermission('tenant.portal'), asyncHandler(async (request, response) => {
  const customerId = request.user!.customerId
  if (!customerId) throw new HttpError(403, 'บัญชีนี้ยังไม่ได้ผูกกับข้อมูลผู้เช่า')
  const input = parseInput(z.object({
    contractId: z.coerce.number().int().positive(),
    description: z.string().trim().min(1).max(5000),
    priority: z.enum(['low', 'normal', 'high']).default('normal'),
  }), request.body)
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const assignment = await client.query<{ roomId: string }>(
      `SELECT cra.room_id AS "roomId"
       FROM contracts c
       JOIN contract_room_assignments cra ON cra.contract_id=c.id
       WHERE c.id=$1 AND c.customer_id=$2 AND c.status='active'
         AND CURRENT_DATE BETWEEN c.start_date AND c.end_date
         AND cra.start_date<=CURRENT_DATE AND (cra.end_date IS NULL OR cra.end_date>=CURRENT_DATE)
       ORDER BY cra.start_date DESC LIMIT 1 FOR SHARE OF c,cra`,
      [input.contractId, customerId],
    )
    if (!assignment.rowCount) throw new HttpError(404, 'ไม่พบสัญญาที่กำลังใช้งานอยู่')
    const documentNo = await nextDocumentNumber(client, 'maintenance', 'MNT-')
    const result = await client.query(
      `INSERT INTO maintenance_requests
       (room_id,contract_id,reported_by,document_no,description,priority,reported_at)
       VALUES ($1,$2,$3,$4,$5,$6,now())
       RETURNING id,document_no AS "documentNo",description,priority,status`,
      [assignment.rows[0].roomId, input.contractId, request.user!.id, documentNo, input.description, input.priority],
    )
    await client.query('COMMIT')
    response.status(201).json(result.rows[0])
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}))

apiRouter.post('/portal/complaints', requirePermission('tenant.portal'), asyncHandler(async (request, response) => {
  const customerId = request.user!.customerId
  if (!customerId) throw new HttpError(403, 'บัญชีนี้ยังไม่ได้ผูกกับข้อมูลผู้เช่า')
  const input = parseInput(z.object({
    contractId: z.coerce.number().int().positive(),
    description: z.string().trim().min(1).max(5000),
  }), request.body)
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const assignment = await client.query<{ roomId: string }>(
      `SELECT cra.room_id AS "roomId"
       FROM contracts c
       JOIN contract_room_assignments cra ON cra.contract_id=c.id
       WHERE c.id=$1 AND c.customer_id=$2 AND c.status='active'
         AND CURRENT_DATE BETWEEN c.start_date AND c.end_date
         AND cra.start_date<=CURRENT_DATE AND (cra.end_date IS NULL OR cra.end_date>=CURRENT_DATE)
       ORDER BY cra.start_date DESC LIMIT 1 FOR SHARE OF c,cra`,
      [input.contractId, customerId],
    )
    if (!assignment.rowCount) throw new HttpError(404, 'ไม่พบสัญญาที่กำลังใช้งานอยู่')
    const documentNo = await nextDocumentNumber(client, 'complaint', 'CMP-')
    const result = await client.query(
      `INSERT INTO complaints (room_id,contract_id,reported_by,document_no,description,reported_at)
       VALUES ($1,$2,$3,$4,$5,now())
       RETURNING id,document_no AS "documentNo",description,status`,
      [assignment.rows[0].roomId, input.contractId, request.user!.id, documentNo, input.description],
    )
    await client.query('COMMIT')
    response.status(201).json(result.rows[0])
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}))

apiRouter.post('/properties', requirePermission('properties.create'), asyncHandler(async (request, response) => {
  const input = parseInput(propertySchema, request.body)
  const result = await pool.query(
    'INSERT INTO properties (code, name, address) VALUES ($1, $2, $3) RETURNING id, code, name, address',
    [input.code, input.name, input.address || null],
  )
  response.status(201).json(result.rows[0])
}))

apiRouter.post('/buildings', requirePermission('properties.update'), asyncHandler(async (request, response) => {
  const input = parseInput(buildingSchema, request.body)
  const result = await pool.query(
    'INSERT INTO buildings (property_id, code, name) VALUES ($1, $2, $3) RETURNING id, property_id AS "propertyId", code, name',
    [input.propertyId, input.code, input.name],
  )
  response.status(201).json(result.rows[0])
}))

apiRouter.post('/floors', requirePermission('properties.update'), asyncHandler(async (request, response) => {
  const input = parseInput(floorSchema, request.body)
  const result = await pool.query(
    'INSERT INTO floors (building_id, code) VALUES ($1, $2) RETURNING id, building_id AS "buildingId", code',
    [input.buildingId, input.code],
  )
  response.status(201).json(result.rows[0])
}))

apiRouter.post('/room-types', requirePermission('rooms.create'), asyncHandler(async (request, response) => {
  const input = parseInput(roomTypeSchema, request.body)
  const result = await pool.query(
    'INSERT INTO room_types (code, name, default_rent, capacity) VALUES ($1, $2, $3, $4) RETURNING id, code, name, default_rent AS "defaultRent", capacity',
    [input.code, input.name, input.defaultRent, input.capacity],
  )
  response.status(201).json(result.rows[0])
}))

apiRouter.post('/accounts', requirePermission('settings.manage'), asyncHandler(async (request, response) => {
  const input = parseInput(accountSchema, request.body)
  const result = await pool.query(
    `INSERT INTO accounts (code,name,account_type,parent_id) VALUES ($1,$2,$3,$4)
     RETURNING id,code,name,account_type AS "accountType",parent_id AS "parentId"`,
    [input.code, input.name, input.accountType, input.parentId ?? null],
  )
  response.status(201).json(result.rows[0])
}))

apiRouter.post('/bank-accounts', requirePermission('settings.manage'), asyncHandler(async (request, response) => {
  const input = parseInput(bankAccountSchema, request.body)
  const result = await pool.query(
    `INSERT INTO bank_accounts (account_id,code,name,kind,bank_name,account_reference)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING id,account_id AS "accountId",code,name,kind`,
    [input.accountId, input.code, input.name, input.kind, input.bankName || null, input.accountReference || null],
  )
  response.status(201).json(result.rows[0])
}))

apiRouter.post('/charges', requirePermission('settings.manage'), asyncHandler(async (request, response) => {
  const input = parseInput(chargeSchema, request.body)
  const result = await pool.query(
    `INSERT INTO charges (account_id,code,name,category,default_amount,tax_mode,tax_rate)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     RETURNING id,account_id AS "accountId",code,name,category,default_amount AS "defaultAmount",tax_mode AS "taxMode",tax_rate AS "taxRate"`,
    [input.accountId, input.code, input.name, input.category, input.defaultAmount, input.taxMode, input.taxRate],
  )
  response.status(201).json(result.rows[0])
}))

apiRouter.post('/suppliers', requirePermission('settings.manage'), asyncHandler(async (request, response) => {
  const input = parseInput(supplierSchema, request.body)
  const result = await pool.query(
    `INSERT INTO suppliers (code,name,tax_id,phone,address)
     VALUES ($1,$2,$3,$4,$5)
     RETURNING id,code,name,tax_id AS "taxId",phone,address`,
    [input.code, input.name, input.taxId || null, input.phone || null, input.address || null],
  )
  response.status(201).json(result.rows[0])
}))

apiRouter.post('/utility-tariffs', requirePermission('settings.manage'), asyncHandler(async (request, response) => {
  const input = parseInput(tariffSchema, request.body)
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const result = await client.query<{ id: string }>(
      `INSERT INTO utility_tariffs
       (property_id,utility_type,name,pricing_method,unit_rate,fixed_amount,effective_from,effective_to,charge_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
      [input.propertyId, input.utilityType, input.name, input.pricingMethod, input.unitRate, input.fixedAmount, input.effectiveFrom, input.effectiveTo || null, input.chargeId],
    )
    const tariffId = result.rows[0].id
    for (const tier of input.tiers) {
      await client.query(
        'INSERT INTO utility_tariff_tiers (tariff_id,lower_unit,upper_unit,unit_rate) VALUES ($1,$2,$3,$4)',
        [tariffId, tier.lowerUnit, tier.upperUnit ?? null, tier.unitRate],
      )
    }
    await client.query('COMMIT')
    response.status(201).json({ id: tariffId })
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}))

apiRouter.post('/meters', requirePermission('settings.manage'), asyncHandler(async (request, response) => {
  const input = parseInput(meterSchema, request.body)
  const tariff = await pool.query<{ property_id: string; utility_type: string }>(
    `SELECT t.property_id,t.utility_type FROM utility_tariffs t WHERE t.id=$1`,
    [input.tariffId],
  )
  if (!tariff.rowCount) throw new HttpError(404, 'ไม่พบอัตราค่าสาธารณูปโภค')
  const room = await pool.query<{ property_id: string }>(
    `SELECT b.property_id FROM rooms r JOIN floors f ON f.id=r.floor_id
     JOIN buildings b ON b.id=f.building_id WHERE r.id=$1`,
    [input.roomId],
  )
  if (!room.rowCount) throw new HttpError(404, 'ไม่พบห้องพัก')
  if (String(room.rows[0].property_id) !== String(tariff.rows[0].property_id)) {
    throw new HttpError(400, 'อัตราค่าสาธารณูปโภคต้องอยู่ในโครงการเดียวกับห้องพัก')
  }
  const result = await pool.query(
    `INSERT INTO meters (room_id,tariff_id,serial_no,utility_type,rollover_value,installed_at)
     VALUES ($1,$2,$3,$4,$5,$6)
     RETURNING id,room_id AS "roomId",tariff_id AS "tariffId",serial_no AS "serialNo",utility_type AS "utilityType",installed_at AS "installedAt"`,
    [input.roomId, input.tariffId, input.serialNo, tariff.rows[0].utility_type, input.rolloverValue ?? null, input.installedAt],
  )
  response.status(201).json(result.rows[0])
}))

apiRouter.post('/room-utility-tariffs', requirePermission('settings.manage'), asyncHandler(async (request, response) => {
  const input = parseInput(utilityAssignmentSchema, request.body)
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const roomResult = await client.query<{ property_id: string }>(
      `SELECT b.property_id FROM rooms r JOIN floors f ON f.id=r.floor_id
       JOIN buildings b ON b.id=f.building_id WHERE r.id=$1 FOR UPDATE OF r`,
      [input.roomId],
    )
    if (!roomResult.rowCount) throw new HttpError(404, 'ไม่พบห้องพัก')
    const tariffResult = await client.query<{ property_id: string; utility_type: string }>(
      'SELECT property_id,utility_type FROM utility_tariffs WHERE id=$1',
      [input.tariffId],
    )
    if (!tariffResult.rowCount) throw new HttpError(404, 'ไม่พบอัตราค่าสาธารณูปโภค')
    if (String(roomResult.rows[0].property_id) !== String(tariffResult.rows[0].property_id)) {
      throw new HttpError(400, 'อัตราค่าสาธารณูปโภคต้องอยู่ในโครงการเดียวกับห้องพัก')
    }
    const overlap = await client.query(
      `SELECT 1 FROM room_utility_tariffs rut JOIN utility_tariffs t ON t.id=rut.tariff_id
       WHERE rut.room_id=$1 AND t.utility_type=$2
         AND daterange(rut.effective_from,COALESCE(rut.effective_to,'infinity'::date),'[]')
             && daterange($3::date,COALESCE(NULLIF($4,'')::date,'infinity'::date),'[]')
       LIMIT 1`,
      [input.roomId, tariffResult.rows[0].utility_type, input.effectiveFrom, input.effectiveTo ?? ''],
    )
    if (overlap.rowCount) throw new HttpError(409, 'ช่วงเวลาของอัตราค่าสาธารณูปโภคซ้อนกับรายการเดิมของห้องนี้')
    const result = await client.query(
      `INSERT INTO room_utility_tariffs (room_id,tariff_id,effective_from,effective_to)
       VALUES ($1,$2,$3,$4)
       RETURNING id,room_id AS "roomId",tariff_id AS "tariffId",
         effective_from AS "effectiveFrom",effective_to AS "effectiveTo"`,
      [input.roomId, input.tariffId, input.effectiveFrom, input.effectiveTo || null],
    )
    await client.query('COMMIT')
    response.status(201).json(result.rows[0])
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}))

apiRouter.get('/meters', requirePermission('billing.read'), asyncHandler(async (request, response) => {
  const roomId = request.query.roomId ? z.coerce.number().int().positive().parse(request.query.roomId) : undefined
  const result = await pool.query(
    `SELECT m.id, m.room_id AS "roomId", r.code AS "roomCode", m.tariff_id AS "tariffId",
            t.name AS "tariffName", m.serial_no AS "serialNo", m.utility_type AS "utilityType",
            m.rollover_value AS "rolloverValue", m.installed_at AS "installedAt", m.removed_at AS "removedAt"
     FROM meters m JOIN rooms r ON r.id=m.room_id JOIN utility_tariffs t ON t.id=m.tariff_id
     WHERE ($1::bigint IS NULL OR m.room_id=$1) ORDER BY r.code,m.utility_type`,
    [roomId ?? null],
  )
  response.json({ meters: result.rows })
}))

apiRouter.get('/meter-readings', requirePermission('billing.read'), asyncHandler(async (request, response) => {
  const periodId = request.query.billingPeriodId ? z.coerce.number().int().positive().parse(request.query.billingPeriodId) : undefined
  const result = await pool.query(
    `SELECT mr.id,mr.meter_id AS "meterId",mr.billing_period_id AS "billingPeriodId",
            bp.code AS "billingPeriod",r.code AS "roomCode",m.utility_type AS "utilityType",
            mr.previous_value AS "previousValue",mr.current_value AS "currentValue",
            mr.rollover_count AS "rolloverCount",mr.units_used AS "unitsUsed",mr.verified
     FROM meter_readings mr JOIN meters m ON m.id=mr.meter_id
     JOIN rooms r ON r.id=m.room_id JOIN billing_periods bp ON bp.id=mr.billing_period_id
     WHERE ($1::bigint IS NULL OR mr.billing_period_id=$1)
     ORDER BY bp.start_date DESC,r.code,m.utility_type`,
    [periodId ?? null],
  )
  response.json({ meterReadings: result.rows })
}))

apiRouter.get('/billing-periods', requirePermission('billing.read'), asyncHandler(async (_request, response) => {
  const result = await pool.query(
    `SELECT bp.id,bp.property_id AS "propertyId",p.name AS property,bp.code,
            bp.start_date AS "startDate",bp.end_date AS "endDate",bp.status
     FROM billing_periods bp JOIN properties p ON p.id=bp.property_id
     ORDER BY bp.start_date DESC,p.name`,
  )
  response.json({ billingPeriods: result.rows })
}))

apiRouter.post('/billing-periods', requirePermission('billing.create'), asyncHandler(async (request, response) => {
  const input = parseInput(periodSchema, request.body)
  const result = await pool.query(
    `INSERT INTO billing_periods (property_id,code,start_date,end_date)
     VALUES ($1,$2,$3,$4)
     RETURNING id,property_id AS "propertyId",code,start_date AS "startDate",end_date AS "endDate",status`,
    [input.propertyId, input.code, input.startDate, input.endDate],
  )
  response.status(201).json(result.rows[0])
}))

apiRouter.post('/meter-readings', requirePermission('billing.create'), asyncHandler(async (request, response) => {
  const input = parseInput(readingSchema, request.body)
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const meterResult = await client.query<{ room_id: string; rollover_value: string | null }>(
      'SELECT room_id,rollover_value FROM meters WHERE id=$1 FOR UPDATE',
      [input.meterId],
    )
    const meter = meterResult.rows[0]
    if (!meter) throw new HttpError(404, 'ไม่พบเครื่องมิเตอร์')
    const period = await client.query<{ property_id: string; start_date: string; end_date: string; status: string }>(
      'SELECT property_id,start_date,end_date,status FROM billing_periods WHERE id=$1 FOR UPDATE',
      [input.billingPeriodId],
    )
    const billingPeriod = period.rows[0]
    if (!billingPeriod) throw new HttpError(404, 'ไม่พบรอบบิล')
    if (billingPeriod.status !== 'open') throw new HttpError(409, 'รอบบิลปิดแล้ว ไม่สามารถเพิ่มค่าจดมิเตอร์')
    if (input.currentValue < input.previousValue && input.rolloverCount === 0) {
      throw new HttpError(400, 'ค่ามิเตอร์ปัจจุบันต่ำกว่าค่าก่อนหน้า กรุณาระบุจำนวนรอบหมุนอย่างชัดเจน')
    }
    if (input.rolloverCount > 0 && !meter.rollover_value) {
      throw new HttpError(400, 'เครื่องมิเตอร์นี้ยังไม่ได้กำหนดขนาดรอบหมุน')
    }
    const room = await client.query<{ property_id: string }>(
      `SELECT b.property_id FROM rooms r JOIN floors f ON f.id=r.floor_id
       JOIN buildings b ON b.id=f.building_id WHERE r.id=$1`,
      [meter.room_id],
    )
    if (String(room.rows[0].property_id) !== String(billingPeriod.property_id)) {
      throw new HttpError(400, 'เครื่องมิเตอร์และรอบบิลต้องอยู่ในโครงการเดียวกัน')
    }
    const usageResult = await client.query<{ units: string }>(
      'SELECT ($1::numeric-$2::numeric)+($3::numeric*COALESCE($4::numeric,0)) AS units',
      [input.currentValue, input.previousValue, input.rolloverCount, meter.rollover_value],
    )
    const unitsUsed = usageResult.rows[0].units
    if (Number(unitsUsed) < 0) throw new HttpError(400, 'จำนวนหน่วยที่ใช้คำนวณได้ติดลบ กรุณาตรวจค่ามิเตอร์')
    const result = await client.query(
      `INSERT INTO meter_readings
       (meter_id,billing_period_id,recorded_by,read_at,previous_value,current_value,rollover_count,units_used,verified)
       VALUES ($1,$2,$3,now(),$4,$5,$6,$7,false)
       RETURNING id,meter_id AS "meterId",billing_period_id AS "billingPeriodId",
         previous_value AS "previousValue",current_value AS "currentValue",
         rollover_count AS "rolloverCount",units_used AS "unitsUsed",verified`,
      [input.meterId, input.billingPeriodId, request.user!.id, input.previousValue, input.currentValue, input.rolloverCount, unitsUsed],
    )
    await client.query('COMMIT')
    response.status(201).json(result.rows[0])
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}))

apiRouter.patch('/meter-readings/:id/verify', requirePermission('billing.issue'), asyncHandler(async (request, response) => {
  const id = z.coerce.number().int().positive().parse(request.params.id)
  const result = await pool.query(
    `UPDATE meter_readings mr SET verified=true
     FROM billing_periods bp WHERE mr.id=$1 AND mr.billing_period_id=bp.id AND bp.status='open'
     RETURNING mr.id,mr.verified`,
    [id],
  )
  if (!result.rowCount) throw new HttpError(409, 'ไม่พบค่าจดที่รอบบิลยังเปิดอยู่')
  response.json(result.rows[0])
}))

apiRouter.get('/invoices', requirePermission('invoices.read'), asyncHandler(async (_request, response) => {
  const result = await pool.query(
    `SELECT i.id,i.contract_id AS "contractId",i.document_no AS "documentNo",i.status,i.issued_at AS "issuedAt",
            i.due_date AS "dueDate",i.subtotal,i.tax_total AS "taxTotal",i.total,
            i.invoice_kind AS "invoiceKind",i.revision_no AS "revisionNo",
            c.full_name AS "customerName",c.code AS "customerCode",bp.code AS "billingPeriod",
            COALESCE((SELECT jsonb_agg(jsonb_build_object(
                        'id',a.id::text,'fileName',a.file_name,'createdAt',a.created_at
                      ) ORDER BY a.created_at DESC,a.id DESC)
                       FROM attachments a WHERE a.entity_type='invoice' AND a.entity_id=i.id),'[]'::jsonb) AS attachments,
            COALESCE((SELECT SUM(pa.amount) FROM payment_allocations pa
                      JOIN payments pay ON pay.id=pa.payment_id AND pay.status='confirmed'
                      WHERE pa.invoice_id=i.id),0)
            + COALESCE((SELECT SUM(ft.amount) FROM fund_transactions ft
                        WHERE ft.invoice_id=i.id AND ft.transaction_type='apply_invoice' AND ft.status='posted'
                          AND NOT EXISTS (
                            SELECT 1 FROM fund_transactions rev
                            WHERE rev.related_transaction_id=ft.id AND rev.transaction_type='reversal' AND rev.status='posted'
                          )),0) AS "paidAmount"
     FROM invoices i JOIN customers c ON c.id=i.customer_id
     LEFT JOIN billing_periods bp ON bp.id=i.billing_period_id
     ORDER BY i.issued_at DESC,i.id DESC`,
  )
  response.json({ invoices: result.rows })
}))

apiRouter.get('/attachments/:id', requirePermission('invoices.read'), asyncHandler(async (request, response) => {
  const attachmentId = z.coerce.number().int().positive().parse(request.params.id)
  const result = await pool.query<{ objectKey: string; fileName: string; mimeType: string }>(
    `SELECT a.object_key AS "objectKey",a.file_name AS "fileName",a.mime_type AS "mimeType"
     FROM attachments a JOIN invoices i ON a.entity_type='invoice' AND a.entity_id=i.id
     WHERE a.id=$1`,
    [attachmentId],
  )
  if (!result.rowCount) throw new HttpError(404, 'ไม่พบไฟล์แนบ')
  const attachment = result.rows[0]
  if (!/^[0-9a-f-]{36}\.(?:pdf|jpg|png|webp)$/.test(attachment.objectKey)) {
    throw new HttpError(500, 'ข้อมูลไฟล์แนบไม่ถูกต้อง')
  }
  const content = await readFile(path.join(attachmentStoragePath, attachment.objectKey))
  response.set('Content-Type', attachment.mimeType)
    .set('Content-Disposition', `attachment; filename="evidence"; filename*=UTF-8''${encodeURIComponent(attachment.fileName)}`)
    .set('X-Content-Type-Options', 'nosniff')
    .send(content)
}))

apiRouter.get('/invoices/:id/print-data', requirePermission('invoices.read'), asyncHandler(async (request, response) => {
  const invoiceId = z.coerce.number().int().positive().parse(request.params.id)
  const [invoice, items] = await Promise.all([
    pool.query(
      `SELECT id,document_no AS "documentNo",issued_at AS "issuedAt",due_date AS "dueDate",
              status,subtotal,tax_total AS "taxTotal",total,document_snapshot AS snapshot
       FROM invoices WHERE id=$1`,
      [invoiceId],
    ),
    pool.query(
      `SELECT ii.id,ii.description,ii.quantity,ii.unit_price AS "unitPrice",
              ii.net_amount AS "netAmount",ii.tax_rate AS "taxRate",ii.tax_amount AS "taxAmount",
              ii.line_total AS "lineTotal",ii.tax_mode AS "taxMode"
       FROM invoice_items ii WHERE ii.invoice_id=$1 ORDER BY ii.id`,
      [invoiceId],
    ),
  ])
  if (!invoice.rowCount) throw new HttpError(404, 'ไม่พบใบแจ้งหนี้')
  response.json({ invoice: invoice.rows[0], items: items.rows })
}))

apiRouter.post('/invoices/:id/issue', requirePermission('invoices.issue'), asyncHandler(async (request, response) => {
  const invoiceId = z.coerce.number().int().positive().parse(request.params.id)
  const input = parseInput(invoiceIssueSchema, request.body)
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const invoiceResult = await client.query<{
      status: string; document_no: string; customer_id: string; issued_at: string
      due_date: string; subtotal: string; tax_total: string; total: string; document_snapshot: Record<string, unknown>
    }>(
      `SELECT status,document_no,customer_id,issued_at,due_date,subtotal,tax_total,total,document_snapshot
       FROM invoices WHERE id=$1 FOR UPDATE`,
      [invoiceId],
    )
    const invoice = invoiceResult.rows[0]
    if (!invoice) throw new HttpError(404, 'ไม่พบใบแจ้งหนี้')
    if (invoice.status !== 'draft') throw new HttpError(409, 'ออกได้เฉพาะใบแจ้งหนี้ฉบับร่าง')
    if (Number(invoice.total) <= 0) throw new HttpError(409, 'ยอดใบแจ้งหนี้ต้องมากกว่าศูนย์ก่อนออกเอกสาร')
    const totals = await client.query<{ subtotal: string; tax_total: string; total: string }>(
      `SELECT COALESCE(SUM(net_amount),0)::numeric(14,2)::text AS subtotal,
              COALESCE(SUM(tax_amount),0)::numeric(14,2)::text AS tax_total,
              COALESCE(SUM(line_total),0)::numeric(14,2)::text AS total
       FROM invoice_items WHERE invoice_id=$1`,
      [invoiceId],
    )
    if (totals.rows[0].subtotal !== invoice.subtotal || totals.rows[0].tax_total !== invoice.tax_total || totals.rows[0].total !== invoice.total) {
      throw new HttpError(409, 'ยอดรวมใบแจ้งหนี้ไม่ตรงกับยอดรายการ กรุณาสร้างฉบับร่างใหม่หรือตรวจสอบข้อมูล')
    }
    const revenueLines = await client.query<{ account_id: string; amount: string }>(
      `SELECT ch.account_id,SUM(ii.net_amount)::numeric(14,2)::text AS amount
       FROM invoice_items ii JOIN charges ch ON ch.id=ii.charge_id
       WHERE ii.invoice_id=$1 GROUP BY ch.account_id ORDER BY ch.account_id`,
      [invoiceId],
    )
    const accountIds = [...new Set([input.receivableAccountId, ...revenueLines.rows.map((line) => Number(line.account_id)),
      ...(Number(invoice.tax_total) > 0 && input.taxPayableAccountId ? [input.taxPayableAccountId] : [])])]
    const accounts = await client.query<{ id: string; account_type: string }>(
      'SELECT id,account_type FROM accounts WHERE id=ANY($1::bigint[]) ORDER BY id',
      [accountIds],
    )
    if (accounts.rowCount !== accountIds.length) throw new HttpError(400, 'ไม่พบบัญชีที่เลือกหรือบัญชีรายได้ของรายการ')
    const accountTypes = new Map(accounts.rows.map((account) => [account.id, account.account_type]))
    if (accountTypes.get(String(input.receivableAccountId)) !== 'asset') throw new HttpError(400, 'บัญชีลูกหนี้ต้องเป็นประเภทสินทรัพย์')
    if (revenueLines.rows.some((line) => accountTypes.get(line.account_id) !== 'income')) {
      throw new HttpError(409, 'บัญชีของรายการค่าบริการต้องเป็นประเภท income ก่อนออกบิล')
    }
    if (Number(invoice.tax_total) > 0) {
      if (!input.taxPayableAccountId) throw new HttpError(400, 'ใบแจ้งหนี้มีภาษี กรุณาเลือกบัญชีภาษีค้างจ่าย')
      if (accountTypes.get(String(input.taxPayableAccountId)) !== 'liability') throw new HttpError(400, 'บัญชีภาษีค้างจ่ายต้องเป็นประเภทหนี้สิน')
    }
    const journalNo = await nextDocumentNumber(client, 'journal', 'JV-')
    const journal = await client.query<{ id: string }>(
      `INSERT INTO journal_entries (invoice_id,posted_by,document_no,entry_date,description,status)
       VALUES ($1,$2,$3,$4,$5,'posted') RETURNING id`,
      [invoiceId, request.user!.id, journalNo, invoice.issued_at, `ออกใบแจ้งหนี้ ${invoice.document_no}`],
    )
    const journalId = journal.rows[0].id
    const journalLines: { accountId: number; debit: string; credit: string }[] = [
      { accountId: input.receivableAccountId, debit: invoice.total, credit: '0.00' },
      ...revenueLines.rows.filter((line) => Number(line.amount) > 0).map((line) => ({
        accountId: Number(line.account_id), debit: '0.00', credit: line.amount,
      })),
    ]
    if (Number(invoice.tax_total) > 0) {
      journalLines.push({ accountId: input.taxPayableAccountId!, debit: '0.00', credit: invoice.tax_total })
    }
    const journalBalance = await client.query<{ debit: string; credit: string }>(
      `SELECT COALESCE(SUM(x.debit),0)::numeric(14,2)::text AS debit,
              COALESCE(SUM(x.credit),0)::numeric(14,2)::text AS credit
       FROM jsonb_to_recordset($1::jsonb) AS x(debit numeric,credit numeric)`,
      [JSON.stringify(journalLines)],
    )
    if (journalBalance.rows[0].debit !== journalBalance.rows[0].credit || journalLines.length < 2) {
      throw new HttpError(409, 'รายการบัญชีไม่สมดุล ไม่สามารถออกใบแจ้งหนี้ได้')
    }
    for (const line of journalLines) {
      await client.query(
        'INSERT INTO journal_lines (journal_entry_id,account_id,debit,credit) VALUES ($1,$2,$3,$4)',
        [journalId, line.accountId, line.debit, line.credit],
      )
    }
    await client.query(
      `UPDATE invoices SET status='issued',
       document_snapshot=document_snapshot || $1::jsonb WHERE id=$2`,
      [JSON.stringify({ issuedBy: request.user!.id, receivableAccountId: input.receivableAccountId, taxPayableAccountId: input.taxPayableAccountId ?? null }), invoiceId],
    )
    await client.query(
      `INSERT INTO audit_logs (user_id,action,entity_type,entity_id,after_data)
       VALUES ($1,'issue','invoice',$2,$3::jsonb)`,
      [request.user!.id, invoiceId, JSON.stringify({ documentNo: invoice.document_no, journalNo, total: invoice.total })],
    )
    await client.query('COMMIT')
    response.json({ id: invoiceId, status: 'issued', journalNo })
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}))

apiRouter.get('/payments', requirePermission('payments.read'), asyncHandler(async (_request, response) => {
  const result = await pool.query(
    `SELECT p.id,p.document_no AS "documentNo",p.customer_id AS "customerId",
            c.full_name AS "customerName",p.bank_account_id AS "bankAccountId",ba.name AS "bankAccount",
            p.received_at AS "receivedAt",p.amount,p.method,p.reference,p.status,
            rec.id AS "receiptId",rec.document_no AS "receiptNo",
            COALESCE(jsonb_agg(jsonb_build_object(
              'invoiceId',i.id,'documentNo',i.document_no,'amount',pa.amount
            )) FILTER (WHERE pa.id IS NOT NULL),'[]'::jsonb) AS allocations
     FROM payments p JOIN customers c ON c.id=p.customer_id
     JOIN bank_accounts ba ON ba.id=p.bank_account_id
     LEFT JOIN receipts rec ON rec.payment_id=p.id AND rec.status='issued'
     LEFT JOIN payment_allocations pa ON pa.payment_id=p.id
     LEFT JOIN invoices i ON i.id=pa.invoice_id
     GROUP BY p.id,c.full_name,ba.name,rec.document_no
     ORDER BY p.received_at DESC,p.id DESC`,
  )
  response.json({ payments: result.rows })
}))

apiRouter.get('/receipts/:id/print-data', requirePermission('payments.read'), asyncHandler(async (request, response) => {
  const receiptId = z.coerce.number().int().positive().parse(request.params.id)
  const result = await pool.query(
    `SELECT id,document_no AS "documentNo",issued_at AS "issuedAt",status,
            document_snapshot AS snapshot
     FROM receipts WHERE id=$1 AND status='issued'`,
    [receiptId],
  )
  if (!result.rowCount) throw new HttpError(404, 'ไม่พบใบเสร็จ')
  response.json({ receipt: result.rows[0] })
}))

apiRouter.post('/payments', requirePermission('payments.create'), asyncHandler(async (request, response) => {
  const input = parseInput(paymentSchema, request.body)
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const customer = await client.query('SELECT 1 FROM customers WHERE id=$1', [input.customerId])
    if (!customer.rowCount) throw new HttpError(404, 'ไม่พบผู้ชำระเงิน')
    const bank = await client.query(
      `SELECT ba.id,a.account_type FROM bank_accounts ba JOIN accounts a ON a.id=ba.account_id
       WHERE ba.id=$1`,
      [input.bankAccountId],
    )
    if (!bank.rowCount) throw new HttpError(404, 'ไม่พบสมุดเงิน')
    if (bank.rows[0].account_type !== 'asset') throw new HttpError(409, 'บัญชีสมุดเงินต้องเชื่อมกับบัญชีสินทรัพย์')

    for (const allocation of [...input.allocations].sort((a, b) => a.invoiceId - b.invoiceId)) {
      const invoiceResult = await client.query<{
        customer_id: string; status: string; total: string
      }>('SELECT customer_id,status,total FROM invoices WHERE id=$1 FOR UPDATE', [allocation.invoiceId])
      const invoice = invoiceResult.rows[0]
      if (!invoice) throw new HttpError(404, 'ไม่พบใบแจ้งหนี้ที่จัดสรร')
      if (invoice.status !== 'issued') throw new HttpError(409, 'จัดสรรได้เฉพาะใบแจ้งหนี้ที่ออกแล้ว')
      if (String(invoice.customer_id) !== String(input.customerId)) throw new HttpError(400, 'ผู้ชำระเงินต้องตรงกับเจ้าของใบแจ้งหนี้')
      const balance = await client.query<{ cents: string }>(
        `SELECT GREATEST(ROUND(i.total*100)
           -COALESCE((SELECT ROUND(SUM(pa.amount)*100) FROM payment_allocations pa
                      JOIN payments p ON p.id=pa.payment_id AND p.status='confirmed'
                      WHERE pa.invoice_id=i.id),0)
           -COALESCE((SELECT ROUND(SUM(ft.amount)*100) FROM fund_transactions ft
                      WHERE ft.invoice_id=i.id AND ft.transaction_type='apply_invoice' AND ft.status='posted'),0),0)::bigint::text AS cents
         FROM invoices i WHERE i.id=$1`,
        [allocation.invoiceId],
      )
      if (BigInt(Math.round(allocation.amount * 100)) > BigInt(balance.rows[0].cents)) {
        throw new HttpError(409, `ยอดจัดสรรเกินยอดค้างของใบแจ้งหนี้ ${allocation.invoiceId}`)
      }
    }
    const paymentNo = await nextDocumentNumber(client, 'payment', 'PAY-')
    const paymentResult = await client.query<{ id: string }>(
      `INSERT INTO payments
       (customer_id,bank_account_id,received_by,document_no,received_at,amount,method,reference,status)
       VALUES ($1,$2,$3,$4,now(),$5,$6,$7,'pending') RETURNING id`,
      [input.customerId, input.bankAccountId, request.user!.id, paymentNo, input.amount, input.method, input.reference || null],
    )
    const paymentId = paymentResult.rows[0].id
    for (const allocation of input.allocations) {
      await client.query(
        'INSERT INTO payment_allocations (payment_id,invoice_id,amount) VALUES ($1,$2,$3)',
        [paymentId, allocation.invoiceId, allocation.amount],
      )
    }
    await client.query(
      `INSERT INTO audit_logs (user_id,action,entity_type,entity_id,after_data)
       VALUES ($1,'create','payment',$2,$3::jsonb)`,
      [request.user!.id, paymentId, JSON.stringify({ documentNo: paymentNo, amount: input.amount, status: 'pending' })],
    )
    await client.query('COMMIT')
    response.status(201).json({ id: paymentId, documentNo: paymentNo, status: 'pending' })
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}))

apiRouter.post('/payments/:id/confirm', requirePermission('payments.confirm'), asyncHandler(async (request, response) => {
  const paymentId = z.coerce.number().int().positive().parse(request.params.id)
  const input = parseInput(paymentConfirmationSchema, request.body)
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const paymentResult = await client.query<{
      document_no: string; customer_id: string; bank_account_id: string; amount: string
      method: string; reference: string | null; status: string; received_at: string
    }>(
      `SELECT document_no,customer_id,bank_account_id,amount,method,reference,status,received_at
       FROM payments WHERE id=$1 FOR UPDATE`,
      [paymentId],
    )
    const payment = paymentResult.rows[0]
    if (!payment) throw new HttpError(404, 'ไม่พบรายการรับชำระ')
    if (payment.status !== 'pending') throw new HttpError(409, 'ยืนยันได้เฉพาะรายการรับชำระที่ยังรอตรวจ')
    const allocationResult = await client.query<{ invoice_id: string; amount: string }>(
      'SELECT invoice_id,amount FROM payment_allocations WHERE payment_id=$1 ORDER BY invoice_id FOR UPDATE',
      [paymentId],
    )
    const allocatedCents = await client.query<{ cents: string }>(
      'SELECT COALESCE(ROUND(SUM(amount)*100),0)::bigint::text AS cents FROM payment_allocations WHERE payment_id=$1',
      [paymentId],
    )
    const allocationCents = BigInt(allocatedCents.rows[0].cents)
    const paymentCents = BigInt(Math.round(Number(payment.amount) * 100))
    if (allocationCents > paymentCents) throw new HttpError(409, 'ยอดจัดสรรเกินยอดรับชำระ')

    const invoiceRows: { id: string; document_no: string; total: string; status: string; customer_id: string }[] = []
    for (const allocation of allocationResult.rows) {
      const result = await client.query<{
        id: string; document_no: string; total: string; status: string; customer_id: string
      }>('SELECT id,document_no,total,status,customer_id FROM invoices WHERE id=$1 FOR UPDATE', [allocation.invoice_id])
      if (!result.rowCount) throw new HttpError(404, 'ไม่พบใบแจ้งหนี้ที่จัดสรร')
      const invoice = result.rows[0]
      if (invoice.status !== 'issued') throw new HttpError(409, `ใบแจ้งหนี้ ${invoice.document_no} ไม่ได้อยู่ในสถานะออกแล้ว`)
      if (String(invoice.customer_id) !== String(payment.customer_id)) throw new HttpError(409, 'ผู้ชำระเงินไม่ตรงกับใบแจ้งหนี้')
      const balance = await client.query<{ cents: string }>(
        `SELECT GREATEST(ROUND(i.total*100)
           -COALESCE((SELECT ROUND(SUM(pa.amount)*100) FROM payment_allocations pa
                      JOIN payments p ON p.id=pa.payment_id AND p.status='confirmed'
                      WHERE pa.invoice_id=i.id),0)
           -COALESCE((SELECT ROUND(SUM(ft.amount)*100) FROM fund_transactions ft
                      WHERE ft.invoice_id=i.id AND ft.transaction_type='apply_invoice' AND ft.status='posted'),0),0)::bigint::text AS cents
         FROM invoices i WHERE i.id=$1`,
        [invoice.id],
      )
      const requested = BigInt(Math.round(Number(allocation.amount) * 100))
      if (requested > BigInt(balance.rows[0].cents)) throw new HttpError(409, `ยอดจัดสรรเกินยอดค้างของใบแจ้งหนี้ ${invoice.document_no}`)
      invoiceRows.push(invoice)
    }

    const bankResult = await client.query<{ account_id: string; account_type: string }>(
      `SELECT ba.account_id,a.account_type FROM bank_accounts ba JOIN accounts a ON a.id=ba.account_id
       WHERE ba.id=$1 FOR UPDATE OF ba`,
      [payment.bank_account_id],
    )
    if (!bankResult.rowCount || bankResult.rows[0].account_type !== 'asset') throw new HttpError(409, 'สมุดเงินต้องเชื่อมกับบัญชีสินทรัพย์')
    const receivable = await client.query<{ account_type: string }>(
      'SELECT account_type FROM accounts WHERE id=$1',
      [input.receivableAccountId],
    )
    if (!receivable.rowCount || receivable.rows[0].account_type !== 'asset') throw new HttpError(400, 'บัญชีลูกหนี้ต้องเป็นประเภทสินทรัพย์')
    const unallocatedCents = paymentCents - allocationCents
    if (unallocatedCents > 0n) {
      if (!input.advanceLiabilityAccountId) throw new HttpError(400, 'ยอดรับที่ยังไม่จัดสรรต้องเลือกบัญชีหนี้สินเงินรับล่วงหน้า')
      const liability = await client.query<{ account_type: string }>(
        'SELECT account_type FROM accounts WHERE id=$1',
        [input.advanceLiabilityAccountId],
      )
      if (!liability.rowCount || liability.rows[0].account_type !== 'liability') throw new HttpError(400, 'บัญชีเงินรับล่วงหน้าต้องเป็นประเภทหนี้สิน')
    }
    const journalNo = await nextDocumentNumber(client, 'journal', 'JV-')
    const journalResult = await client.query<{ id: string }>(
      `INSERT INTO journal_entries (payment_id,posted_by,document_no,entry_date,description,status)
       VALUES ($1,$2,$3,$4::date,$5,'posted') RETURNING id`,
      [paymentId, request.user!.id, journalNo, payment.received_at, `ยืนยันรับชำระ ${payment.document_no}`],
    )
    const journalId = journalResult.rows[0].id
    const lines: { accountId: string; debit: string; credit: string }[] = [
      { accountId: bankResult.rows[0].account_id, debit: payment.amount, credit: '0.00' },
    ]
    const allocatedAmount = await client.query<{ amount: string }>(
      'SELECT COALESCE(SUM(amount),0)::numeric(14,2)::text AS amount FROM payment_allocations WHERE payment_id=$1',
      [paymentId],
    )
    if (Number(allocatedAmount.rows[0].amount) > 0) {
      lines.push({ accountId: String(input.receivableAccountId), debit: '0.00', credit: allocatedAmount.rows[0].amount })
    }
    if (unallocatedCents > 0n) {
      lines.push({
        accountId: String(input.advanceLiabilityAccountId),
        debit: '0.00',
        credit: (Number(unallocatedCents) / 100).toFixed(2),
      })
    }
    const balance = await client.query<{ debit: string; credit: string }>(
      `SELECT COALESCE(SUM(x.debit),0)::numeric(14,2)::text AS debit,
              COALESCE(SUM(x.credit),0)::numeric(14,2)::text AS credit
       FROM jsonb_to_recordset($1::jsonb) AS x(debit numeric,credit numeric)`,
      [JSON.stringify(lines)],
    )
    if (balance.rows[0].debit !== balance.rows[0].credit || lines.length < 2) {
      throw new HttpError(409, 'รายการบัญชีไม่สมดุล ไม่สามารถยืนยันรับชำระ')
    }
    for (const line of lines) {
      await client.query(
        'INSERT INTO journal_lines (journal_entry_id,account_id,debit,credit) VALUES ($1,$2,$3,$4)',
        [journalId, line.accountId, line.debit, line.credit],
      )
    }
    const receiptNo = await nextDocumentNumber(client, 'receipt', 'RCT-')
    const snapshot = await client.query(
      `SELECT p.document_no AS "paymentNo",c.full_name AS "customerName",c.address,
              p.amount,p.method,p.reference,p.received_at AS "receivedAt",
              COALESCE(jsonb_agg(jsonb_build_object(
                'documentNo',i.document_no,'amount',pa.amount
              )) FILTER (WHERE pa.id IS NOT NULL),'[]'::jsonb) AS allocations
       FROM payments p JOIN customers c ON c.id=p.customer_id
       LEFT JOIN payment_allocations pa ON pa.payment_id=p.id
       LEFT JOIN invoices i ON i.id=pa.invoice_id
       WHERE p.id=$1 GROUP BY p.id,c.full_name,c.address`,
      [paymentId],
    )
    const receiptResult = await client.query<{ id: string }>(
      `INSERT INTO receipts (payment_id,document_no,issued_at,status,document_snapshot)
       VALUES ($1,$2,now(),'issued',$3::jsonb) RETURNING id`,
      [paymentId, receiptNo, JSON.stringify(snapshot.rows[0])],
    )
    await client.query("UPDATE payments SET status='confirmed' WHERE id=$1", [paymentId])
    await client.query(
      `INSERT INTO audit_logs (user_id,action,entity_type,entity_id,after_data)
       VALUES ($1,'confirm','payment',$2,$3::jsonb)`,
      [request.user!.id, paymentId, JSON.stringify({ documentNo: payment.document_no, receiptNo, journalNo, total: payment.amount })],
    )
    await client.query('COMMIT')
    response.json({ id: paymentId, status: 'confirmed', receiptId: receiptResult.rows[0].id, receiptNo, journalNo })
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}))

apiRouter.post('/payments/:id/void', requirePermission('payments.confirm'), asyncHandler(async (request, response) => {
  const paymentId = z.coerce.number().int().positive().parse(request.params.id)
  const input = parseInput(paymentVoidSchema, request.body)
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const paymentResult = await client.query<{ document_no: string; status: string }>(
      'SELECT document_no,status FROM payments WHERE id=$1 FOR UPDATE',
      [paymentId],
    )
    const payment = paymentResult.rows[0]
    if (!payment) throw new HttpError(404, 'ไม่พบรายการรับชำระ')
    if (payment.status === 'void') throw new HttpError(409, 'รายการรับชำระถูกยกเลิกแล้ว')
    if (payment.status === 'confirmed') {
      const original = await client.query<{ id: string; entry_date: string }>(
        `SELECT id,entry_date FROM journal_entries
         WHERE payment_id=$1 AND reverses_id IS NULL AND status='posted' FOR UPDATE`,
        [paymentId],
      )
      if (!original.rowCount) throw new HttpError(409, 'ไม่พบรายการบัญชีต้นทางที่ลงบัญชีแล้ว')
      const priorReversal = await client.query(
        'SELECT 1 FROM journal_entries WHERE reverses_id=$1 AND status=\'posted\'',
        [original.rows[0].id],
      )
      if (priorReversal.rowCount) throw new HttpError(409, 'รายการบัญชีนี้ถูกกลับรายการไปแล้ว')
      const sourceLines = await client.query<{ account_id: string; debit: string; credit: string }>(
        'SELECT account_id,debit,credit FROM journal_lines WHERE journal_entry_id=$1 ORDER BY id',
        [original.rows[0].id],
      )
      if ((sourceLines.rowCount ?? 0) < 2) throw new HttpError(409, 'รายการบัญชีต้นทางไม่สมบูรณ์ ไม่สามารถกลับรายการ')
      const reversalNo = await nextDocumentNumber(client, 'journal-reversal', 'JVR-')
      const reversal = await client.query<{ id: string }>(
        `INSERT INTO journal_entries
         (payment_id,reverses_id,posted_by,document_no,entry_date,description,status)
         VALUES ($1,$2,$3,$4,CURRENT_DATE,$5,'posted') RETURNING id`,
        [paymentId, original.rows[0].id, request.user!.id, reversalNo, `กลับรายการ ${payment.document_no}: ${input.reason}`],
      )
      for (const line of sourceLines.rows) {
        await client.query(
          'INSERT INTO journal_lines (journal_entry_id,account_id,debit,credit) VALUES ($1,$2,$3,$4)',
          [reversal.rows[0].id, line.account_id, line.credit, line.debit],
        )
      }
      const receipt = await client.query<{ id: string }>(
        "UPDATE receipts SET status='void' WHERE payment_id=$1 AND status='issued' RETURNING id",
        [paymentId],
      )
      if (!receipt.rowCount) throw new HttpError(409, 'ไม่พบใบเสร็จที่ยังใช้งานอยู่')
    }
    await client.query("UPDATE payments SET status='void' WHERE id=$1", [paymentId])
    await client.query(
      `INSERT INTO audit_logs (user_id,action,entity_type,entity_id,after_data)
       VALUES ($1,'void','payment',$2,$3::jsonb)`,
      [request.user!.id, paymentId, JSON.stringify({ documentNo: payment.document_no, reason: input.reason })],
    )
    await client.query('COMMIT')
    response.json({ id: paymentId, status: 'void' })
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}))

apiRouter.get('/fund-transactions', requirePermission('funds.read'), asyncHandler(async (_request, response) => {
  const result = await pool.query(
    `SELECT ft.id,ft.document_no AS "documentNo",ft.fund_type AS "fundType",
            ft.transaction_type AS "transactionType",ft.amount,ft.occurred_at AS "occurredAt",
            ft.status,ft.booking_id AS "bookingId",ft.contract_id AS "contractId",
            ft.invoice_id AS "invoiceId",ft.method,ft.related_transaction_id AS "relatedTransactionId",
            COALESCE(c.full_name,'') AS "customerName",
            COALESCE(con.document_no,bk.document_no,'') AS "sourceDocument",
            i.document_no AS "invoiceNo"
     FROM fund_transactions ft
     LEFT JOIN contracts con ON con.id=ft.contract_id
     LEFT JOIN bookings bk ON bk.id=ft.booking_id
     LEFT JOIN customers c ON c.id=COALESCE(con.customer_id,bk.customer_id)
     LEFT JOIN invoices i ON i.id=ft.invoice_id
     ORDER BY ft.occurred_at DESC,ft.id DESC`,
  )
  response.json({ fundTransactions: result.rows })
}))

apiRouter.post('/fund-transactions', requirePermission('funds.confirm'), asyncHandler(async (request, response) => {
  const input = parseInput(fundTransactionSchema, request.body)
  const owner = { bookingId: input.bookingId, contractId: input.contractId }
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    if (input.bookingId) {
      const booking = await client.query('SELECT id FROM bookings WHERE id=$1 FOR UPDATE', [input.bookingId])
      if (!booking.rowCount) throw new HttpError(404, 'ไม่พบรายการจอง')
    } else {
      const contract = await client.query('SELECT id FROM contracts WHERE id=$1 FOR UPDATE', [input.contractId])
      if (!contract.rowCount) throw new HttpError(404, 'ไม่พบสัญญาเช่า')
    }
    const liability = await client.query<{ account_type: string }>(
      'SELECT account_type FROM accounts WHERE id=$1',
      [input.liabilityAccountId],
    )
    if (!liability.rowCount || liability.rows[0].account_type !== 'liability') {
      throw new HttpError(400, 'บัญชีกองเงินต้องเป็นประเภทหนี้สิน')
    }
    let bankAccountId: number | null = null
    let bankGlAccountId: string | null = null
    if (input.transactionType === 'receive' || input.transactionType === 'refund') {
      const bank = await client.query<{ account_id: string; account_type: string }>(
        `SELECT ba.account_id,a.account_type FROM bank_accounts ba JOIN accounts a ON a.id=ba.account_id
         WHERE ba.id=$1 FOR UPDATE OF ba`,
        [input.bankAccountId],
      )
      if (!bank.rowCount || bank.rows[0].account_type !== 'asset') {
        throw new HttpError(400, 'สมุดเงินต้องเชื่อมกับบัญชีสินทรัพย์')
      }
      bankAccountId = input.bankAccountId!
      bankGlAccountId = bank.rows[0].account_id
    }
    let invoiceNo: string | null = null
    if (input.transactionType === 'apply_invoice') {
      const contract = await client.query<{ customer_id: string }>(
        'SELECT customer_id FROM contracts WHERE id=$1',
        [input.contractId],
      )
      const invoice = await client.query<{ contract_id: string; customer_id: string; document_no: string; status: string; total: string }>(
        `SELECT contract_id,customer_id,document_no,status,total FROM invoices WHERE id=$1 FOR UPDATE`,
        [input.invoiceId],
      )
      if (!invoice.rowCount) throw new HttpError(404, 'ไม่พบใบแจ้งหนี้')
      if (invoice.rows[0].status !== 'issued' || String(invoice.rows[0].contract_id) !== String(input.contractId)
        || String(invoice.rows[0].customer_id) !== String(contract.rows[0].customer_id)) {
        throw new HttpError(409, 'เงินกองใช้ได้กับใบแจ้งหนี้ที่ออกแล้วของสัญญาเดียวกันเท่านั้น')
      }
      const receivable = await client.query<{ account_type: string }>(
        'SELECT account_type FROM accounts WHERE id=$1',
        [input.receivableAccountId],
      )
      if (!receivable.rowCount || receivable.rows[0].account_type !== 'asset') {
        throw new HttpError(400, 'บัญชีลูกหนี้ต้องเป็นประเภทสินทรัพย์')
      }
      const due = await client.query<{ balance: string }>(
        `SELECT GREATEST(i.total
          -COALESCE((SELECT SUM(pa.amount) FROM payment_allocations pa
                     JOIN payments p ON p.id=pa.payment_id AND p.status='confirmed'
                     WHERE pa.invoice_id=i.id),0)
          -COALESCE((SELECT SUM(ft.amount) FROM fund_transactions ft
                     WHERE ft.invoice_id=i.id AND ft.transaction_type='apply_invoice' AND ft.status='posted'
                       AND NOT EXISTS (SELECT 1 FROM fund_transactions rev
                                       WHERE rev.related_transaction_id=ft.id AND rev.transaction_type='reversal' AND rev.status='posted')),0),
          0)::numeric(14,2)::text AS balance
         FROM invoices i WHERE i.id=$1`,
        [input.invoiceId],
      )
      const exceedsDue = await client.query<{ exceeds: boolean }>(
        'SELECT $1::numeric>$2::numeric AS exceeds',
        [input.amount, due.rows[0].balance],
      )
      if (exceedsDue.rows[0].exceeds) {
        throw new HttpError(409, `ยอดหักเกินยอดค้างของใบแจ้งหนี้ ${invoice.rows[0].document_no}`)
      }
      invoiceNo = invoice.rows[0].document_no
    }
    if (input.transactionType === 'refund' || input.transactionType === 'apply_invoice') {
      const available = await fundBalance(client, input.fundType, owner)
      const exceedsFund = await client.query<{ exceeds: boolean }>(
        'SELECT $1::numeric>$2::numeric AS exceeds',
        [input.amount, available],
      )
      if (exceedsFund.rows[0].exceeds) {
        throw new HttpError(409, `ยอดเงินกองคงเหลือ ฿${available} ไม่เพียงพอ`)
      }
    }
    const documentNo = await nextDocumentNumber(client, 'fund', 'FND-')
    const transaction = await client.query<{ id: string }>(
      `INSERT INTO fund_transactions
       (booking_id,contract_id,invoice_id,bank_account_id,recorded_by,document_no,
        fund_type,transaction_type,amount,occurred_at,status,method)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,now(),'posted',$10) RETURNING id`,
      [input.bookingId ?? null, input.contractId ?? null, input.invoiceId ?? null,
        bankAccountId, request.user!.id, documentNo, input.fundType, input.transactionType,
        input.amount, input.method ?? null],
    )
    const transactionId = transaction.rows[0].id
    const journalNo = await nextDocumentNumber(client, 'journal', 'JV-')
    const journal = await client.query<{ id: string }>(
      `INSERT INTO journal_entries
       (fund_transaction_id,posted_by,document_no,entry_date,description,status)
       VALUES ($1,$2,$3,CURRENT_DATE,$4,'posted') RETURNING id`,
      [transactionId, request.user!.id, journalNo, `${input.transactionType} ${input.fundType} ${documentNo}`],
    )
    const journalLines = input.transactionType === 'receive'
      ? [
          { accountId: bankGlAccountId!, debit: input.amount, credit: 0 },
          { accountId: String(input.liabilityAccountId), debit: 0, credit: input.amount },
        ]
      : input.transactionType === 'refund'
        ? [
            { accountId: String(input.liabilityAccountId), debit: input.amount, credit: 0 },
            { accountId: bankGlAccountId!, debit: 0, credit: input.amount },
          ]
        : [
            { accountId: String(input.liabilityAccountId), debit: input.amount, credit: 0 },
            { accountId: String(input.receivableAccountId), debit: 0, credit: input.amount },
          ]
    for (const line of journalLines) {
      await client.query(
        'INSERT INTO journal_lines (journal_entry_id,account_id,debit,credit) VALUES ($1,$2,$3,$4)',
        [journal.rows[0].id, line.accountId, line.debit, line.credit],
      )
    }
    await client.query(
      `INSERT INTO audit_logs (user_id,action,entity_type,entity_id,after_data)
       VALUES ($1,$2,'fund_transaction',$3,$4::jsonb)`,
      [request.user!.id, input.transactionType, transactionId, JSON.stringify({
        documentNo, fundType: input.fundType, amount: input.amount, invoiceNo,
      })],
    )
    await client.query('COMMIT')
    response.status(201).json({ id: transactionId, documentNo, status: 'posted', journalNo })
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}))

apiRouter.post('/fund-transactions/:id/reverse', requirePermission('funds.confirm'), asyncHandler(async (request, response) => {
  const transactionId = z.coerce.number().int().positive().parse(request.params.id)
  const input = parseInput(fundReverseSchema, request.body)
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const selected = await client.query<{
      id: string
      booking_id: string | null
      contract_id: string | null
      document_no: string
      fund_type: 'reservation' | 'deposit' | 'advance'
      transaction_type: string
      amount: string
      related_transaction_id: string | null
      status: string
    }>(
      `SELECT id,booking_id,contract_id,document_no,fund_type,transaction_type,amount,related_transaction_id,status
       FROM fund_transactions WHERE id=$1`,
      [transactionId],
    )
    let selectedRow = selected.rows[0]
    if (!selectedRow) throw new HttpError(404, 'ไม่พบรายการเงินกอง')

    let originals = [selectedRow]
    let journalSourceId = selectedRow.id
    if (selectedRow.transaction_type === 'transfer_in' || selectedRow.transaction_type === 'transfer_out') {
      if (!selectedRow.related_transaction_id) throw new HttpError(409, 'รายการโอนไม่มีรายการคู่ที่เชื่อมโยง')
      const pairIds = [selectedRow.id, selectedRow.related_transaction_id]
      const pair = await client.query<typeof selectedRow>(
        `SELECT id,booking_id,contract_id,document_no,fund_type,transaction_type,amount,
                related_transaction_id,status
         FROM fund_transactions WHERE id=ANY($1::bigint[]) ORDER BY id FOR UPDATE`,
        [pairIds],
      )
      if (pair.rowCount !== 2
        || pair.rows.some((row) => row.status !== 'posted'
          || row.fund_type !== selectedRow.fund_type
          || row.amount !== selectedRow.amount
          || row.related_transaction_id !== (row.id === selectedRow.id
            ? selectedRow.related_transaction_id
            : selectedRow.id))
        || !pair.rows.some((row) => row.transaction_type === 'transfer_in')
        || !pair.rows.some((row) => row.transaction_type === 'transfer_out')) {
        throw new HttpError(409, 'รายการโอนไม่ครบคู่หรือข้อมูลคู่รายการไม่ตรงกัน')
      }
      originals = pair.rows
      selectedRow = pair.rows.find((row) => row.id === String(transactionId))!
      const outgoing = pair.rows.find((row) => row.transaction_type === 'transfer_out')
      if (!outgoing) throw new HttpError(409, 'ไม่พบรายการโอนออก')
      journalSourceId = outgoing.id
    } else {
      const locked = await client.query<typeof selectedRow>(
        `SELECT id,booking_id,contract_id,document_no,fund_type,transaction_type,amount,
                related_transaction_id,status
         FROM fund_transactions WHERE id=$1 FOR UPDATE`,
        [transactionId],
      )
      selectedRow = locked.rows[0]
      if (!selectedRow) throw new HttpError(404, 'ไม่พบรายการเงินกอง')
      originals = [selectedRow]
      if (selectedRow.related_transaction_id) {
        throw new HttpError(409, 'รายการมีความสัมพันธ์ที่ไม่คาดหมาย')
      }
    }
    if (originals.some((row) => row.status !== 'posted')) {
      throw new HttpError(409, 'กลับรายการได้เฉพาะรายการที่ลงบัญชีแล้ว')
    }
    if (selectedRow.transaction_type === 'reversal') throw new HttpError(409, 'รายการกลับบัญชีแล้วไม่สามารถกลับซ้ำ')
    if (!['receive', 'refund', 'apply_invoice', 'transfer_in', 'transfer_out'].includes(selectedRow.transaction_type)) {
      throw new HttpError(409, 'ประเภทรายการนี้ไม่รองรับการกลับรายการ')
    }

    const bookingIds = [...new Set(originals.flatMap((row) => row.booking_id ? [row.booking_id] : []))].sort((a, b) => Number(a) - Number(b))
    const contractIds = [...new Set(originals.flatMap((row) => row.contract_id ? [row.contract_id] : []))].sort((a, b) => Number(a) - Number(b))
    if (bookingIds.length) {
      const locked = await client.query('SELECT id FROM bookings WHERE id=ANY($1::bigint[]) ORDER BY id FOR UPDATE', [bookingIds])
      if (locked.rowCount !== bookingIds.length) throw new HttpError(409, 'ไม่พบรายการจองที่อ้างอิง')
    }
    if (contractIds.length) {
      const locked = await client.query('SELECT id FROM contracts WHERE id=ANY($1::bigint[]) ORDER BY id FOR UPDATE', [contractIds])
      if (locked.rowCount !== contractIds.length) throw new HttpError(409, 'ไม่พบสัญญาที่อ้างอิง')
    }
    const originalIds = originals.map((row) => row.id)
    const priorReversal = await client.query(
      `SELECT 1 FROM fund_transactions
       WHERE related_transaction_id=ANY($1::bigint[]) AND transaction_type='reversal' AND status='posted'`,
      [originalIds],
    )
    if (priorReversal.rowCount) throw new HttpError(409, 'รายการนี้หรือรายการคู่ถูกกลับรายการไปแล้ว')
    const journalResult = await client.query<{ id: string }>(
      `SELECT id FROM journal_entries
       WHERE fund_transaction_id=$1 AND reverses_id IS NULL AND status='posted' FOR UPDATE`,
      [journalSourceId],
    )
    if (!journalResult.rowCount) throw new HttpError(409, 'ไม่พบสมุดรายวันที่ลงบัญชีรายการนี้')
    const originalJournalId = journalResult.rows[0].id
    const sourceLines = await client.query<{ account_id: string; debit: string; credit: string }>(
      'SELECT account_id,debit,credit FROM journal_lines WHERE journal_entry_id=$1 ORDER BY id',
      [originalJournalId],
    )
    if ((sourceLines.rowCount ?? 0) < 2) throw new HttpError(409, 'สมุดรายวันต้นทางไม่สมบูรณ์')

    const reversalDocuments: string[] = []
    for (const original of originals) {
      const documentNo = await nextDocumentNumber(client, 'fund-reversal', 'FND-REV-')
      reversalDocuments.push(documentNo)
      await client.query(
        `INSERT INTO fund_transactions
         (booking_id,contract_id,recorded_by,document_no,fund_type,transaction_type,amount,occurred_at,
          related_transaction_id,status)
         VALUES ($1,$2,$3,$4,$5,'reversal',$6,now(),$7,'posted')`,
        [original.booking_id, original.contract_id, request.user!.id, documentNo,
          original.fund_type, original.amount, original.id],
      )
    }
    const reversalNo = await nextDocumentNumber(client, 'journal-reversal', 'JVR-')
    const reversal = await client.query<{ id: string }>(
      `INSERT INTO journal_entries
       (reverses_id,posted_by,document_no,entry_date,description,status)
       VALUES ($1,$2,$3,CURRENT_DATE,$4,'posted') RETURNING id`,
      [originalJournalId, request.user!.id, reversalNo,
        `กลับรายการ ${originals.map((row) => row.document_no).join('/')} : ${input.reason}`],
    )
    for (const line of sourceLines.rows) {
      await client.query(
        'INSERT INTO journal_lines (journal_entry_id,account_id,debit,credit) VALUES ($1,$2,$3,$4)',
        [reversal.rows[0].id, line.account_id, line.credit, line.debit],
      )
    }
    await client.query(
      `INSERT INTO audit_logs (user_id,action,entity_type,entity_id,after_data)
       VALUES ($1,'reverse','fund_transaction',$2,$3::jsonb)`,
      [request.user!.id, transactionId, JSON.stringify({
        originalDocuments: originals.map((row) => row.document_no),
        reversalDocuments, reversalNo, reason: input.reason,
      })],
    )
    await client.query('COMMIT')
    response.json({ id: transactionId, reversalDocuments, journalNo: reversalNo, status: 'reversed' })
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}))

apiRouter.post('/fund-transactions/transfer', requirePermission('funds.confirm'), asyncHandler(async (request, response) => {
  const input = parseInput(fundTransferSchema, request.body)
  const source = { bookingId: input.fromBookingId }
  const destination = { contractId: input.toContractId }
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const booking = await client.query('SELECT id FROM bookings WHERE id=$1 FOR UPDATE', [input.fromBookingId])
    const contract = await client.query('SELECT id FROM contracts WHERE id=$1 FOR UPDATE', [input.toContractId])
    if (!booking.rowCount || !contract.rowCount) {
      throw new HttpError(404, 'ไม่พบแหล่งเงินหรือปลายทาง')
    }
    const bookingOwner = await client.query<{ customer_id: string }>('SELECT customer_id FROM bookings WHERE id=$1', [input.fromBookingId])
    const contractOwner = await client.query<{ customer_id: string }>('SELECT customer_id FROM contracts WHERE id=$1', [input.toContractId])
    if (!bookingOwner.rows[0]?.customer_id || bookingOwner.rows[0].customer_id !== contractOwner.rows[0]?.customer_id) {
      throw new HttpError(400, 'โอนเงินกองได้เฉพาะระหว่างรายการของผู้เช่าคนเดียวกัน')
    }
    const available = await fundBalance(client, input.fromFundType, source)
    const amountExceeds = await client.query<{ exceeds: boolean }>(
      'SELECT $1::numeric>$2::numeric AS exceeds',
      [input.amount, available],
    )
    if (amountExceeds.rows[0].exceeds) throw new HttpError(409, `ยอดเงินกองคงเหลือ ฿${available} ไม่เพียงพอ`)

    const accounts = await client.query<{ id: string; account_type: string }>(
      'SELECT id,account_type FROM accounts WHERE id=ANY($1::bigint[])',
      [[input.sourceLiabilityAccountId, input.destinationLiabilityAccountId]],
    )
    if (accounts.rowCount !== new Set([input.sourceLiabilityAccountId, input.destinationLiabilityAccountId]).size
      || accounts.rows.some((account) => account.account_type !== 'liability')) {
      throw new HttpError(400, 'บัญชีต้นทางและปลายทางของเงินกองต้องเป็นบัญชีหนี้สิน')
    }

    const outDocumentNo = await nextDocumentNumber(client, 'fund-transfer-out', 'FND-OUT-')
    const outResult = await client.query<{ id: string }>(
      `INSERT INTO fund_transactions
       (booking_id,contract_id,recorded_by,document_no,fund_type,transaction_type,amount,occurred_at,status)
       VALUES ($1,$2,$3,$4,$5,'transfer_out',$6,now(),'posted') RETURNING id`,
      [input.fromBookingId, null, request.user!.id, outDocumentNo, input.fromFundType, input.amount],
    )
    const inDocumentNo = await nextDocumentNumber(client, 'fund-transfer-in', 'FND-IN-')
    const inResult = await client.query<{ id: string }>(
      `INSERT INTO fund_transactions
       (booking_id,contract_id,recorded_by,document_no,fund_type,transaction_type,amount,occurred_at,
        related_transaction_id,status)
       VALUES ($1,$2,$3,$4,$5,'transfer_in',$6,now(),$7,'posted') RETURNING id`,
      [null, input.toContractId, request.user!.id,
        inDocumentNo, input.toFundType, input.amount, outResult.rows[0].id],
    )
    await client.query(
      'UPDATE fund_transactions SET related_transaction_id=$1 WHERE id=$2',
      [inResult.rows[0].id, outResult.rows[0].id],
    )
    const journalNo = await nextDocumentNumber(client, 'journal', 'JV-')
    const journal = await client.query<{ id: string }>(
      `INSERT INTO journal_entries
       (fund_transaction_id,posted_by,document_no,entry_date,description,status)
       VALUES ($1,$2,$3,CURRENT_DATE,$4,'posted') RETURNING id`,
      [outResult.rows[0].id, request.user!.id, journalNo, `Transfer ${outDocumentNo} to ${inDocumentNo}`],
    )
    for (const line of [
      { accountId: input.sourceLiabilityAccountId, debit: input.amount, credit: 0 },
      { accountId: input.destinationLiabilityAccountId, debit: 0, credit: input.amount },
    ]) {
      await client.query(
        'INSERT INTO journal_lines (journal_entry_id,account_id,debit,credit) VALUES ($1,$2,$3,$4)',
        [journal.rows[0].id, line.accountId, line.debit, line.credit],
      )
    }
    await client.query(
      `INSERT INTO audit_logs (user_id,action,entity_type,entity_id,after_data)
       VALUES ($1,'transfer','fund_transaction',$2,$3::jsonb)`,
      [request.user!.id, outResult.rows[0].id, JSON.stringify({
        outDocumentNo, inDocumentNo, journalNo, amount: input.amount,
        fromFundType: input.fromFundType, toFundType: input.toFundType,
        sourceLiabilityAccountId: input.sourceLiabilityAccountId,
        destinationLiabilityAccountId: input.destinationLiabilityAccountId,
        from: source, to: destination,
      })],
    )
    await client.query('COMMIT')
    response.status(201).json({ outgoing: outDocumentNo, incoming: inDocumentNo, journalNo, amount: input.amount, status: 'posted' })
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}))

apiRouter.get('/expenses', requirePermission('expenses.read'), asyncHandler(async (_request, response) => {
  const result = await pool.query(
    `SELECT e.id,e.document_no AS "documentNo",e.expense_date AS "expenseDate",
            e.payment_method AS "paymentMethod",e.status,e.supplier_document_no AS "supplierDocumentNo",
            e.total,e.payment_category AS "paymentCategory",e.supplier_id AS "supplierId",
            s.name AS "supplierName",ba.code AS "bankCode",ba.name AS "bankName",
            COALESCE(json_agg(json_build_object(
              'description',ei.description,'netAmount',ei.net_amount,'taxMode',ei.tax_mode,
              'taxRate',ei.tax_rate,'taxAmount',ei.tax_amount,'lineTotal',ei.line_total,
              'accountCode',a.code,'accountName',a.name
            ) ORDER BY ei.id) FILTER (WHERE ei.id IS NOT NULL),'[]'::json) AS items,
            je.document_no AS "journalNo",reversal.document_no AS "reversalNo"
     FROM expenses e
     JOIN bank_accounts ba ON ba.id=e.bank_account_id
     LEFT JOIN suppliers s ON s.id=e.supplier_id
     LEFT JOIN expense_items ei ON ei.expense_id=e.id
     LEFT JOIN accounts a ON a.id=ei.account_id
     LEFT JOIN journal_entries je ON je.expense_id=e.id AND je.reverses_id IS NULL
     LEFT JOIN journal_entries reversal ON reversal.reverses_id=je.id AND reversal.status='posted'
     GROUP BY e.id,ba.id,s.id,je.id,reversal.id
     ORDER BY e.expense_date DESC,e.id DESC`,
  )
  response.json({ expenses: result.rows })
}))

apiRouter.post('/expenses', requirePermission('expenses.create'), asyncHandler(async (request, response) => {
  const input = parseInput(expenseCreateSchema, request.body)
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const [bank, account] = await Promise.all([
      client.query<{ account_type: string }>(
        `SELECT a.account_type FROM bank_accounts ba JOIN accounts a ON a.id=ba.account_id
         WHERE ba.id=$1 FOR UPDATE OF ba`,
        [input.bankAccountId],
      ),
      client.query<{ account_type: string }>('SELECT account_type FROM accounts WHERE id=$1', [input.expenseAccountId]),
    ])
    if (!bank.rowCount || bank.rows[0].account_type !== 'asset') {
      throw new HttpError(400, 'สมุดเงินต้องเชื่อมกับบัญชีสินทรัพย์')
    }
    if (!account.rowCount || account.rows[0].account_type !== 'expense') {
      throw new HttpError(400, 'บัญชีรายการต้องเป็นประเภทค่าใช้จ่าย')
    }
    if (input.supplierId) {
      const supplier = await client.query('SELECT 1 FROM suppliers WHERE id=$1', [input.supplierId])
      if (!supplier.rowCount) throw new HttpError(404, 'ไม่พบผู้จำหน่าย')
    }
    const amounts = await client.query<{ net_amount: string; tax_amount: string; line_total: string }>(
      `SELECT
         CASE WHEN $2='inclusive' THEN round($1::numeric/(1+$3::numeric/100),2) ELSE $1::numeric END::numeric(14,2)::text AS net_amount,
         CASE WHEN $2='none' THEN 0
              WHEN $2='inclusive' THEN $1::numeric-round($1::numeric/(1+$3::numeric/100),2)
              ELSE round($1::numeric*$3::numeric/100,2) END::numeric(14,2)::text AS tax_amount,
         CASE WHEN $2='inclusive' THEN $1::numeric
              WHEN $2='none' THEN $1::numeric
              ELSE $1::numeric+round($1::numeric*$3::numeric/100,2) END::numeric(14,2)::text AS line_total`,
      [input.amount, input.taxMode, input.taxRate],
    )
    const calculated = amounts.rows[0]
    const documentNo = await nextDocumentNumber(client, 'expense', 'EXP-')
    const expense = await client.query<{ id: string }>(
      `INSERT INTO expenses
       (supplier_id,bank_account_id,created_by,document_no,expense_date,payment_method,status,
        supplier_document_no,total,payment_category)
       VALUES ($1,$2,$3,$4,$5,$6,'draft',$7,$8,$9) RETURNING id`,
      [input.supplierId || null, input.bankAccountId, request.user!.id, documentNo,
        input.expenseDate, input.paymentMethod, input.supplierDocumentNo || null,
        calculated.line_total, input.paymentCategory],
    )
    await client.query(
      `INSERT INTO expense_items
       (expense_id,account_id,description,net_amount,tax_mode,tax_rate,tax_amount,line_total)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [expense.rows[0].id, input.expenseAccountId, input.description, calculated.net_amount,
        input.taxMode, input.taxRate, calculated.tax_amount, calculated.line_total],
    )
    await client.query(
      `INSERT INTO audit_logs (user_id,action,entity_type,entity_id,after_data)
       VALUES ($1,'create','expense',$2,$3::jsonb)`,
      [request.user!.id, expense.rows[0].id, JSON.stringify({ documentNo, total: calculated.line_total })],
    )
    await client.query('COMMIT')
    response.status(201).json({
      id: expense.rows[0].id, documentNo, status: 'draft',
      netAmount: calculated.net_amount, taxAmount: calculated.tax_amount, total: calculated.line_total,
    })
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}))

apiRouter.post('/expenses/:id/post', requirePermission('expenses.post'), asyncHandler(async (request, response) => {
  const expenseId = z.coerce.number().int().positive().parse(request.params.id)
  const input = parseInput(expensePostSchema, request.body)
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const expenseResult = await client.query<{ document_no: string; expense_date: string; total: string; bank_account_id: string; status: string }>(
      'SELECT document_no,expense_date,total,bank_account_id,status FROM expenses WHERE id=$1 FOR UPDATE',
      [expenseId],
    )
    const expense = expenseResult.rows[0]
    if (!expense) throw new HttpError(404, 'ไม่พบรายการค่าใช้จ่าย')
    if (expense.status !== 'draft') throw new HttpError(409, 'ลงบัญชีได้เฉพาะรายการร่าง')
    const items = await client.query<{ account_id: string; net_amount: string; tax_amount: string; description: string }>(
      'SELECT account_id,net_amount,tax_amount,description FROM expense_items WHERE expense_id=$1 ORDER BY id FOR UPDATE',
      [expenseId],
    )
    if (!items.rowCount) throw new HttpError(409, 'รายการค่าใช้จ่ายไม่มีรายละเอียด')
    const bank = await client.query<{ account_id: string; account_type: string }>(
      `SELECT ba.account_id,a.account_type FROM bank_accounts ba JOIN accounts a ON a.id=ba.account_id
       WHERE ba.id=$1 FOR UPDATE OF ba`,
      [expense.bank_account_id],
    )
    if (!bank.rowCount || bank.rows[0].account_type !== 'asset') {
      throw new HttpError(409, 'สมุดเงินไม่ได้เชื่อมกับบัญชีสินทรัพย์')
    }
    const expenseAccounts = await client.query<{ id: string; account_type: string }>(
      'SELECT id,account_type FROM accounts WHERE id=ANY($1::bigint[])',
      [items.rows.map((item) => item.account_id)],
    )
    if (expenseAccounts.rowCount !== new Set(items.rows.map((item) => item.account_id)).size
      || expenseAccounts.rows.some((account) => account.account_type !== 'expense')) {
      throw new HttpError(409, 'รายการมีบัญชีที่ไม่ใช่ประเภทค่าใช้จ่าย')
    }
    const taxCents = items.rows.reduce((sum, item) => sum + Math.round(Number(item.tax_amount) * 100), 0)
    const taxTotal = taxCents / 100
    let inputTaxAccountId: number | undefined
    if (taxTotal > 0) {
      if (!input.inputTaxAccountId) throw new HttpError(400, 'ต้องระบุบัญชีภาษีซื้อสำหรับรายการที่มีภาษี')
      const taxAccount = await client.query<{ account_type: string }>(
        'SELECT account_type FROM accounts WHERE id=$1',
        [input.inputTaxAccountId],
      )
      if (!taxAccount.rowCount || taxAccount.rows[0].account_type !== 'asset') {
        throw new HttpError(400, 'บัญชีภาษีซื้อต้องเป็นประเภทสินทรัพย์')
      }
      inputTaxAccountId = input.inputTaxAccountId
    }
    const journalNo = await nextDocumentNumber(client, 'journal', 'JV-')
    const journal = await client.query<{ id: string }>(
      `INSERT INTO journal_entries
       (expense_id,posted_by,document_no,entry_date,description,status)
       VALUES ($1,$2,$3,$4,$5,'posted') RETURNING id`,
      [expenseId, request.user!.id, journalNo, expense.expense_date, `Expense ${expense.document_no}`],
    )
    for (const item of items.rows) {
      await client.query(
        'INSERT INTO journal_lines (journal_entry_id,account_id,debit,credit) VALUES ($1,$2,$3,0)',
        [journal.rows[0].id, item.account_id, item.net_amount],
      )
    }
    if (taxTotal > 0) {
      await client.query(
        'INSERT INTO journal_lines (journal_entry_id,account_id,debit,credit) VALUES ($1,$2,$3,0)',
        [journal.rows[0].id, inputTaxAccountId, (taxCents / 100).toFixed(2)],
      )
    }
    await client.query(
      'INSERT INTO journal_lines (journal_entry_id,account_id,debit,credit) VALUES ($1,$2,0,$3)',
      [journal.rows[0].id, bank.rows[0].account_id, expense.total],
    )
    await client.query("UPDATE expenses SET status='posted' WHERE id=$1", [expenseId])
    await client.query(
      `INSERT INTO audit_logs (user_id,action,entity_type,entity_id,after_data)
       VALUES ($1,'post','expense',$2,$3::jsonb)`,
      [request.user!.id, expenseId, JSON.stringify({ documentNo: expense.document_no, journalNo })],
    )
    await client.query('COMMIT')
    response.json({ id: expenseId, status: 'posted', journalNo })
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}))

apiRouter.post('/expenses/:id/void', requirePermission('expenses.post'), asyncHandler(async (request, response) => {
  const expenseId = z.coerce.number().int().positive().parse(request.params.id)
  const input = parseInput(expenseVoidSchema, request.body)
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const expenseResult = await client.query<{ document_no: string; status: string }>(
      'SELECT document_no,status FROM expenses WHERE id=$1 FOR UPDATE',
      [expenseId],
    )
    const expense = expenseResult.rows[0]
    if (!expense) throw new HttpError(404, 'ไม่พบรายการค่าใช้จ่าย')
    if (expense.status === 'void') throw new HttpError(409, 'รายการค่าใช้จ่ายถูกยกเลิกแล้ว')
    if (expense.status === 'posted') {
      const original = await client.query<{ id: string }>(
        `SELECT id FROM journal_entries
         WHERE expense_id=$1 AND reverses_id IS NULL AND status='posted' FOR UPDATE`,
        [expenseId],
      )
      if (!original.rowCount) throw new HttpError(409, 'ไม่พบรายการบัญชีต้นทางที่ลงบัญชีแล้ว')
      const existingReversal = await client.query(
        "SELECT 1 FROM journal_entries WHERE reverses_id=$1 AND status='posted'",
        [original.rows[0].id],
      )
      if (existingReversal.rowCount) throw new HttpError(409, 'รายการบัญชีนี้ถูกกลับรายการไปแล้ว')
      const lines = await client.query<{ account_id: string; debit: string; credit: string }>(
        'SELECT account_id,debit,credit FROM journal_lines WHERE journal_entry_id=$1 ORDER BY id',
        [original.rows[0].id],
      )
      if ((lines.rowCount ?? 0) < 2) throw new HttpError(409, 'รายการบัญชีต้นทางไม่สมบูรณ์ ไม่สามารถกลับรายการ')
      const reversalNo = await nextDocumentNumber(client, 'journal-reversal', 'JVR-')
      const reversal = await client.query<{ id: string }>(
        `INSERT INTO journal_entries
         (reverses_id,posted_by,document_no,entry_date,description,status)
         VALUES ($1,$2,$3,CURRENT_DATE,$4,'posted') RETURNING id`,
        [original.rows[0].id, request.user!.id, reversalNo, `กลับรายการ ${expense.document_no}: ${input.reason}`],
      )
      for (const line of lines.rows) {
        await client.query(
          'INSERT INTO journal_lines (journal_entry_id,account_id,debit,credit) VALUES ($1,$2,$3,$4)',
          [reversal.rows[0].id, line.account_id, line.credit, line.debit],
        )
      }
    }
    await client.query("UPDATE expenses SET status='void' WHERE id=$1", [expenseId])
    await client.query(
      `INSERT INTO audit_logs (user_id,action,entity_type,entity_id,after_data)
       VALUES ($1,'void','expense',$2,$3::jsonb)`,
      [request.user!.id, expenseId, JSON.stringify({ documentNo: expense.document_no, reason: input.reason })],
    )
    await client.query('COMMIT')
    response.json({ id: expenseId, status: 'void' })
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}))

apiRouter.get('/reports/receivables', requirePermission('reports.read'), asyncHandler(async (request, response) => {
  const asOf = request.query.asOf === undefined
    ? new Date().toISOString().slice(0, 10)
    : parseInput(z.string().date(), request.query.asOf)
  const result = await pool.query(
    `WITH collected AS (
       SELECT pa.invoice_id,SUM(pa.amount) AS amount
       FROM payment_allocations pa
       JOIN payments p ON p.id=pa.payment_id AND p.status='confirmed'
       GROUP BY pa.invoice_id
     ), fund_applied AS (
       SELECT ft.invoice_id,SUM(ft.amount) AS amount
       FROM fund_transactions ft
       WHERE ft.transaction_type='apply_invoice' AND ft.status='posted'
         AND NOT EXISTS (
           SELECT 1 FROM fund_transactions rev
           WHERE rev.related_transaction_id=ft.id AND rev.transaction_type='reversal' AND rev.status='posted'
         )
       GROUP BY ft.invoice_id
     )
     SELECT i.id,i.document_no AS "documentNo",i.issued_at AS "issuedAt",
            i.due_date AS "dueDate",c.code AS "customerCode",c.full_name AS "customerName",
            i.total,COALESCE(col.amount,0)::numeric(14,2) AS "paidAmount",
            COALESCE(fa.amount,0)::numeric(14,2) AS "fundApplied",
            GREATEST(i.total-COALESCE(col.amount,0)-COALESCE(fa.amount,0),0)::numeric(14,2) AS outstanding,
            GREATEST(($1::date-i.due_date),0)::integer AS "daysOverdue"
     FROM invoices i JOIN customers c ON c.id=i.customer_id
     LEFT JOIN collected col ON col.invoice_id=i.id
     LEFT JOIN fund_applied fa ON fa.invoice_id=i.id
     WHERE i.status='issued' AND i.issued_at<=$1::date
       AND i.total-COALESCE(col.amount,0)-COALESCE(fa.amount,0)>0
     ORDER BY i.due_date,c.full_name,i.document_no`,
    [asOf],
  )
  response.json({ asOf, receivables: result.rows })
}))

apiRouter.get('/reports/receivables.csv', requirePermission('reports.export'), asyncHandler(async (request, response) => {
  const asOf = request.query.asOf === undefined
    ? new Date().toISOString().slice(0, 10)
    : parseInput(z.string().date(), request.query.asOf)
  const result = await pool.query<{ documentNo: string; customerCode: string; customerName: string; dueDate: string; outstanding: string; daysOverdue: number }>(
    `WITH collected AS (
       SELECT pa.invoice_id,SUM(pa.amount) AS amount
       FROM payment_allocations pa JOIN payments p ON p.id=pa.payment_id AND p.status='confirmed'
       GROUP BY pa.invoice_id
     ), fund_applied AS (
       SELECT ft.invoice_id,SUM(ft.amount) AS amount FROM fund_transactions ft
       WHERE ft.transaction_type='apply_invoice' AND ft.status='posted'
         AND NOT EXISTS (
           SELECT 1 FROM fund_transactions rev
           WHERE rev.related_transaction_id=ft.id AND rev.transaction_type='reversal' AND rev.status='posted'
         )
       GROUP BY ft.invoice_id
     )
     SELECT i.document_no AS "documentNo",c.code AS "customerCode",c.full_name AS "customerName",
            i.due_date AS "dueDate",
            GREATEST(i.total-COALESCE(col.amount,0)-COALESCE(fa.amount,0),0)::numeric(14,2)::text AS outstanding,
            GREATEST(($1::date-i.due_date),0)::integer AS "daysOverdue"
     FROM invoices i JOIN customers c ON c.id=i.customer_id
     LEFT JOIN collected col ON col.invoice_id=i.id
     LEFT JOIN fund_applied fa ON fa.invoice_id=i.id
     WHERE i.status='issued' AND i.issued_at<=$1::date
       AND i.total-COALESCE(col.amount,0)-COALESCE(fa.amount,0)>0
     ORDER BY i.due_date,c.full_name,i.document_no`,
    [asOf],
  )
  const escape = (value: string | number) => `"${String(value).replaceAll('"', '""')}"`
  const rows = [
    ['Invoice', 'Customer code', 'Customer name', 'Due date', 'Outstanding', 'Days overdue'],
    ...result.rows.map((row) => [row.documentNo, row.customerCode, row.customerName, row.dueDate, row.outstanding, row.daysOverdue]),
  ]
  response
    .type('text/csv')
    .set('Content-Disposition', `attachment; filename="receivables-${asOf}.csv"`)
    .send(`\uFEFF${rows.map((row) => row.map(escape).join(',')).join('\r\n')}`)
}))

const expenseReportFilterSchema = z.object({
  from: z.string().date(),
  to: z.string().date(),
  status: z.enum(['draft', 'posted', 'void', 'all']).default('posted'),
}).refine((value) => value.to >= value.from, {
  path: ['to'],
  message: 'วันสิ้นสุดต้องไม่ก่อนวันเริ่มต้น',
})

async function getExpenseReport(input: z.infer<typeof expenseReportFilterSchema>) {
  return pool.query<{
    documentNo: string
    expenseDate: string
    supplier: string
    supplierDocumentNo: string | null
    category: string
    status: string
    paymentMethod: string
    bankAccount: string
    description: string
    expenseAccount: string
    netAmount: string
    taxAmount: string
    total: string
    journalNo: string | null
    reversalNo: string | null
  }>(
    `SELECT e.document_no AS "documentNo",e.expense_date AS "expenseDate",
           COALESCE(s.name,'') AS supplier,e.supplier_document_no AS "supplierDocumentNo",
           e.payment_category AS category,e.status,e.payment_method AS "paymentMethod",
           ba.code || ' · ' || ba.name AS "bankAccount",
           string_agg(ei.description,'; ' ORDER BY ei.id) AS description,
           string_agg(DISTINCT a.code || ' · ' || a.name,', ') AS "expenseAccount",
           COALESCE(SUM(ei.net_amount),0)::numeric(14,2)::text AS "netAmount",
           COALESCE(SUM(ei.tax_amount),0)::numeric(14,2)::text AS "taxAmount",
           e.total::numeric(14,2)::text AS total,je.document_no AS "journalNo",
           reversal.document_no AS "reversalNo"
    FROM expenses e
    LEFT JOIN suppliers s ON s.id=e.supplier_id
    JOIN bank_accounts ba ON ba.id=e.bank_account_id
    LEFT JOIN expense_items ei ON ei.expense_id=e.id
    LEFT JOIN accounts a ON a.id=ei.account_id
    LEFT JOIN journal_entries je ON je.expense_id=e.id AND je.reverses_id IS NULL
    LEFT JOIN journal_entries reversal ON reversal.reverses_id=je.id AND reversal.status='posted'
    WHERE e.expense_date BETWEEN $1::date AND $2::date AND ($3='all' OR e.status=$3)
    GROUP BY e.id,s.id,ba.id,je.id,reversal.id
    ORDER BY e.expense_date,e.document_no`,
    [input.from, input.to, input.status],
  )
}

apiRouter.get('/reports/expenses', requirePermission('reports.read'), asyncHandler(async (request, response) => {
  const input = parseInput(expenseReportFilterSchema, request.query)
  const result = await getExpenseReport(input)
  response.json({ filters: input, expenses: result.rows })
}))

apiRouter.get('/reports/expenses.csv', requirePermission('reports.export'), asyncHandler(async (request, response) => {
  const input = parseInput(expenseReportFilterSchema, request.query)
  const result = await getExpenseReport(input)
  const escape = (value: string | number | null) => `"${String(value ?? '').replaceAll('"', '""')}"`
  const rows = [
    ['Document', 'Date', 'Supplier', 'Supplier document', 'Category', 'Status', 'Payment method',
     'Bank account', 'Description', 'Expense account', 'Net amount', 'Input tax', 'Total', 'Journal', 'Reversal'],
    ...result.rows.map((row) => [
     row.documentNo, row.expenseDate, row.supplier, row.supplierDocumentNo, row.category, row.status,
     row.paymentMethod, row.bankAccount, row.description, row.expenseAccount, row.netAmount,
     row.taxAmount, row.total, row.journalNo, row.reversalNo,
    ]),
  ]
  response
    .type('text/csv')
    .set('Content-Disposition', `attachment; filename="expenses-${input.from}-to-${input.to}.csv"`)
    .send(`\uFEFF${rows.map((row) => row.map(escape).join(',')).join('\r\n')}`)
}))

const journalReportFilterSchema = z.object({
  from: z.string().date(),
  to: z.string().date(),
}).refine((value) => value.to >= value.from, {
  path: ['to'],
  message: 'วันสิ้นสุดต้องไม่ก่อนวันเริ่มต้น',
})

async function getJournalReport(input: z.infer<typeof journalReportFilterSchema>) {
  return pool.query<{
    documentNo: string
    entryDate: string
    description: string
    accountCode: string
    accountName: string
    debit: string
    credit: string
  }>(
    `SELECT je.document_no AS "documentNo",je.entry_date AS "entryDate",je.description,
            a.code AS "accountCode",a.name AS "accountName",
            jl.debit::numeric(14,2)::text AS debit,jl.credit::numeric(14,2)::text AS credit
     FROM journal_entries je
     JOIN journal_lines jl ON jl.journal_entry_id=je.id
     JOIN accounts a ON a.id=jl.account_id
     WHERE je.status='posted' AND je.entry_date BETWEEN $1::date AND $2::date
     ORDER BY je.entry_date,je.document_no,jl.id`,
    [input.from, input.to],
  )
}

apiRouter.get('/reports/journal-entries', requirePermission('reports.read'), asyncHandler(async (request, response) => {
  const input = parseInput(journalReportFilterSchema, request.query)
  const result = await getJournalReport(input)
  response.json({ filters: input, journalLines: result.rows })
}))

apiRouter.get('/reports/journal-entries.csv', requirePermission('reports.export'), asyncHandler(async (request, response) => {
  const input = parseInput(journalReportFilterSchema, request.query)
  const result = await getJournalReport(input)
  const escape = (value: string) => {
    const safeValue = /^[\s]*[=+\-@]/.test(value) ? `'${value}` : value
    return `"${safeValue.replaceAll('"', '""')}"`
  }
  const rows = [
    ['Journal', 'Date', 'Description', 'Account code', 'Account name', 'Debit', 'Credit'],
    ...result.rows.map((row) => [
      row.documentNo, row.entryDate, row.description, row.accountCode, row.accountName, row.debit, row.credit,
    ]),
  ]
  response
    .type('text/csv')
    .set('Content-Disposition', `attachment; filename="journal-entries-${input.from}-to-${input.to}.csv"`)
    .send(`\uFEFF${rows.map((row) => row.map(escape).join(',')).join('\r\n')}`)
}))

apiRouter.post('/billing-periods/:id/generate-invoices', requirePermission('billing.create'), asyncHandler(async (request, response) => {
  const periodId = z.coerce.number().int().positive().parse(request.params.id)
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const periodResult = await client.query<{
      property_id: string; start_date: string; end_date: string; status: string
    }>('SELECT property_id,start_date,end_date,status FROM billing_periods WHERE id=$1 FOR UPDATE', [periodId])
    const period = periodResult.rows[0]
    if (!period) throw new HttpError(404, 'ไม่พบรอบบิล')
    if (period.status !== 'open') throw new HttpError(409, 'รอบบิลปิดแล้ว')

    const rentChargeResult = await client.query<{ id: string }>(
      "SELECT id FROM charges WHERE category='rent' ORDER BY code LIMIT 1",
    )
    if (!rentChargeResult.rowCount) throw new HttpError(409, 'ต้องตั้งค่ารายการค่าบริการหมวด rent ก่อนสร้างใบแจ้งหนี้')
    const rentChargeId = rentChargeResult.rows[0].id
    const contractsResult = await client.query<{
      id: string; customer_id: string; document_no: string; start_date: string; end_date: string
      rental_cycle: 'monthly' | 'yearly'; rent_amount: string; deposit_required: string
      billing_day: number; due_days: number; full_name: string; address: string | null
      assignment_id: string; room_id: string; room_code: string
    }>(
      `SELECT c.id,c.customer_id,c.document_no,c.start_date,c.end_date,c.rental_cycle,c.rent_amount,
              c.deposit_required,c.billing_day,c.due_days,cu.full_name,cu.address,
              ca.id AS assignment_id,ca.room_id,r.code AS room_code
       FROM contracts c JOIN customers cu ON cu.id=c.customer_id
       JOIN contract_room_assignments ca ON ca.contract_id=c.id
       JOIN rooms r ON r.id=ca.room_id JOIN floors f ON f.id=r.floor_id
       JOIN buildings b ON b.id=f.building_id
       WHERE b.property_id=$1 AND c.status IN ('active','ended')
         AND daterange(ca.start_date,COALESCE(ca.end_date,'infinity'::date),'[]')
             @> daterange($2::date,$3::date,'[]')
         AND (c.rental_cycle='monthly' OR
              (EXTRACT(MONTH FROM c.start_date)=EXTRACT(MONTH FROM $2::date)
               AND EXTRACT(DAY FROM c.start_date)=EXTRACT(DAY FROM $2::date)))
       ORDER BY c.id`,
      [period.property_id, period.start_date, period.end_date],
    )

    const generated: { id: string; documentNo: string }[] = []
    const skipped: { contractId: string; reason: string }[] = []
    for (const contract of contractsResult.rows) {
      const existing = await client.query<{ status: string }>(
        `SELECT status FROM invoices WHERE contract_id=$1 AND billing_period_id=$2
         ORDER BY revision_no DESC LIMIT 1`,
        [contract.id, periodId],
      )
      if (existing.rows[0] && existing.rows[0].status !== 'void') continue

      const lines: {
        chargeId: string; description: string; quantity: string; unitPrice: string
        meterReadingId?: string; grossAmount?: string; calculation: Record<string, unknown>
      }[] = [{
        chargeId: rentChargeId,
        description: `ค่าเช่าห้อง ${contract.room_code}`,
        quantity: '1',
        unitPrice: contract.rent_amount,
        calculation: { source: 'contract', contractNo: contract.document_no, rentSnapshot: contract.rent_amount, cycle: contract.rental_cycle },
      }]

      const contractCharges = await client.query<{ charge_id: string; name: string; amount: string }>(
        `SELECT cc.charge_id,ch.name,cc.amount FROM contract_charges cc
         JOIN charges ch ON ch.id=cc.charge_id
         WHERE cc.contract_id=$1 AND cc.start_date<=$2
           AND (cc.end_date IS NULL OR cc.end_date>=$3) ORDER BY cc.id`,
        [contract.id, period.start_date, period.end_date],
      )
      for (const charge of contractCharges.rows) {
        lines.push({
          chargeId: charge.charge_id, description: charge.name, quantity: '1', unitPrice: charge.amount,
          calculation: { source: 'contract_charge', amountSnapshot: charge.amount },
        })
      }

      const utilities = await client.query<{
        tariff_id: string; tariff_name: string; utility_type: string; pricing_method: string
        unit_rate: string; fixed_amount: string; charge_id: string; charge_name: string
        meter_id: string | null; rollover_value: string | null
        reading_id: string | null; units_used: string | null; verified: boolean | null
      }>(
        `SELECT rut.tariff_id,t.name AS tariff_name,t.utility_type,t.pricing_method,t.unit_rate,t.fixed_amount,
                t.charge_id,ch.name AS charge_name,m.id AS meter_id,m.rollover_value,
                mr.id AS reading_id,mr.units_used,mr.verified
         FROM room_utility_tariffs rut JOIN utility_tariffs t ON t.id=rut.tariff_id
         JOIN charges ch ON ch.id=t.charge_id
         LEFT JOIN meters m ON m.room_id=rut.room_id AND m.tariff_id=t.id
           AND m.installed_at<=$2 AND (m.removed_at IS NULL OR m.removed_at>=$3)
         LEFT JOIN meter_readings mr ON mr.meter_id=m.id AND mr.billing_period_id=$4
         WHERE rut.room_id=$1 AND rut.effective_from<=$2
           AND (rut.effective_to IS NULL OR rut.effective_to>=$3)
           AND t.effective_from<=$2 AND (t.effective_to IS NULL OR t.effective_to>=$3)
         ORDER BY t.utility_type`,
        [contract.room_id, period.start_date, period.end_date, periodId],
      )
      const utilityCounts = new Map<string, number>()
      for (const utility of utilities.rows) {
        utilityCounts.set(utility.utility_type, (utilityCounts.get(utility.utility_type) ?? 0) + 1)
      }
      if ([...utilityCounts.values()].some((count) => count > 1)) {
        skipped.push({ contractId: contract.id, reason: 'พบอัตราหรือมิเตอร์ซ้อนกันในช่วงรอบบิล กรุณาตรวจการตั้งค่า' })
        continue
      }
      let missingReading = false
      for (const utility of utilities.rows) {
        let amount = utility.fixed_amount
        let quantity = '1'
        let grossAmount: string | undefined
        const calculation: Record<string, unknown> = {
          source: 'utility_tariff', tariffId: utility.tariff_id, tariffName: utility.tariff_name,
          method: utility.pricing_method, utilityType: utility.utility_type,
        }
        if (utility.pricing_method !== 'flat') {
          if (!utility.reading_id || !utility.verified || !utility.units_used) {
            missingReading = true
            break
          }
          quantity = utility.units_used
          calculation.readingId = utility.reading_id
          calculation.unitsUsed = utility.units_used
          if (utility.pricing_method === 'meter') {
            amount = utility.unit_rate
            calculation.unitRate = utility.unit_rate
          } else {
            const computed = await client.query<{ amount: string }>(
              `SELECT COALESCE(SUM(
                 GREATEST(LEAST($1::numeric,COALESCE(upper_unit,$1::numeric))-lower_unit,0)*unit_rate
               ),0)::numeric(14,4)::text AS amount
               FROM utility_tariff_tiers WHERE tariff_id=$2`,
              [utility.units_used, utility.tariff_id],
            )
            calculation.tieredGrossAmount = computed.rows[0].amount
            grossAmount = computed.rows[0].amount
            const averageRate = await client.query<{ rate: string }>(
              'SELECT CASE WHEN $2::numeric=0 THEN 0::numeric ELSE ($1::numeric/$2::numeric)::numeric(14,4) END::text AS rate',
              [grossAmount, quantity],
            )
            amount = averageRate.rows[0].rate
            calculation.tiers = (await client.query(
              'SELECT lower_unit AS "lowerUnit",upper_unit AS "upperUnit",unit_rate AS "unitRate" FROM utility_tariff_tiers WHERE tariff_id=$1 ORDER BY lower_unit',
              [utility.tariff_id],
            )).rows
          }
        } else {
          calculation.fixedAmount = utility.fixed_amount
        }
        lines.push({
          chargeId: utility.charge_id, description: `${utility.charge_name} (${utility.utility_type === 'water' ? 'น้ำ' : 'ไฟ'})`,
          quantity, unitPrice: amount, grossAmount,
          meterReadingId: utility.reading_id ?? undefined, calculation,
        })
      }
      if (missingReading) {
        skipped.push({ contractId: contract.id, reason: 'ต้องบันทึกและยืนยันค่ามิเตอร์ของรอบนี้ก่อน' })
        continue
      }

      const outstanding = await client.query<{ revision_no: number }>(
        'SELECT COALESCE(MAX(revision_no),0)+1 AS revision_no FROM invoices WHERE contract_id=$1 AND billing_period_id=$2',
        [contract.id, periodId],
      )
      const revision = outstanding.rows[0].revision_no
      const documentNo = await nextDocumentNumber(client, 'invoice', 'INV-')
      const dueDate = await client.query<{ date: string }>(
        `SELECT ($1::date + $2::integer)::text AS date`,
        [period.end_date, contract.due_days],
      )
      const snapshot = {
        customerName: contract.full_name,
        customerAddress: contract.address,
        contractNo: contract.document_no,
        roomCode: contract.room_code,
        billingPeriodStart: period.start_date,
        billingPeriodEnd: period.end_date,
        taxRounding: 'round_per_line_2_decimals',
      }
      const invoiceResult = await client.query<{ id: string }>(
        `INSERT INTO invoices
         (contract_id,billing_period_id,revision_no,document_no,issued_at,due_date,status,
          subtotal,tax_total,total,created_by,customer_id,invoice_kind,document_snapshot)
         VALUES ($1,$2,$3,$4,$5,$6,'draft',0,0,0,$7,$8,'recurring',$9::jsonb)
         RETURNING id`,
        [contract.id, periodId, revision, documentNo, period.end_date, dueDate.rows[0].date,
          request.user!.id, contract.customer_id, JSON.stringify(snapshot)],
      )
      const invoiceId = invoiceResult.rows[0].id
      for (const line of lines) {
        const charge = await client.query<{ tax_mode: string; tax_rate: string }>(
          'SELECT tax_mode,tax_rate FROM charges WHERE id=$1',
          [line.chargeId],
        )
        if (!charge.rowCount) throw new HttpError(400, 'ไม่พบหมวดค่าบริการที่อ้างอิงในรายการบิล')
        const calculated = await client.query<{ net: string; tax: string; total: string }>(
          `WITH amounts AS (
             SELECT COALESCE($5::numeric,$1::numeric*$2::numeric) AS gross,$3::numeric AS rate,$4::text AS mode
           ), rounded AS (
             SELECT gross,rate,mode,
               CASE WHEN mode='inclusive' THEN ROUND(gross*100/(100+rate),2) ELSE ROUND(gross,2) END AS net
             FROM amounts
           )
           SELECT net::text,
             (CASE WHEN mode='none' THEN 0::numeric
                   WHEN mode='inclusive' THEN gross-net
                   ELSE ROUND(net*rate/100,2) END)::numeric(14,2)::text AS tax,
             (net+CASE WHEN mode='none' THEN 0::numeric
                       WHEN mode='inclusive' THEN gross-net
                       ELSE ROUND(net*rate/100,2) END)::numeric(14,2)::text AS total
           FROM rounded`,
          [line.unitPrice, line.quantity, charge.rows[0].tax_rate, charge.rows[0].tax_mode, line.grossAmount ?? null],
        )
        const values = calculated.rows[0]
        await client.query(
          `INSERT INTO invoice_items
           (invoice_id,charge_id,meter_reading_id,room_assignment_id,description,quantity,unit_price,
            tax_mode,tax_rate,net_amount,tax_amount,line_total,calculation_snapshot)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb)`,
          [invoiceId, line.chargeId, line.meterReadingId ?? null, contract.assignment_id, line.description,
            line.quantity, line.unitPrice, charge.rows[0].tax_mode, charge.rows[0].tax_rate,
            values.net, values.tax, values.total, JSON.stringify({ ...line.calculation, rounding: 'per_line_2_decimals' })],
        )
      }
      const totals = await client.query<{ subtotal: string; tax_total: string; total: string }>(
        `SELECT COALESCE(SUM(net_amount),0)::text AS subtotal,
                COALESCE(SUM(tax_amount),0)::text AS tax_total,
                COALESCE(SUM(line_total),0)::text AS total
         FROM invoice_items WHERE invoice_id=$1`,
        [invoiceId],
      )
      await client.query(
        'UPDATE invoices SET subtotal=$1,tax_total=$2,total=$3 WHERE id=$4',
        [totals.rows[0].subtotal, totals.rows[0].tax_total, totals.rows[0].total, invoiceId],
      )
      generated.push({ id: invoiceId, documentNo })
    }

    await client.query('COMMIT')
    response.status(201).json({ generated, skipped })
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}))

apiRouter.get('/rooms', requirePermission('rooms.read'), asyncHandler(async (_request, response) => {
  const result = await pool.query(
    `SELECT r.id, r.code, r.base_rent AS rent, r.operational_status AS "operationalStatus",
            f.id AS "floorId", f.code AS "floorCode",
            b.id AS "buildingId", b.code AS "buildingCode", b.name AS building,
            p.id AS "propertyId", p.name AS property,
            ct.full_name AS tenant,
            CASE
              WHEN r.operational_status <> 'available' THEN r.operational_status
              WHEN ca.id IS NOT NULL THEN 'occupied'
              WHEN bk.id IS NOT NULL THEN 'reserved'
              ELSE 'available'
            END AS status
     FROM rooms r
     JOIN floors f ON f.id = r.floor_id
     JOIN buildings b ON b.id = f.building_id
     JOIN properties p ON p.id = b.property_id
     LEFT JOIN LATERAL (
       SELECT ca.id, c.customer_id
       FROM contract_room_assignments ca
       JOIN contracts c ON c.id = ca.contract_id AND c.status = 'active'
       WHERE ca.room_id = r.id AND CURRENT_DATE BETWEEN ca.start_date AND COALESCE(ca.end_date, 'infinity'::date)
       ORDER BY ca.start_date DESC LIMIT 1
     ) ca ON true
     LEFT JOIN customers ct ON ct.id = ca.customer_id
     LEFT JOIN LATERAL (
       SELECT id FROM bookings
       WHERE room_id = r.id AND status IN ('pending','confirmed')
         AND CURRENT_DATE BETWEEN planned_start AND planned_end
       ORDER BY booked_at DESC LIMIT 1
     ) bk ON ca.id IS NULL
     ORDER BY p.name, b.name, f.code, r.code`,
  )
  response.json({ rooms: result.rows })
}))

apiRouter.post('/rooms', requirePermission('rooms.create'), asyncHandler(async (request, response) => {
  const input = parseInput(roomSchema, request.body)
  const result = await pool.query(
    `INSERT INTO rooms (floor_id, room_type_id, code, operational_status, base_rent)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, floor_id AS "floorId", room_type_id AS "roomTypeId", code,
               operational_status AS "operationalStatus", base_rent AS rent`,
    [input.floorId, input.roomTypeId, input.code, input.operationalStatus, input.baseRent],
  )
  response.status(201).json(result.rows[0])
}))

apiRouter.patch('/rooms/:id/status', requirePermission('rooms.update'), asyncHandler(async (request, response) => {
  const id = z.coerce.number().int().positive().parse(request.params.id)
  const input = z.object({ operationalStatus: z.enum(roomStatusValues) }).parse(request.body)
  const result = await pool.query(
    `UPDATE rooms SET operational_status = $1
     WHERE id = $2
     RETURNING id, operational_status AS "operationalStatus"`,
    [input.operationalStatus, id],
  )
  if (!result.rowCount) throw new HttpError(404, 'ไม่พบห้องพัก')
  response.json(result.rows[0])
}))

apiRouter.get('/customers', requirePermission('customers.read'), asyncHandler(async (_request, response) => {
  const result = await pool.query(
    `SELECT id, code, full_name AS "fullName", phone, email, birth_date AS "birthDate", address
     FROM customers ORDER BY full_name`,
  )
  response.json({ customers: result.rows })
}))

apiRouter.post('/customers', requirePermission('customers.create'), asyncHandler(async (request, response) => {
  const input = parseInput(customerSchema, request.body)
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const code = await nextDocumentNumber(client, 'customer', 'CUS-')
    const result = await client.query(
      `INSERT INTO customers (code, full_name, phone, email, birth_date, address)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, code, full_name AS "fullName", phone, email, birth_date AS "birthDate", address`,
      [code, input.fullName, input.phone || null, input.email || null, input.birthDate || null, input.address || null],
    )
    await client.query('COMMIT')
    response.status(201).json(result.rows[0])
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}))

apiRouter.get('/bookings', requirePermission('bookings.read'), asyncHandler(async (_request, response) => {
  const result = await pool.query(
    `SELECT bk.id, bk.document_no AS "documentNo", bk.status, bk.customer_id AS "customerId", bk.planned_start AS "plannedStart",
            bk.planned_end AS "plannedEnd", bk.expires_at AS "expiresAt", customer.full_name AS "customerName",
            r.id AS "roomId", r.code AS "roomCode", b.name AS building
     FROM bookings bk JOIN customers customer ON customer.id = bk.customer_id
     JOIN rooms r ON r.id = bk.room_id JOIN floors f ON f.id = r.floor_id
     JOIN buildings b ON b.id = f.building_id
     ORDER BY bk.booked_at DESC, bk.id DESC`,
  )
  response.json({ bookings: result.rows })
}))

apiRouter.post('/bookings', requirePermission('bookings.create'), asyncHandler(async (request, response) => {
  const input = parseInput(z.object({
    customerId: z.coerce.number().int().positive(),
    roomId: z.coerce.number().int().positive(),
    plannedStart: z.string().date(),
    plannedEnd: z.string().date(),
    expiresAt: z.string().datetime().optional(),
  }).refine((value) => value.plannedEnd >= value.plannedStart, { path: ['plannedEnd'], message: 'วันสิ้นสุดต้องไม่ก่อนวันเริ่มจอง' }), request.body)

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const room = await client.query<{ operational_status: string }>('SELECT operational_status FROM rooms WHERE id=$1 FOR UPDATE', [input.roomId])
    if (!room.rowCount) throw new HttpError(404, 'ไม่พบห้องพัก')
    if (room.rows[0].operational_status !== 'available') throw new HttpError(409, 'ห้องพักปิดรับการจองหรืออยู่ระหว่างซ่อม')
    const overlap = await client.query(
      `SELECT 1 FROM contract_room_assignments ca JOIN contracts c ON c.id=ca.contract_id
       WHERE ca.room_id=$1 AND c.status IN ('draft','active')
         AND daterange(ca.start_date, COALESCE(ca.end_date,'infinity'::date),'[]') && daterange($2::date,$3::date,'[]')
       UNION ALL SELECT 1 FROM bookings WHERE room_id=$1 AND status IN ('pending','confirmed')
         AND daterange(planned_start,planned_end,'[]') && daterange($2::date,$3::date,'[]') LIMIT 1`,
      [input.roomId, input.plannedStart, input.plannedEnd],
    )
    if (overlap.rowCount) throw new HttpError(409, 'ห้องพักถูกจองหรือทำสัญญาทับซ้อนในช่วงวันที่เลือก')
    const customer = await client.query('SELECT 1 FROM customers WHERE id=$1', [input.customerId])
    if (!customer.rowCount) throw new HttpError(404, 'ไม่พบผู้จอง')
    const documentNo = await nextDocumentNumber(client, 'booking', 'BKG-')
    const result = await client.query(
      `INSERT INTO bookings (room_id, customer_id, created_by, document_no, booked_at, planned_start, planned_end, expires_at)
       VALUES ($1,$2,$3,$4,now(),$5,$6,$7)
       RETURNING id, document_no AS "documentNo", status, planned_start AS "plannedStart", planned_end AS "plannedEnd"`,
      [input.roomId, input.customerId, request.user!.id, documentNo, input.plannedStart, input.plannedEnd, input.expiresAt ?? null],
    )
    await client.query('COMMIT')
    response.status(201).json(result.rows[0])
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}))

apiRouter.patch('/bookings/:id/status', requirePermission('bookings.update'), asyncHandler(async (request, response) => {
  const id = z.coerce.number().int().positive().parse(request.params.id)
  const input = parseInput(z.object({ status: z.enum(['confirmed', 'cancelled']) }), request.body)
  const result = await pool.query(
    `UPDATE bookings SET status=$1
     WHERE id=$2 AND status='pending'
     RETURNING id, status`,
    [input.status, id],
  )
  if (!result.rowCount) throw new HttpError(409, 'ไม่พบรายการจองที่ยังรอดำเนินการ')
  response.json(result.rows[0])
}))

apiRouter.get('/contracts', requirePermission('contracts.read'), asyncHandler(async (_request, response) => {
  const result = await pool.query(
    `SELECT c.id, c.document_no AS "documentNo", c.status, c.start_date AS "startDate",
            c.end_date AS "endDate", c.rental_cycle AS "rentalCycle", c.rent_amount AS "rentAmount",
            c.deposit_required AS "depositRequired", customer.id AS "customerId",
            customer.full_name AS "customerName", assignment.room_id AS "roomId", r.code AS "roomCode",
            b.name AS building, f.code AS "floorCode"
     FROM contracts c
     JOIN customers customer ON customer.id = c.customer_id
     LEFT JOIN LATERAL (
       SELECT ca.room_id FROM contract_room_assignments ca
       WHERE ca.contract_id=c.id
       ORDER BY (ca.start_date<=CURRENT_DATE AND (ca.end_date IS NULL OR ca.end_date>=CURRENT_DATE)) DESC,
                ca.start_date DESC,ca.id DESC LIMIT 1
     ) assignment ON true
     LEFT JOIN rooms r ON r.id = assignment.room_id
     JOIN floors f ON f.id = r.floor_id
     JOIN buildings b ON b.id = f.building_id
     ORDER BY c.start_date DESC, c.id DESC`,
  )
  response.json({ contracts: result.rows })
}))

apiRouter.post('/contracts/:id/move-room', requirePermission('contracts.update'), asyncHandler(async (request, response) => {
  const contractId = z.coerce.number().int().positive().parse(request.params.id)
  const input = parseInput(contractMoveSchema, request.body)
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const contractResult = await client.query<{
      customer_id: string
      document_no: string
      start_date: string
      end_date: string
      status: string
    }>('SELECT customer_id,document_no,start_date,end_date,status FROM contracts WHERE id=$1 FOR UPDATE', [contractId])
    const contract = contractResult.rows[0]
    if (!contract) throw new HttpError(404, 'ไม่พบสัญญา')
    if (contract.status !== 'active') throw new HttpError(409, 'ย้ายห้องได้เฉพาะสัญญาที่กำลังใช้งาน')
    const isMoveDateFuture = await client.query<{ future: boolean }>('SELECT $1::date>CURRENT_DATE AS future', [input.effectiveDate])
    if (!isMoveDateFuture.rows[0].future) {
      throw new HttpError(400, 'วันที่ย้ายต้องเป็นวันถัดไปเป็นอย่างน้อย เพื่อปิดช่วงห้องเดิมโดยไม่ให้วันที่ซ้อนกัน')
    }
    if (input.effectiveDate <= contract.start_date || input.effectiveDate > contract.end_date) {
      throw new HttpError(400, 'วันที่ย้ายต้องอยู่ภายในช่วงสัญญาและหลังวันเริ่มสัญญา')
    }
    const assignments = await client.query<{ id: string; room_id: string; start_date: string; end_date: string | null }>(
      `SELECT id,room_id,start_date,end_date FROM contract_room_assignments
       WHERE contract_id=$1 ORDER BY start_date DESC,id DESC LIMIT 1 FOR UPDATE`,
      [contractId],
    )
    const current = assignments.rows[0]
    if (!current || (current.end_date !== null && current.end_date < input.effectiveDate)) {
      throw new HttpError(409, 'ไม่พบช่วงห้องปัจจุบันที่ครอบคลุมวันที่ย้าย')
    }
    if (input.effectiveDate <= current.start_date) throw new HttpError(400, 'วันที่ย้ายต้องอยู่หลังวันเริ่มช่วงห้องปัจจุบัน')
    if (String(input.roomId) === String(current.room_id)) throw new HttpError(400, 'เลือกห้องใหม่ที่แตกต่างจากห้องปัจจุบัน')

    const roomResult = await client.query<{ operational_status: string }>(
      'SELECT operational_status FROM rooms WHERE id=$1 FOR UPDATE',
      [input.roomId],
    )
    if (!roomResult.rowCount) throw new HttpError(404, 'ไม่พบห้องปลายทาง')
    if (roomResult.rows[0].operational_status !== 'available') throw new HttpError(409, 'ห้องปลายทางปิดรับการใช้งานหรืออยู่ระหว่างซ่อม')
    const roomOverlaps = await client.query(
      `SELECT 1 FROM contract_room_assignments ca
       JOIN contracts c ON c.id=ca.contract_id
       WHERE ca.room_id=$1 AND c.id<>$2 AND c.status IN ('draft','active')
         AND daterange(ca.start_date,COALESCE(ca.end_date,'infinity'::date),'[]')
             && daterange($3::date,$4::date,'[]')
       UNION ALL
       SELECT 1 FROM bookings
       WHERE room_id=$1 AND status IN ('pending','confirmed')
         AND daterange(planned_start,planned_end,'[]') && daterange($3::date,$4::date,'[]')
       LIMIT 1`,
      [input.roomId, contractId, input.effectiveDate, contract.end_date],
    )
    if (roomOverlaps.rowCount) throw new HttpError(409, 'ห้องปลายทางมีสัญญาหรือการจองทับซ้อนในช่วงวันที่เหลือ')

    const residents = await client.query<{ customer_id: string }>(
      `SELECT customer_id FROM contract_residents
       WHERE contract_id=$1 AND move_in<$2::date AND (move_out IS NULL OR move_out>=$2::date)
       GROUP BY customer_id`,
      [contractId, input.effectiveDate],
    )
    await client.query(
      `UPDATE contract_room_assignments SET end_date=$1::date-1
       WHERE id=$2`,
      [input.effectiveDate, current.id],
    )
    await client.query(
      `INSERT INTO contract_room_assignments (contract_id,room_id,start_date,end_date,rent_snapshot,meter_handover)
       VALUES ($1,$2,$3,$4,$5,$6::jsonb)`,
      [
        contractId,
        input.roomId,
        input.effectiveDate,
        contract.end_date,
        input.rentAmount,
        JSON.stringify(input.meterHandoverNote ? { note: input.meterHandoverNote } : {}),
      ],
    )
    const moveOutDate = await client.query<{ date: string }>(
      'SELECT $1::date-1 AS date',
      [input.effectiveDate],
    )
    await client.query(
      `UPDATE contract_residents SET move_out=$1
       WHERE contract_id=$2 AND move_out IS NULL AND move_in<$3::date`,
      [moveOutDate.rows[0].date, contractId, input.effectiveDate],
    )
    for (const resident of residents.rows) {
      await client.query(
        `INSERT INTO contract_residents (contract_id,customer_id,move_in)
         VALUES ($1,$2,$3) ON CONFLICT (contract_id,customer_id,move_in) DO NOTHING`,
        [contractId, resident.customer_id, input.effectiveDate],
      )
    }
    await client.query(
      `INSERT INTO audit_logs (user_id,action,entity_type,entity_id,before_data,after_data)
       VALUES ($1,'move-room','contract',$2,$3::jsonb,$4::jsonb)`,
      [
        request.user!.id,
        contractId,
        JSON.stringify({ roomId: current.room_id, assignmentId: current.id }),
        JSON.stringify({ roomId: input.roomId, effectiveDate: input.effectiveDate, rentAmount: input.rentAmount, meterHandoverNote: input.meterHandoverNote ?? null }),
      ],
    )
    await client.query('COMMIT')
    response.status(201).json({ contractId, previousRoomId: current.room_id, roomId: input.roomId, effectiveDate: input.effectiveDate })
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}))

apiRouter.post('/contracts/:id/end', requirePermission('contracts.update'), asyncHandler(async (request, response) => {
  const contractId = z.coerce.number().int().positive().parse(request.params.id)
  const input = parseInput(contractEndSchema, request.body)
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const contractResult = await client.query<{ status: string; start_date: string; end_date: string; document_no: string }>(
      'SELECT status,start_date,end_date,document_no FROM contracts WHERE id=$1 FOR UPDATE',
      [contractId],
    )
    const contract = contractResult.rows[0]
    if (!contract) throw new HttpError(404, 'ไม่พบสัญญา')
    if (contract.status !== 'active') throw new HttpError(409, 'สิ้นสุดได้เฉพาะสัญญาที่กำลังใช้งาน')
    if (input.endDate < contract.start_date || input.endDate > contract.end_date) {
      throw new HttpError(400, 'วันที่สิ้นสุดต้องอยู่ภายในช่วงสัญญาเดิม')
    }
    const isEndDateFuture = await client.query<{ future: boolean }>('SELECT $1::date>CURRENT_DATE AS future', [input.endDate])
    if (isEndDateFuture.rows[0].future) {
      throw new HttpError(400, 'วันที่สิ้นสุดสัญญาต้องไม่อยู่ในอนาคต')
    }
    const assignment = await client.query<{ id: string; start_date: string; end_date: string | null }>(
      `SELECT id,start_date,end_date FROM contract_room_assignments
       WHERE contract_id=$1 ORDER BY start_date DESC,id DESC LIMIT 1 FOR UPDATE`,
      [contractId],
    )
    if (!assignment.rowCount || (assignment.rows[0].end_date !== null && assignment.rows[0].end_date < input.endDate)) {
      throw new HttpError(409, 'ไม่พบช่วงห้องปัจจุบันที่ยังเปิดอยู่')
    }
    if (input.endDate < assignment.rows[0].start_date) throw new HttpError(400, 'วันที่สิ้นสุดต้องไม่ก่อนวันเริ่มห้องปัจจุบัน')
    await client.query("UPDATE contracts SET status='ended',end_date=$1 WHERE id=$2", [input.endDate, contractId])
    await client.query('UPDATE contract_room_assignments SET end_date=$1 WHERE id=$2', [input.endDate, assignment.rows[0].id])
    await client.query(
      `UPDATE contract_residents SET move_out=$1
       WHERE contract_id=$2 AND move_out IS NULL AND move_in<=$1`,
      [input.endDate, contractId],
    )
    await client.query(
      `INSERT INTO audit_logs (user_id,action,entity_type,entity_id,before_data,after_data)
       VALUES ($1,'end','contract',$2,$3::jsonb,$4::jsonb)`,
      [
        request.user!.id,
        contractId,
        JSON.stringify({ status: contract.status, endDate: contract.end_date }),
        JSON.stringify({ status: 'ended', endDate: input.endDate, documentNo: contract.document_no }),
      ],
    )
    await client.query('COMMIT')
    response.json({ id: contractId, status: 'ended', endDate: input.endDate })
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}))

apiRouter.post('/contracts', requirePermission('contracts.create'), asyncHandler(async (request, response) => {
  const input = parseInput(contractSchema, request.body)
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    let booking: { room_id: string; customer_id: string; planned_start: string; planned_end: string; status: string } | undefined
    if (input.bookingId) {
      const bookingResult = await client.query<{ room_id: string; customer_id: string; planned_start: string; planned_end: string; status: string }>(
        'SELECT room_id, customer_id, planned_start, planned_end, status FROM bookings WHERE id=$1 FOR UPDATE',
        [input.bookingId],
      )
      booking = bookingResult.rows[0]
      if (!booking) throw new HttpError(404, 'ไม่พบรายการจอง')
      if (booking.status !== 'confirmed' || String(booking.room_id) !== String(input.roomId) || String(booking.customer_id) !== String(input.customerId)) {
        throw new HttpError(409, 'รายการจองต้องยืนยันแล้ว และห้องกับผู้ทำสัญญาต้องตรงกัน')
      }
    }

    const roomResult = await client.query<{ floor_id: string; operational_status: string; base_rent: string }>(
      'SELECT floor_id, operational_status, base_rent FROM rooms WHERE id = $1 FOR UPDATE',
      [input.roomId],
    )
    const room = roomResult.rows[0]
    if (!room) throw new HttpError(404, 'ไม่พบห้องพัก')
    if (room.operational_status !== 'available') throw new HttpError(409, 'ห้องพักนี้ปิดรับการจองหรืออยู่ระหว่างซ่อม')

    const overlap = await client.query(
      `SELECT 1 FROM contract_room_assignments ca
       JOIN contracts c ON c.id = ca.contract_id
       WHERE ca.room_id = $1 AND c.status IN ('draft','active')
         AND daterange(ca.start_date, COALESCE(ca.end_date, 'infinity'::date), '[]')
             && daterange($2::date, $3::date, '[]')
       UNION ALL
       SELECT 1 FROM bookings
       WHERE room_id = $1 AND status IN ('pending','confirmed') AND id IS DISTINCT FROM $4
         AND daterange(planned_start, planned_end, '[]') && daterange($2::date, $3::date, '[]')
       LIMIT 1`,
      [input.roomId, input.startDate, input.endDate, input.bookingId ?? null],
    )
    if (overlap.rowCount) throw new HttpError(409, 'ห้องพักมีการจองหรือสัญญาทับซ้อนในช่วงวันที่เลือก')

    const customer = await client.query('SELECT 1 FROM customers WHERE id = $1', [input.customerId])
    if (!customer.rowCount) throw new HttpError(404, 'ไม่พบผู้ทำสัญญา')
    const residents = [...new Set([input.customerId, ...input.residents])]
    const residentsResult = await client.query('SELECT id FROM customers WHERE id = ANY($1::bigint[])', [residents])
    if (residentsResult.rowCount !== residents.length) throw new HttpError(400, 'มีรายชื่อผู้เข้าพักที่ไม่พบในระบบ')

    const documentNo = await nextDocumentNumber(client, 'contract', 'CON-')
    const contractResult = await client.query<{ id: string }>(
      `INSERT INTO contracts
       (customer_id, booking_id, created_by, document_no, start_date, end_date, rental_cycle, rent_amount, deposit_required, billing_day, due_days, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'active') RETURNING id`,
      [input.customerId, input.bookingId ?? null, request.user!.id, documentNo, input.startDate, input.endDate, input.rentalCycle,
        input.rentAmount, input.depositRequired, input.billingDay, input.dueDays],
    )
    const contractId = contractResult.rows[0].id
    await client.query(
      `INSERT INTO contract_room_assignments (contract_id, room_id, start_date, end_date, rent_snapshot)
       VALUES ($1, $2, $3, $4, $5)`,
      [contractId, input.roomId, input.startDate, input.endDate, input.rentAmount],
    )
    for (const residentId of residents) {
      await client.query(
        'INSERT INTO contract_residents (contract_id, customer_id, move_in) VALUES ($1, $2, $3)',
        [contractId, residentId, input.startDate],
      )
    }
    if (input.bookingId) await client.query("UPDATE bookings SET status='converted' WHERE id=$1", [input.bookingId])
    const result = await client.query(
      `SELECT c.id, c.document_no AS "documentNo", c.status, c.start_date AS "startDate",
              c.end_date AS "endDate", c.rental_cycle AS "rentalCycle", c.rent_amount AS "rentAmount",
              customer.full_name AS "customerName", r.code AS "roomCode"
       FROM contracts c JOIN customers customer ON customer.id = c.customer_id
       JOIN contract_room_assignments ca ON ca.contract_id = c.id
       JOIN rooms r ON r.id = ca.room_id WHERE c.id = $1`,
      [contractId],
    )
    await client.query('COMMIT')
    response.status(201).json(result.rows[0])
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}))

apiRouter.get('/maintenance-requests', requirePermission('maintenance.read'), asyncHandler(async (_request, response) => {
  const result = await pool.query(
    `SELECT mr.id,mr.contract_id AS "contractId",mr.document_no AS "documentNo",mr.description,mr.priority,mr.status,
            mr.reported_at AS "reportedAt", r.code AS "roomCode", b.name AS building,
            COALESCE(customer.full_name,u.display_name) AS "reportedBy",
            COALESCE((
              SELECT jsonb_agg(jsonb_build_object(
                'id',job.id,'supplierName',supplier.name,'workNote',job.work_note,
                'cost',job.cost::numeric(14,2)::text,'payer',job.payer,'completedAt',job.completed_at
              ) ORDER BY job.id)
              FROM maintenance_jobs job LEFT JOIN suppliers supplier ON supplier.id=job.supplier_id
              WHERE job.request_id=mr.id
            ),'[]'::jsonb) AS jobs
     FROM maintenance_requests mr JOIN rooms r ON r.id=mr.room_id
     JOIN floors f ON f.id=r.floor_id JOIN buildings b ON b.id=f.building_id
     JOIN users u ON u.id=mr.reported_by
     LEFT JOIN customers customer ON customer.id=u.customer_id
     ORDER BY mr.reported_at DESC, mr.id DESC`,
  )
  response.json({ requests: result.rows })
}))

apiRouter.post('/maintenance-requests', requirePermission('maintenance.create'), asyncHandler(async (request, response) => {
  const input = parseInput(z.object({
    roomId: z.coerce.number().int().positive(),
    contractId: z.coerce.number().int().positive().optional(),
    description: z.string().trim().min(1).max(5000),
    priority: z.enum(['low', 'normal', 'high', 'urgent']).default('normal'),
  }), request.body)
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const room = await client.query('SELECT 1 FROM rooms WHERE id=$1', [input.roomId])
    if (!room.rowCount) throw new HttpError(404, 'ไม่พบห้องพัก')
    if (input.contractId) {
      const contract = await client.query(
        'SELECT 1 FROM contract_room_assignments WHERE contract_id=$1 AND room_id=$2',
        [input.contractId, input.roomId],
      )
      if (!contract.rowCount) throw new HttpError(400, 'สัญญานี้ไม่มีการใช้งานห้องที่ระบุ')
    }
    const documentNo = await nextDocumentNumber(client, 'maintenance', 'MNT-')
    const result = await client.query(
      `INSERT INTO maintenance_requests
       (room_id, contract_id, reported_by, document_no, description, priority, reported_at)
       VALUES ($1,$2,$3,$4,$5,$6,now())
       RETURNING id, document_no AS "documentNo", status, description, priority`,
      [input.roomId, input.contractId ?? null, request.user!.id, documentNo, input.description, input.priority],
    )
    await client.query('COMMIT')
    response.status(201).json(result.rows[0])
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}))

apiRouter.patch('/maintenance-requests/:id/status', requirePermission('maintenance.update'), asyncHandler(async (request, response) => {
  const id = z.coerce.number().int().positive().parse(request.params.id)
  const input = parseInput(z.object({ status: z.enum(['assigned', 'in_progress', 'completed', 'cancelled']) }), request.body)
  const transitions: Record<string, string[]> = {
    new: ['assigned', 'cancelled'],
    assigned: ['in_progress', 'cancelled'],
    in_progress: ['completed', 'cancelled'],
  }
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const existing = await client.query<{ status: string }>('SELECT status FROM maintenance_requests WHERE id=$1 FOR UPDATE', [id])
    const current = existing.rows[0]?.status
    if (!current) throw new HttpError(404, 'ไม่พบงานซ่อม')
    if (!transitions[current]?.includes(input.status)) throw new HttpError(409, 'ไม่สามารถเปลี่ยนสถานะงานซ่อมตามลำดับนี้ได้')
    if (input.status === 'completed') {
      const unfinishedJobs = await client.query(
        'SELECT 1 FROM maintenance_jobs WHERE request_id=$1 AND completed_at IS NULL LIMIT 1',
        [id],
      )
      if (unfinishedJobs.rowCount) throw new HttpError(409, 'บันทึกผลและต้นทุนของงานย่อยให้ครบก่อนปิดงานซ่อม')
    }
    const result = await client.query(
      `UPDATE maintenance_requests SET status=$1, closed_at=CASE WHEN $1='completed' THEN now() ELSE NULL END
       WHERE id=$2 RETURNING id, status, closed_at AS "closedAt"`,
      [input.status, id],
    )
    await client.query('COMMIT')
    response.json(result.rows[0])
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}))

apiRouter.post('/maintenance-requests/:id/jobs', requirePermission('maintenance.update'), asyncHandler(async (request, response) => {
  const requestId = z.coerce.number().int().positive().parse(request.params.id)
  const input = parseInput(z.object({
    assignedUserId: z.coerce.number().int().positive().optional(),
    supplierId: z.coerce.number().int().positive().optional(),
    workNote: z.string().trim().max(5000).optional(),
    payer: z.enum(['business', 'tenant']).default('business'),
    cost: z.coerce.number().finite().nonnegative().max(999999999999.99).default(0),
  }), request.body)
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const maintenance = await client.query<{ status: string }>('SELECT status FROM maintenance_requests WHERE id=$1 FOR UPDATE', [requestId])
    const current = maintenance.rows[0]?.status
    if (!current) throw new HttpError(404, 'ไม่พบงานซ่อม')
    if (!['new', 'assigned'].includes(current)) throw new HttpError(409, 'งานซ่อมนี้ไม่รับการมอบหมายแล้ว')
    if (input.payer === 'tenant') {
      const activeContract = await client.query(
        `SELECT 1 FROM maintenance_requests mr
         JOIN contracts c ON c.id=mr.contract_id AND c.status='active' AND CURRENT_DATE BETWEEN c.start_date AND c.end_date
         WHERE mr.id=$1`,
        [requestId],
      )
      if (!activeContract.rowCount) throw new HttpError(409, 'เรียกเก็บผู้เช่าได้เฉพาะงานที่ผูกกับสัญญาที่ยังใช้งาน')
    }
    if (input.assignedUserId) {
      const user = await client.query('SELECT 1 FROM users WHERE id=$1 AND active=true', [input.assignedUserId])
      if (!user.rowCount) throw new HttpError(404, 'ไม่พบผู้ใช้งานที่ได้รับมอบหมาย')
    }
    if (input.supplierId) {
      const supplier = await client.query('SELECT 1 FROM suppliers WHERE id=$1', [input.supplierId])
      if (!supplier.rowCount) throw new HttpError(404, 'ไม่พบผู้จำหน่าย')
    }
    const job = await client.query(
      `INSERT INTO maintenance_jobs (request_id, assigned_user_id, supplier_id, work_note, payer, cost)
       VALUES ($1,$2,$3,$4,$5,$6)
       RETURNING id, request_id AS "requestId", assigned_user_id AS "assignedUserId",
                 supplier_id AS "supplierId", work_note AS "workNote", payer, cost`,
      [requestId, input.assignedUserId ?? null, input.supplierId ?? null, input.workNote || null, input.payer, input.cost],
    )
    await client.query("UPDATE maintenance_requests SET status='assigned' WHERE id=$1", [requestId])
    await client.query(
      `INSERT INTO audit_logs (user_id,action,entity_type,entity_id,after_data)
       VALUES ($1,'assign-job','maintenance_job',$2,$3::jsonb)`,
      [request.user!.id, job.rows[0].id, JSON.stringify({ requestId, supplierId: input.supplierId ?? null, payer: input.payer, cost: input.cost })],
    )
    await client.query('COMMIT')
    response.status(201).json(job.rows[0])
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}))

apiRouter.patch('/maintenance-requests/:id/jobs/:jobId', requirePermission('maintenance.update'), asyncHandler(async (request, response) => {
  const requestId = z.coerce.number().int().positive().parse(request.params.id)
  const jobId = z.coerce.number().int().positive().parse(request.params.jobId)
  const input = parseInput(z.object({
    workNote: z.string().trim().min(1).max(5000),
    cost: z.coerce.number().finite().nonnegative().max(999999999999.99),
    payer: z.enum(['business', 'tenant']),
  }), request.body)
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const maintenance = await client.query<{ status: string; contract_id: string | null }>(
      'SELECT status,contract_id FROM maintenance_requests WHERE id=$1 FOR UPDATE',
      [requestId],
    )
    if (!maintenance.rowCount) throw new HttpError(404, 'ไม่พบงานซ่อม')
    if (!['assigned', 'in_progress'].includes(maintenance.rows[0].status)) {
      throw new HttpError(409, 'บันทึกผลและต้นทุนได้เฉพาะงานที่กำลังดำเนินการ')
    }
    if (input.payer === 'tenant') {
      if (!maintenance.rows[0].contract_id) throw new HttpError(409, 'งานนี้ไม่ได้ผูกกับสัญญาผู้เช่า')
      const activeContract = await client.query(
        `SELECT 1 FROM contracts WHERE id=$1 AND status='active'
         AND CURRENT_DATE BETWEEN start_date AND end_date`,
        [maintenance.rows[0].contract_id],
      )
      if (!activeContract.rowCount) throw new HttpError(409, 'เรียกเก็บผู้เช่าได้เฉพาะสัญญาที่ยังใช้งาน')
    }
    const result = await client.query(
      `UPDATE maintenance_jobs SET work_note=$1,cost=$2,payer=$3,completed_at=now()
       WHERE id=$4 AND request_id=$5
       RETURNING id,request_id AS "requestId",work_note AS "workNote",cost::numeric(14,2)::text AS cost,payer,completed_at AS "completedAt"`,
      [input.workNote, input.cost, input.payer, jobId, requestId],
    )
    if (!result.rowCount) throw new HttpError(404, 'ไม่พบงานย่อย')
    await client.query(
      `INSERT INTO audit_logs (user_id,action,entity_type,entity_id,after_data)
       VALUES ($1,'complete-job','maintenance_job',$2,$3::jsonb)`,
      [request.user!.id, jobId, JSON.stringify(input)],
    )
    await client.query('COMMIT')
    response.json(result.rows[0])
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}))

apiRouter.get('/complaints', requirePermission('complaints.read'), asyncHandler(async (_request, response) => {
  const result = await pool.query(
    `SELECT c.id, c.document_no AS "documentNo", c.description, c.resolution, c.status,
            c.reported_at AS "reportedAt", r.code AS "roomCode", b.name AS building
     FROM complaints c JOIN rooms r ON r.id=c.room_id
     JOIN floors f ON f.id=r.floor_id JOIN buildings b ON b.id=f.building_id
     ORDER BY c.reported_at DESC, c.id DESC`,
  )
  response.json({ complaints: result.rows })
}))

apiRouter.post('/complaints', requirePermission('complaints.create'), asyncHandler(async (request, response) => {
  const input = parseInput(z.object({
    roomId: z.coerce.number().int().positive(),
    contractId: z.coerce.number().int().positive().optional(),
    description: z.string().trim().min(1).max(5000),
  }), request.body)
  const documentNo = await nextStandaloneDocumentNumber('complaint', 'CMP-')
  const result = await pool.query(
    `INSERT INTO complaints (room_id, contract_id, reported_by, document_no, description, reported_at)
     VALUES ($1,$2,$3,$4,$5,now()) RETURNING id, document_no AS "documentNo", description, status`,
    [input.roomId, input.contractId ?? null, request.user!.id, documentNo, input.description],
  )
  response.status(201).json(result.rows[0])
}))

apiRouter.patch('/complaints/:id/status', requirePermission('complaints.update'), asyncHandler(async (request, response) => {
  const id = z.coerce.number().int().positive().parse(request.params.id)
  const input = parseInput(z.object({
    status: z.enum(['in_progress', 'resolved', 'cancelled']),
    resolution: z.string().trim().max(5000).optional(),
  }).refine((value) => value.status !== 'resolved' || Boolean(value.resolution), {
    path: ['resolution'],
    message: 'กรุณาระบุผลการแก้ไขก่อนปิดเรื่อง',
  }), request.body)
  const transitions: Record<string, string[]> = {
    new: ['in_progress', 'resolved', 'cancelled'],
    in_progress: ['resolved', 'cancelled'],
  }
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const existing = await client.query<{ status: string }>('SELECT status FROM complaints WHERE id=$1 FOR UPDATE', [id])
    const current = existing.rows[0]?.status
    if (!current) throw new HttpError(404, 'ไม่พบข้อร้องเรียน')
    if (!transitions[current]?.includes(input.status)) throw new HttpError(409, 'ไม่สามารถเปลี่ยนสถานะข้อร้องเรียนตามลำดับนี้ได้')
    const result = await client.query(
      `UPDATE complaints SET status=$1, resolution=COALESCE($2,resolution),
         closed_at=CASE WHEN $1='resolved' THEN now() ELSE NULL END
       WHERE id=$3 RETURNING id, status, resolution, closed_at AS "closedAt"`,
      [input.status, input.resolution || null, id],
    )
    await client.query('COMMIT')
    response.json(result.rows[0])
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}))

async function nextStandaloneDocumentNumber(documentType: string, prefix: string) {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const documentNo = await nextDocumentNumber(client, documentType, prefix)
    await client.query('COMMIT')
    return documentNo
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}
