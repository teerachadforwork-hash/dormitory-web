import 'dotenv/config'
import cookieParser from 'cookie-parser'
import express, { type ErrorRequestHandler } from 'express'
import helmet from 'helmet'
import { ZodError } from 'zod'
import { authenticate, authRouter } from './auth.js'
import { pool } from './db.js'
import { asyncHandler, HttpError } from './http.js'
import { apiRouter } from './routes.js'

const app = express()
const port = Number(process.env.API_PORT ?? 3000)

app.disable('x-powered-by')
app.use(helmet())
app.use(express.json({ limit: '100kb' }))
app.use(cookieParser())
app.use('/api/auth', authRouter)
app.use('/api', asyncHandler(async (request, response, next) => {
  if (request.path === '/health') {
    next()
    return
  }
  await new Promise<void>((resolve, reject) => authenticate(request, response, (error) => error ? reject(error) : resolve()))
  next()
}))
app.use('/api', apiRouter)

const errorHandler: ErrorRequestHandler = (error: unknown, _request, response, _next) => {
  if (error instanceof HttpError) {
    response.status(error.status).json({ error: error.message })
    return
  }
  if (error instanceof ZodError) {
    response.status(400).json({ error: error.issues.map((issue) => issue.message).join(' • ') })
    return
  }
  if (typeof error === 'object' && error !== null && 'name' in error && error.name === 'MulterError') {
    const status = 'code' in error && error.code === 'LIMIT_FILE_SIZE' ? 413 : 400
    response.status(status).json({ error: status === 413 ? 'ไฟล์มีขนาดเกิน 5 MB' : 'รูปแบบไฟล์แนบไม่ถูกต้อง' })
    return
  }
  if (typeof error === 'object' && error !== null && 'type' in error && error.type === 'entity.parse.failed') {
    response.status(400).json({ error: 'รูปแบบ JSON ไม่ถูกต้อง' })
    return
  }
  const code = typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined
  if (code === '23505') {
    response.status(409).json({ error: 'ข้อมูลนี้มีอยู่แล้ว กรุณาตรวจสอบรหัสที่ระบุ' })
    return
  }
  if (code === '23503') {
    response.status(400).json({ error: 'ข้อมูลอ้างอิงไม่ถูกต้องหรือถูกใช้งานอยู่' })
    return
  }
  console.error('Unhandled API error', error)
  response.status(500).json({ error: 'เกิดข้อผิดพลาดภายในระบบ กรุณาลองใหม่อีกครั้ง' })
}
app.use(errorHandler)

const server = app.listen(port, '127.0.0.1', () => {
  console.info(`Rental API listening on http://127.0.0.1:${port}`)
})

async function expireWorkflows() {
  try {
    const bookings = await pool.query(
      `UPDATE bookings SET status='expired'
       WHERE status='pending' AND expires_at IS NOT NULL AND expires_at <= now()`,
    )
    const contracts = await pool.query(
      `UPDATE contracts SET status='ended'
       WHERE status='active' AND end_date < CURRENT_DATE`,
    )
    if ((bookings.rowCount ?? 0) + (contracts.rowCount ?? 0) > 0) {
      console.info(`Expired ${bookings.rowCount ?? 0} reservations and ended ${contracts.rowCount ?? 0} contracts.`)
    }
  } catch (error) {
    console.error('Unable to expire dated rental workflows', error)
  }
}

const workflowTimer = setInterval(() => { void expireWorkflows() }, 60_000)
void expireWorkflows()

async function shutdown() {
  clearInterval(workflowTimer)
  server.close()
  await pool.end()
}

process.on('SIGINT', () => { void shutdown() })
process.on('SIGTERM', () => { void shutdown() })
