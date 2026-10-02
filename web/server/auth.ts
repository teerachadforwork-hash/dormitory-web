import 'dotenv/config'
import { compare } from 'bcryptjs'
import { SignJWT, jwtVerify } from 'jose'
import { Router, type Request, type Response, type NextFunction } from 'express'
import { rateLimit } from 'express-rate-limit'
import { z } from 'zod'
import { pool } from './db.js'
import { asyncHandler, HttpError } from './http.js'

declare global {
  namespace Express {
    interface Request {
      user?: { id: string; username: string; displayName: string; customerId: string | null; permissions: string[] }
    }
  }
}

const secretText = process.env.JWT_SECRET
if (!secretText || secretText.length < 32) {
  throw new Error('JWT_SECRET must contain at least 32 characters.')
}
const secret = new TextEncoder().encode(secretText)
const cookieName = 'rental_session'

const loginSchema = z.object({
  username: z.string().trim().min(1).max(100),
  password: z.string().min(1).max(200),
})

export const authRouter = Router()
authRouter.use('/login', rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: 'draft-8', legacyHeaders: false }))

authRouter.post('/login', asyncHandler(async (request, response) => {
  const input = loginSchema.safeParse(request.body)
  if (!input.success) throw new HttpError(400, 'กรุณาระบุชื่อผู้ใช้และรหัสผ่านให้ถูกต้อง')

  const result = await pool.query<{
    id: string
    username: string
    display_name: string
    password_hash: string
    active: boolean
    customer_id: string | null
  }>('SELECT id, username, display_name, password_hash, active, customer_id FROM users WHERE username = $1', [input.data.username])

  const user = result.rows[0]
  if (!user || !user.active || !(await compare(input.data.password, user.password_hash))) {
    throw new HttpError(401, 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง')
  }
  const permissionResult = await pool.query<{ code: string }>(
    `SELECT DISTINCT p.code
     FROM user_roles ur
     JOIN role_permissions rp ON rp.role_id=ur.role_id
     JOIN permissions p ON p.id=rp.permission_id
     WHERE ur.user_id=$1 ORDER BY p.code`,
    [user.id],
  )

  const token = await new SignJWT({ sub: user.id })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('8h')
    .sign(secret)

  response.cookie(cookieName, token, {
    httpOnly: true,
    sameSite: 'strict',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 8 * 60 * 60 * 1000,
  })
  response.json({
    user: {
      id: user.id,
      username: user.username,
      displayName: user.display_name,
      customerId: user.customer_id,
      permissions: permissionResult.rows.map((row) => row.code),
    },
  })
}))

authRouter.post('/logout', (_request, response) => {
  response.clearCookie(cookieName, { httpOnly: true, sameSite: 'strict', secure: process.env.NODE_ENV === 'production', path: '/' })
  response.status(204).end()
})

authRouter.get('/me', authenticate, (request, response) => {
  response.json({ user: request.user })
})

export async function authenticate(request: Request, _response: Response, next: NextFunction) {
  try {
    const token = request.cookies?.[cookieName] as string | undefined
    if (!token) throw new HttpError(401, 'กรุณาเข้าสู่ระบบ')

    let payload: Awaited<ReturnType<typeof jwtVerify>>['payload']
    try {
      payload = (await jwtVerify(token, secret)).payload
    } catch {
      throw new HttpError(401, 'เซสชันหมดอายุหรือไม่ถูกต้อง กรุณาเข้าสู่ระบบใหม่')
    }
    if (typeof payload.sub !== 'string') throw new HttpError(401, 'เซสชันไม่ถูกต้อง')

    const result = await pool.query<{
      id: string
      username: string
      display_name: string
      customer_id: string | null
      permission: string | null
    }>(
      `SELECT u.id, u.username, u.display_name, u.customer_id, p.code AS permission
       FROM users u
       LEFT JOIN user_roles ur ON ur.user_id = u.id
       LEFT JOIN role_permissions rp ON rp.role_id = ur.role_id
       LEFT JOIN permissions p ON p.id = rp.permission_id
       WHERE u.id = $1 AND u.active = true`,
      [payload.sub],
    )

    const user = result.rows[0]
    if (!user) throw new HttpError(401, 'บัญชีผู้ใช้ถูกปิดใช้งาน')
    request.user = {
      id: user.id,
      username: user.username,
      displayName: user.display_name,
      customerId: user.customer_id,
      permissions: [...new Set(result.rows.flatMap((row) => row.permission ? [row.permission] : []))],
    }
    next()
  } catch (error) {
    next(error)
  }
}

export function requirePermission(permission: string) {
  return (request: Request, _response: Response, next: NextFunction) => {
    if (!request.user?.permissions.includes(permission)) {
      next(new HttpError(403, 'บัญชีของคุณไม่มีสิทธิ์ดำเนินการนี้'))
      return
    }
    next()
  }
}
