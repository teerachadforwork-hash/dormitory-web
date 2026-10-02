import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react'
import { invoicePrintMarkup, receiptPrintMarkup, type InvoicePrintData, type ReceiptPrintData } from './printDocuments'
import './App.css'

type RoomStatus = 'available' | 'occupied' | 'reserved' | 'maintenance' | 'disabled'
type Page = 'overview' | 'rooms' | 'tenants' | 'bookings' | 'contracts' | 'billing' | 'payments' | 'funds' | 'expenses' | 'maintenance' | 'complaints' | 'reports' | 'users' | 'portal' | 'setup'
type User = { id: string; username: string; displayName: string; customerId: string | null; permissions: string[] }
type Room = {
  id: string
  code: string
  building: string
  buildingId: string
  buildingCode: string
  property: string
  propertyId: string
  floorCode: string
  floorId: string
  status: RoomStatus
  operationalStatus: string
  rent: string | number
  tenant: string | null
}
type Customer = { id: string; code: string; fullName: string; phone: string | null; email: string | null }
type Contract = {
  id: string
  documentNo: string
  status: string
  startDate: string
  endDate: string
  rentalCycle: 'monthly' | 'yearly'
  rentAmount: string | number
  depositRequired: string | number
  customerId?: string
  customerName: string
  roomId?: string | null
  roomCode: string
  building?: string
}
type Booking = { id: string; documentNo: string; status: string; plannedStart: string; plannedEnd: string; expiresAt: string | null; customerId: string; customerName: string; roomId: string; roomCode: string; building: string }
type MaintenanceJob = { id: string; supplierName: string | null; workNote: string | null; cost: string; payer: 'business' | 'tenant'; completedAt: string | null }
type MaintenanceRequest = { id: string; contractId: string | null; documentNo: string; description: string; priority: string; status: string; reportedAt: string; roomCode: string; building: string; reportedBy: string; jobs: MaintenanceJob[] }
type Complaint = { id: string; documentNo: string; description: string; resolution: string | null; status: string; reportedAt: string; roomCode: string; building: string }
type BillingPeriod = { id: string; propertyId: string; property?: string; code: string; startDate: string; endDate: string; status: string }
type Meter = { id: string; roomId: string; roomCode: string; tariffId: string; tariffName: string; serialNo: string; utilityType: 'water' | 'electricity'; rolloverValue: string | null }
type MeterReading = { id: string; meterId: string; billingPeriodId: string; billingPeriod: string; roomCode: string; utilityType: 'water' | 'electricity'; previousValue: string; currentValue: string; rolloverCount: number; unitsUsed: string; verified: boolean }
type Invoice = { id: string; contractId: string | null; documentNo: string; status: string; dueDate: string; total: string; paidAmount: string; customerName: string; customerCode: string; billingPeriod: string | null; attachments: { id: string; fileName: string; createdAt: string }[] }
type Payment = { id: string; documentNo: string; customerId: string; customerName: string; bankAccountId: string; bankAccount: string; receivedAt: string; amount: string; method: string; reference: string | null; status: string; receiptId: string | null; receiptNo: string | null; allocations: { invoiceId: string; documentNo: string; amount: string }[] }
type Receivable = { id: string; documentNo: string; issuedAt: string; dueDate: string; customerCode: string; customerName: string; total: string; paidAmount: string; fundApplied: string; outstanding: string; daysOverdue: number }
type FundTransaction = { id: string; documentNo: string; fundType: string; transactionType: string; amount: string; occurredAt: string; status: string; bookingId: string | null; contractId: string | null; invoiceId: string | null; method: string | null; relatedTransactionId: string | null; customerName: string; sourceDocument: string; invoiceNo: string | null }
type Expense = {
  id: string
  documentNo: string
  expenseDate: string
  paymentMethod: string
  status: 'draft' | 'posted' | 'void'
  supplierDocumentNo: string | null
  supplierName: string | null
  total: string
  paymentCategory: string
  bankCode: string
  bankName: string
  journalNo: string | null
  reversalNo: string | null
  items: { description: string; netAmount: string; taxMode: string; taxRate: string; taxAmount: string; lineTotal: string; accountCode: string; accountName: string }[]
}
type ExpenseReportRow = {
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
}
type JournalReportLine = { documentNo: string; entryDate: string; description: string; accountCode: string; accountName: string; debit: string; credit: string }
type ManagedUser = { id: string; username: string; displayName: string; active: boolean; roleIds: string[]; roleNames: string; customerId: string | null; customerName: string | null }
type ManagedRole = { id: string; code: string; name: string; permissionCodes: string[] }
type PermissionOption = { code: string; description: string | null }
type PortalContract = { id: string; documentNo: string; status: string; startDate: string; endDate: string; roomCode: string | null; building: string | null }
type PortalInvoice = { id: string; documentNo: string; status: string; dueDate: string; total: string; paidAmount: string; attachments: { id: string; fileName: string; mimeType: string; createdAt: string }[] }
type PortalCase = { id: string; documentNo: string; description: string; status: string; roomCode: string; reportedAt: string; priority?: string; resolution?: string | null }
type PortalDashboard = {
  customer: { id: string; code: string; fullName: string }
  contracts: PortalContract[]
  invoices: PortalInvoice[]
  maintenanceRequests: PortalCase[]
  complaints: PortalCase[]
}
type Lookups = {
  properties: { id: string; code: string; name: string }[]
  buildings: { id: string; propertyId: string; code: string; name: string }[]
  floors: { id: string; buildingId: string; code: string }[]
  roomTypes: { id: string; code: string; name: string; defaultRent: string | number; capacity: number }[]
  accounts: { id: string; code: string; name: string; accountType: string }[]
  bankAccounts: { id: string; accountId: string; code: string; name: string; kind: string }[]
  charges: { id: string; code: string; name: string; category: string; accountId: string }[]
  tariffs: { id: string; propertyId: string; utilityType: 'water' | 'electricity'; name: string; pricingMethod: string; chargeId: string }[]
  suppliers: { id: string; code: string; name: string; taxId: string | null; phone: string | null }[]
}

const statusLabels: Record<RoomStatus, string> = {
  available: 'ว่าง',
  occupied: 'มีผู้พัก',
  reserved: 'จองแล้ว',
  maintenance: 'งดใช้',
  disabled: 'ปิดใช้งาน',
}
const todayLabel = new Intl.DateTimeFormat('th-TH', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Bangkok' }).format(new Date())
const todayIsoDate = new Date().toISOString().slice(0, 10)
const tomorrowDate = new Date(`${todayIsoDate}T00:00:00Z`)
tomorrowDate.setUTCDate(tomorrowDate.getUTCDate() + 1)
const tomorrowIsoDate = tomorrowDate.toISOString().slice(0, 10)
const staffPermissions = ['properties.read', 'rooms.read', 'customers.read', 'bookings.read', 'contracts.read', 'billing.read', 'invoices.read', 'payments.read', 'funds.read', 'expenses.read', 'maintenance.read', 'complaints.read', 'reports.read', 'users.manage', 'settings.manage']
const isTenantOnlyUser = (user: User) => user.permissions.includes('tenant.portal') && !user.permissions.some((permission) => staffPermissions.includes(permission))

const navigation: { id: Page | 'payments' | 'billing' | 'maintenance' | 'reports'; label: string; icon: ReactNode; page?: Page }[] = [
  { id: 'portal', label: 'พอร์ทัลผู้เช่า', page: 'portal', icon: <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M8 9h8m-8 4h8m-8 4h4" /></> },
  { id: 'overview', label: 'ภาพรวม', page: 'overview', icon: <path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1z" /> },
  { id: 'rooms', label: 'ห้องพัก', page: 'rooms', icon: <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M3 10h18M8 10v10m8-10v10" /></> },
  { id: 'tenants', label: 'ผู้เช่า', page: 'tenants', icon: <><circle cx="9" cy="8" r="3" /><path d="M3 20a6 6 0 0 1 12 0m2-9a3 3 0 1 0 0-6m1 9a5 5 0 0 1 3 5" /></> },
  { id: 'bookings', label: 'การจอง', page: 'bookings', icon: <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M16 3v4M8 3v4M3 10h18M13 15l2 2 4-4" /></> },
  { id: 'contracts', label: 'สัญญาเช่า', page: 'contracts', icon: <><path d="M7 3h8l4 4v14H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z" /><path d="M15 3v5h5M9 13h6m-6 4h6" /></> },
  { id: 'billing', label: 'รอบบิล', page: 'billing', icon: <><rect x="3" y="5" width="18" height="15" rx="2" /><path d="M7 3v4m10-4v4M3 10h18m-14 4h3m-3 3h7" /></> },
  { id: 'payments', label: 'รับชำระ', page: 'payments', icon: <><rect x="3" y="5" width="18" height="15" rx="2" /><path d="M3 10h18m-13 5h4" /></> },
  { id: 'funds', label: 'เงินประกัน/ล่วงหน้า', page: 'funds', icon: <><path d="M12 2v20m5-16H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" /></> },
  { id: 'expenses', label: 'ค่าใช้จ่าย', page: 'expenses', icon: <><path d="M4 4h16v16H4z" /><path d="M8 9h8m-8 4h5m-5 4h8" /></> },
  { id: 'maintenance', label: 'งานซ่อม', page: 'maintenance', icon: <><path d="m14 7 3 3m-9 9 9-9a4 4 0 0 0-5-5l-3 3-2-2-4 4 2 2-1 1a2 2 0 0 0 3 3l1-1Z" /></> },
  { id: 'complaints', label: 'ข้อร้องเรียน', page: 'complaints', icon: <><path d="M21 11.5a8.4 8.4 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.4 8.4 0 0 1 3.8-.9h.5a8.5 8.5 0 0 1 8 8z" /><path d="M12 8v4m0 4h.01" /></> },
  { id: 'reports', label: 'รายงาน', page: 'reports', icon: <><path d="M4 19V5m0 14h17" /><path d="m7 15 4-4 3 2 5-6" /></> },
  { id: 'users', label: 'ผู้ใช้และสิทธิ์', page: 'users', icon: <><circle cx="9" cy="8" r="3" /><path d="M3 20a6 6 0 0 1 12 0m2-8h5m-2-3v6" /></> },
  { id: 'setup', label: 'ตั้งค่าข้อมูล', page: 'setup', icon: <><circle cx="12" cy="12" r="3" /><path d="m19.4 15 .1.1a1.7 1.7 0 0 1-2.4 2.4l-.1-.1a1.7 1.7 0 0 0-2.9 1.2v.2a1.7 1.7 0 0 1-3.4 0v-.2a1.7 1.7 0 0 0-2.9-1.2l-.1.1a1.7 1.7 0 1 1-2.4-2.4l.1-.1a1.7 1.7 0 0 0-1.2-2.9H4a1.7 1.7 0 0 1 0-3.4h.2a1.7 1.7 0 0 0 1.2-2.9l-.1-.1a1.7 1.7 0 1 1 2.4-2.4l.1.1a1.7 1.7 0 0 0 2.9-1.2V2a1.7 1.7 0 0 1 3.4 0v.2a1.7 1.7 0 0 0 2.9 1.2l.1-.1a1.7 1.7 0 1 1 2.4 2.4l-.1.1a1.7 1.7 0 0 0 1.2 2.9h.2a1.7 1.7 0 0 1 0 3.4h-.2a1.7 1.7 0 0 0-1.2 2.9Z" /></> },
]

async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`/api${path}`, {
    ...options,
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', ...options.headers },
  })
  if (response.status === 204) return undefined as T
  const body = await response.json().catch(() => ({})) as { error?: string } & T
  if (!response.ok) throw new Error(body.error || `เกิดข้อผิดพลาด (${response.status})`)
  return body
}

function toPayload(form: HTMLFormElement) {
  return Object.fromEntries(new FormData(form).entries())
}

function formatBaht(amount: number | string) {
  return new Intl.NumberFormat('th-TH', { maximumFractionDigits: 2 }).format(Number(amount))
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat('th-TH', { dateStyle: 'medium', timeZone: 'Asia/Bangkok' }).format(new Date(`${value.slice(0, 10)}T00:00:00+07:00`))
}

function Icon({ children, size = 20 }: { children: ReactNode; size?: number }) {
  return <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">{children}</svg>
}

function App() {
  const [user, setUser] = useState<User | null>(null)
  const [authChecked, setAuthChecked] = useState(false)
  const [page, setPage] = useState<Page>('overview')
  const [rooms, setRooms] = useState<Room[]>([])
  const [customers, setCustomers] = useState<Customer[]>([])
  const [contracts, setContracts] = useState<Contract[]>([])
  const [bookings, setBookings] = useState<Booking[]>([])
  const [maintenanceRequests, setMaintenanceRequests] = useState<MaintenanceRequest[]>([])
  const [complaints, setComplaints] = useState<Complaint[]>([])
  const [billingPeriods, setBillingPeriods] = useState<BillingPeriod[]>([])
  const [meters, setMeters] = useState<Meter[]>([])
  const [meterReadings, setMeterReadings] = useState<MeterReading[]>([])
  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [payments, setPayments] = useState<Payment[]>([])
  const [receivables, setReceivables] = useState<Receivable[]>([])
  const [fundTransactions, setFundTransactions] = useState<FundTransaction[]>([])
  const [expenses, setExpenses] = useState<Expense[]>([])
  const [managedUsers, setManagedUsers] = useState<ManagedUser[]>([])
  const [managedCustomers, setManagedCustomers] = useState<{ id: string; code: string; fullName: string }[]>([])
  const [managedRoles, setManagedRoles] = useState<ManagedRole[]>([])
  const [permissionOptions, setPermissionOptions] = useState<PermissionOption[]>([])
  const [lookups, setLookups] = useState<Lookups>({ properties: [], buildings: [], floors: [], roomTypes: [], accounts: [], bankAccounts: [], charges: [], tariffs: [], suppliers: [] })
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [modal, setModal] = useState<'room' | 'tenant' | 'booking' | 'contract' | 'maintenance' | 'complaint' | null>(null)
  const [contractBooking, setContractBooking] = useState<Booking | null>(null)
  const [formError, setFormError] = useState('')
  const [pageError, setPageError] = useState('')
  const [loading, setLoading] = useState(false)
  const [notice, setNotice] = useState('')
  const [loginError, setLoginError] = useState('')
  const [loginBusy, setLoginBusy] = useState(false)

  const loadData = useCallback(async () => {
    if (!user || page === 'portal') return
    setLoading(true)
    setPageError('')
    try {
      if (page === 'overview' || page === 'rooms') {
        const [roomResult, lookupResult] = await Promise.all([
          api<{ rooms: Room[] }>('/rooms'),
          api<Lookups>('/lookups'),
        ])
        setRooms(roomResult.rooms)
        setLookups(lookupResult)
      } else if (page === 'tenants') {
        const result = await api<{ customers: Customer[] }>('/customers')
        setCustomers(result.customers)
      } else if (page === 'bookings') {
        const [bookingResult, roomResult, customerResult] = await Promise.all([
          api<{ bookings: Booking[] }>('/bookings'),
          api<{ rooms: Room[] }>('/rooms'),
          api<{ customers: Customer[] }>('/customers'),
        ])
        setBookings(bookingResult.bookings)
        setRooms(roomResult.rooms)
        setCustomers(customerResult.customers)
      } else if (page === 'contracts') {
        const [contractResult, roomResult, customerResult, lookupResult, bookingResult] = await Promise.all([
          api<{ contracts: Contract[] }>('/contracts'),
          api<{ rooms: Room[] }>('/rooms'),
          api<{ customers: Customer[] }>('/customers'),
          api<Lookups>('/lookups'),
          api<{ bookings: Booking[] }>('/bookings'),
        ])
        setContracts(contractResult.contracts)
        setRooms(roomResult.rooms)
        setCustomers(customerResult.customers)
        setLookups(lookupResult)
        setBookings(bookingResult.bookings)
      } else if (page === 'maintenance') {
        const [requestsResult, roomResult, lookupResult] = await Promise.all([
          api<{ requests: MaintenanceRequest[] }>('/maintenance-requests'),
          api<{ rooms: Room[] }>('/rooms'),
          api<Lookups>('/lookups'),
        ])
        setMaintenanceRequests(requestsResult.requests)
        setRooms(roomResult.rooms)
        setLookups(lookupResult)
      } else if (page === 'complaints') {
        const [complaintResult, roomResult] = await Promise.all([
          api<{ complaints: Complaint[] }>('/complaints'),
          api<{ rooms: Room[] }>('/rooms'),
        ])
        setComplaints(complaintResult.complaints)
        setRooms(roomResult.rooms)
      } else if (page === 'billing') {
        const [periodResult, meterResult, readingResult, invoiceResult, lookupResult] = await Promise.all([
          api<{ billingPeriods: BillingPeriod[] }>('/billing-periods'),
          api<{ meters: Meter[] }>('/meters'),
          api<{ meterReadings: MeterReading[] }>('/meter-readings'),
          api<{ invoices: Invoice[] }>('/invoices'),
          api<Lookups>('/lookups'),
        ])
        setBillingPeriods(periodResult.billingPeriods)
        setMeters(meterResult.meters)
        setMeterReadings(readingResult.meterReadings)
        setInvoices(invoiceResult.invoices)
        setLookups(lookupResult)
      } else if (page === 'payments') {
        const [paymentResult, invoiceResult, customerResult, lookupResult] = await Promise.all([
          api<{ payments: Payment[] }>('/payments'),
          api<{ invoices: Invoice[] }>('/invoices'),
          api<{ customers: Customer[] }>('/customers'),
          api<Lookups>('/lookups'),
        ])
        setPayments(paymentResult.payments)
        setInvoices(invoiceResult.invoices)
        setCustomers(customerResult.customers)
        setLookups(lookupResult)
      } else if (page === 'funds') {
        const [fundResult, contractResult, bookingResult, invoiceResult, lookupResult] = await Promise.all([
          api<{ fundTransactions: FundTransaction[] }>('/fund-transactions'),
          api<{ contracts: Contract[] }>('/contracts'),
          api<{ bookings: Booking[] }>('/bookings'),
          api<{ invoices: Invoice[] }>('/invoices'),
          api<Lookups>('/lookups'),
        ])
        setFundTransactions(fundResult.fundTransactions)
        setContracts(contractResult.contracts)
        setBookings(bookingResult.bookings)
        setInvoices(invoiceResult.invoices)
        setLookups(lookupResult)
      } else if (page === 'expenses') {
        const [expenseResult, lookupResult] = await Promise.all([
          api<{ expenses: Expense[] }>('/expenses'),
          api<Lookups>('/lookups'),
        ])
        setExpenses(expenseResult.expenses)
        setLookups(lookupResult)
      } else if (page === 'users') {
        const [usersResult, rolesResult, customersResult] = await Promise.all([
          api<{ users: ManagedUser[] }>('/admin/users'),
          api<{ roles: ManagedRole[]; permissions: PermissionOption[] }>('/admin/roles'),
          api<{ customers: { id: string; code: string; fullName: string }[] }>('/admin/customers'),
        ])
        setManagedUsers(usersResult.users)
        setManagedRoles(rolesResult.roles)
        setPermissionOptions(rolesResult.permissions)
        setManagedCustomers(customersResult.customers)
      } else if (page === 'reports') {
        const report = await api<{ receivables: Receivable[] }>('/reports/receivables')
        setReceivables(report.receivables)
      } else if (page === 'setup') {
        const [lookupResult, roomResult] = await Promise.all([
          api<Lookups>('/lookups'),
          api<{ rooms: Room[] }>('/rooms'),
        ])
        setLookups(lookupResult)
        setRooms(roomResult.rooms)
      }
    } catch (error) {
      setPageError(error instanceof Error ? error.message : 'ไม่สามารถโหลดข้อมูลได้')
    } finally {
      setLoading(false)
    }
  }, [user, page])

  useEffect(() => {
    let active = true
    api<{ user: User }>('/auth/me').then((result) => {
      if (active) {
        setUser(result.user)
        if (isTenantOnlyUser(result.user)) setPage('portal')
      }
    }).catch(() => {
      if (active) setUser(null)
    }).finally(() => {
      if (active) setAuthChecked(true)
    })
    return () => { active = false }
  }, [])

  useEffect(() => {
    const timer = window.setTimeout(() => { void loadData() }, 0)
    return () => window.clearTimeout(timer)
  }, [loadData])

  const counts = useMemo(() => rooms.reduce<Record<RoomStatus, number>>((total, room) => {
    total[room.status] += 1
    return total
  }, { available: 0, occupied: 0, reserved: 0, maintenance: 0, disabled: 0 }), [rooms])

  const filteredRooms = useMemo(() => {
    const query = search.trim().toLocaleLowerCase('th-TH')
    return rooms.filter((room) => {
      const matchesSearch = !query || [room.code, room.building, room.buildingCode, room.floorCode, room.tenant ?? ''].some((value) => value.toLocaleLowerCase('th-TH').includes(query))
      return matchesSearch && (statusFilter === 'all' || room.status === statusFilter)
    })
  }, [rooms, search, statusFilter])

  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setLoginBusy(true)
    setLoginError('')
    try {
      const result = await api<{ user: User }>('/auth/login', { method: 'POST', body: JSON.stringify(toPayload(event.currentTarget)) })
      setPage(isTenantOnlyUser(result.user) ? 'portal' : 'overview')
      setPageError('')
      setUser(result.user)
    } catch (error) {
      setLoginError(error instanceof Error ? error.message : 'เข้าสู่ระบบไม่สำเร็จ')
    } finally {
      setLoginBusy(false)
    }
  }

  async function logout() {
    try {
      await api('/auth/logout', { method: 'POST' })
      setUser(null)
      setPage('overview')
      setPageError('')
      setRooms([])
      setCustomers([])
      setContracts([])
      setBookings([])
      setMaintenanceRequests([])
      setComplaints([])
    } catch (error) {
      setPageError(error instanceof Error ? error.message : 'ออกจากระบบไม่สำเร็จ')
    }
  }

  async function submitForm(event: FormEvent<HTMLFormElement>, path: string, afterSave: () => Promise<void>) {
    event.preventDefault()
    setFormError('')
    try {
      await api(path, { method: 'POST', body: JSON.stringify(toPayload(event.currentTarget)) })
      setNotice('บันทึกข้อมูลเรียบร้อย')
      setModal(null)
      await afterSave()
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'บันทึกข้อมูลไม่สำเร็จ')
    }
  }

  const dateLabel = todayLabel
  const title = page === 'overview' ? 'ภาพรวม' : page === 'rooms' ? 'จัดการห้องพัก' : page === 'tenants' ? 'ผู้เช่า' : page === 'bookings' ? 'การจอง' : page === 'contracts' ? 'สัญญาเช่า' : page === 'billing' ? 'รอบบิล' : page === 'payments' ? 'รับชำระ' : page === 'funds' ? 'เงินประกัน/ล่วงหน้า' : page === 'expenses' ? 'ค่าใช้จ่าย' : page === 'maintenance' ? 'งานซ่อม' : page === 'complaints' ? 'ข้อร้องเรียน' : page === 'reports' ? 'รายงาน' : page === 'users' ? 'ผู้ใช้และสิทธิ์' : page === 'portal' ? 'พอร์ทัลผู้เช่า' : 'ตั้งค่าข้อมูลพื้นฐาน'

  if (!authChecked) return <div className="loading-screen"><span className="spinner" />กำลังตรวจสอบการเข้าสู่ระบบ...</div>
  if (!user) return <LoginPage login={login} busy={loginBusy} error={loginError} />

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a className="brand" href="#" onClick={(event) => { event.preventDefault(); setPage('overview') }}>
          <span className="brand-mark"><Icon size={23}><path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1z" /></Icon></span>
          <span className="brand-name">บ้าน<span>สุข</span><small>RESIDENCE MANAGER</small></span>
        </a>
        <div className="workspace-label">เมนูหลัก</div>
        <nav className="main-nav" aria-label="เมนูหลัก">
          {navigation.filter((item) => item.page === 'portal' ? user.permissions.includes('tenant.portal') : !isTenantOnlyUser(user)).map((item) => (
            <button className={`nav-item ${item.page === page ? 'active' : ''} ${!item.page ? 'nav-disabled' : ''}`} key={item.id} type="button" disabled={!item.page} title={!item.page ? 'ยังไม่พร้อมใช้งาน' : undefined} onClick={() => item.page && setPage(item.page)}>
              <Icon>{item.icon}</Icon><span>{item.label}</span>{!item.page && <span className="nav-soon">เร็วๆ นี้</span>}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="help-card"><span className="help-icon"><Icon size={19}><circle cx="12" cy="12" r="9" /><path d="M9.6 9a2.5 2.5 0 1 1 4.7 1.2c-.7 1-2.3 1.2-2.3 2.8m0 3h.01" /></Icon></span><div><strong>ต้องการความช่วยเหลือ?</strong><span>ดูคู่มือใน README</span></div><span className="arrow">↗</span></div>
          <button className="profile-button" type="button" onClick={() => void logout()} title="คลิกเพื่อออกจากระบบ"><span className="avatar">{user.displayName.slice(0, 1)}</span><span className="profile-name"><strong>{user.displayName}</strong><small>{user.username} · ออกจากระบบ</small></span><span className="profile-dots">↪</span></button>
        </div>
      </aside>

      <main className="main-area">
        <header className="topbar"><div className="breadcrumb"><span>บ้านสุข เรสซิเดนซ์</span><span className="crumb-separator">/</span><strong>{title}</strong></div><div className="topbar-actions"><span className="date-label"><Icon size={17}><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M16 3v4M8 3v4M3 10h18" /></Icon> {dateLabel}</span><span className="connected-indicator"><i /> เชื่อมต่อระบบแล้ว</span></div></header>
        <div className="content">
          {notice && <div className="success-notice" role="status">{notice}<button type="button" aria-label="ปิด" onClick={() => setNotice('')}>×</button></div>}
          {pageError && <div className="page-error" role="alert">{pageError}<button type="button" aria-label="ลองโหลดอีกครั้ง" onClick={() => void loadData()}>ลองอีกครั้ง</button></div>}
          {loading && <div className="loading-inline"><span className="spinner" />กำลังโหลดข้อมูล...</div>}
          {page === 'overview' && <Overview rooms={rooms} counts={counts} dateLabel={dateLabel} onOpenRooms={() => setPage('rooms')} onAddRoom={() => { setFormError(''); setModal('room') }} />}
          {page === 'rooms' && <RoomsPage rooms={filteredRooms} counts={counts} search={search} setSearch={setSearch} statusFilter={statusFilter} setStatusFilter={setStatusFilter} onAdd={() => { setFormError(''); setModal('room') }} />}
          {page === 'tenants' && <TenantsPage customers={customers} onAdd={() => { setFormError(''); setModal('tenant') }} />}
          {page === 'bookings' && <BookingsPage bookings={bookings} rooms={rooms} customers={customers} onAdd={() => { setFormError(''); setModal('booking') }} onCreateContract={(booking) => { setContractBooking(booking); setFormError(''); setModal('contract') }} onStatusChange={async (id, status) => { try { await api(`/bookings/${id}/status`, { method: 'PATCH', body: JSON.stringify({ status }) }); await loadData() } catch (error) { setPageError(error instanceof Error ? error.message : 'เปลี่ยนสถานะการจองไม่สำเร็จ') } }} />}
          {page === 'contracts' && <ContractsPage contracts={contracts} rooms={rooms} customers={customers} bookings={bookings} onAdd={() => { setContractBooking(null); setFormError(''); setModal('contract') }} onMove={async (id, payload) => {
            try {
              await api(`/contracts/${id}/move-room`, { method: 'POST', body: JSON.stringify(payload) })
              setNotice('ย้ายห้องและเก็บประวัติช่วงห้องเรียบร้อย')
              await loadData()
            } catch (error) {
              setPageError(error instanceof Error ? error.message : 'ย้ายห้องไม่สำเร็จ')
            }
          }} onEnd={async (id, payload) => {
            try {
              await api(`/contracts/${id}/end`, { method: 'POST', body: JSON.stringify(payload) })
              setNotice('สิ้นสุดสัญญาเรียบร้อย การเรียกเก็บ/คืนเงินที่เหลือต้องจัดการแยก')
              await loadData()
            } catch (error) {
              setPageError(error instanceof Error ? error.message : 'สิ้นสุดสัญญาไม่สำเร็จ')
            }
          }} />}
          {page === 'billing' && <BillingPage periods={billingPeriods} meters={meters} readings={meterReadings} invoices={invoices} properties={lookups.properties} accounts={lookups.accounts} onChanged={loadData} />}
          {page === 'payments' && <PaymentsPage payments={payments} invoices={invoices} customers={customers} bankAccounts={lookups.bankAccounts} accounts={lookups.accounts} onChanged={loadData} />}
          {page === 'funds' && <FundsPage transactions={fundTransactions} contracts={contracts} bookings={bookings} invoices={invoices} bankAccounts={lookups.bankAccounts} accounts={lookups.accounts} onChanged={loadData} />}
          {page === 'expenses' && <ExpensesPage expenses={expenses} bankAccounts={lookups.bankAccounts} accounts={lookups.accounts} suppliers={lookups.suppliers} onChanged={loadData} />}
          {page === 'reports' && <ReportsPage receivables={receivables} onChanged={loadData} />}
          {page === 'users' && <UsersPage users={managedUsers} roles={managedRoles} permissions={permissionOptions} customers={managedCustomers} onChanged={loadData} />}
          {page === 'portal' && user.permissions.includes('tenant.portal') && <TenantPortalPage />}
          {page === 'maintenance' && <MaintenancePage requests={maintenanceRequests} rooms={rooms} suppliers={lookups.suppliers} onAdd={() => { setFormError(''); setModal('maintenance') }} onStatusChange={async (id, status) => { try { await api(`/maintenance-requests/${id}/status`, { method: 'PATCH', body: JSON.stringify({ status }) }); await loadData() } catch (error) { setPageError(error instanceof Error ? error.message : 'เปลี่ยนสถานะงานซ่อมไม่สำเร็จ') } }} onCreateJob={async (id, payload) => { try { await api(`/maintenance-requests/${id}/jobs`, { method: 'POST', body: JSON.stringify(payload) }); await loadData() } catch (error) { setPageError(error instanceof Error ? error.message : 'มอบหมายงานซ่อมไม่สำเร็จ') } }} onCompleteJob={async (id, jobId, payload) => { try { await api(`/maintenance-requests/${id}/jobs/${jobId}`, { method: 'PATCH', body: JSON.stringify(payload) }); await loadData() } catch (error) { setPageError(error instanceof Error ? error.message : 'บันทึกผลซ่อมไม่สำเร็จ') } }} />}
          {page === 'complaints' && <ComplaintsPage complaints={complaints} onAdd={() => { setFormError(''); setModal('complaint') }} onStatusChange={async (id, status, resolution) => { try { await api(`/complaints/${id}/status`, { method: 'PATCH', body: JSON.stringify({ status, resolution }) }); await loadData() } catch (error) { setPageError(error instanceof Error ? error.message : 'เปลี่ยนสถานะข้อร้องเรียนไม่สำเร็จ') } }} />}
          {page === 'setup' && <SetupPage lookups={lookups} rooms={rooms} onSaved={() => { void loadData() }} />}
          <footer className="page-footer"><span>บ้านสุข เรสซิเดนซ์</span><span>ข้อมูลจากฐานข้อมูล PostgreSQL</span></footer>
        </div>
      </main>

      {modal === 'room' && <Modal title="เพิ่มห้องพัก" subtitle="ระบุชั้นและประเภทห้องจากข้อมูลพื้นฐาน" error={formError} close={() => setModal(null)} submit={(event) => submitForm(event, '/rooms', loadData)}>
        {(!lookups.floors.length || !lookups.roomTypes.length) && <div className="inline-warning">ยังไม่มีชั้นหรือประเภทห้อง กรุณาเพิ่มข้อมูลใน “ตั้งค่าข้อมูลพื้นฐาน” ก่อน</div>}
        <div className="form-grid">
          <label>รหัสห้อง<span className="required">*</span><input name="code" required maxLength={30} placeholder="เช่น A-301" /></label>
          <label>ชั้น<span className="required">*</span><select name="floorId" required defaultValue=""><option value="" disabled>เลือกชั้น</option>{lookups.floors.map((floor) => { const building = lookups.buildings.find((item) => item.id === floor.buildingId); return <option key={floor.id} value={floor.id}>{building?.name ?? 'อาคาร'} · {floor.code}</option> })}</select></label>
          <label>ประเภทห้อง<span className="required">*</span><select name="roomTypeId" required defaultValue=""><option value="" disabled>เลือกประเภทห้อง</option>{lookups.roomTypes.map((type) => <option key={type.id} value={type.id}>{type.name}</option>)}</select></label>
          <label>ค่าเช่าต่อเดือน (บาท)<span className="required">*</span><input name="baseRent" type="number" min="0" step="0.01" required placeholder="ระบุจำนวนเงิน" /></label>
          <label className="form-full">สถานะการใช้งาน<select name="operationalStatus" defaultValue="available"><option value="available">พร้อมใช้งาน</option><option value="maintenance">งดใช้ / ซ่อมบำรุง</option><option value="disabled">ปิดใช้งาน</option></select></label>
        </div>
      </Modal>}

      {modal === 'maintenance' && <Modal title="แจ้งงานซ่อม" subtitle="บันทึกปัญหาเพื่อมอบหมายและติดตามการซ่อม" error={formError} close={() => setModal(null)} submit={(event) => submitForm(event, '/maintenance-requests', loadData)}>
        <div className="form-grid"><label className="form-full">ห้องพัก<span className="required">*</span><select name="roomId" required defaultValue=""><option value="" disabled>เลือกห้อง</option>{rooms.map((room) => <option key={room.id} value={room.id}>{room.property} · {room.building} {room.floorCode} · {room.code}</option>)}</select></label><label>ระดับความสำคัญ<select name="priority" defaultValue="normal"><option value="low">ต่ำ</option><option value="normal">ปกติ</option><option value="high">สูง</option><option value="urgent">เร่งด่วน</option></select></label><label className="form-full">รายละเอียดปัญหา<span className="required">*</span><textarea name="description" rows={4} required maxLength={5000} /></label></div>
      </Modal>}

      {modal === 'complaint' && <Modal title="รับข้อร้องเรียน" subtitle="แยกติดตามเรื่องร้องเรียนจากงานซ่อม" error={formError} close={() => setModal(null)} submit={(event) => submitForm(event, '/complaints', loadData)}>
        <div className="form-grid"><label className="form-full">ห้องพัก<span className="required">*</span><select name="roomId" required defaultValue=""><option value="" disabled>เลือกห้อง</option>{rooms.map((room) => <option key={room.id} value={room.id}>{room.property} · {room.building} {room.floorCode} · {room.code}</option>)}</select></label><label className="form-full">รายละเอียดข้อร้องเรียน<span className="required">*</span><textarea name="description" rows={4} required maxLength={5000} /></label></div>
      </Modal>}

      {modal === 'tenant' && <Modal title="เพิ่มผู้เช่า" subtitle="บันทึกข้อมูลบุคคลลงฐานข้อมูล" error={formError} close={() => setModal(null)} submit={(event) => submitForm(event, '/customers', loadData)}>
        <div className="form-grid"><label className="form-full">ชื่อ-นามสกุล<span className="required">*</span><input name="fullName" required maxLength={200} /></label><label>โทรศัพท์<input name="phone" maxLength={40} /></label><label>อีเมล<input name="email" type="email" maxLength={254} /></label><label>วันเกิด<input name="birthDate" type="date" /></label><label className="form-full">ที่อยู่<textarea name="address" rows={3} /></label></div>
      </Modal>}

      {modal === 'booking' && <Modal title="สร้างรายการจอง" subtitle="ระบุผู้จอง ห้อง และช่วงวันที่ที่ต้องการ" error={formError} close={() => setModal(null)} submit={(event) => submitForm(event, '/bookings', loadData)}>
        <div className="form-grid"><label className="form-full">ผู้จอง<span className="required">*</span><select name="customerId" required defaultValue=""><option value="" disabled>เลือกผู้จอง</option>{customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.fullName} ({customer.code})</option>)}</select></label><label className="form-full">ห้องพัก<span className="required">*</span><select name="roomId" required defaultValue=""><option value="" disabled>เลือกห้องว่าง</option>{rooms.filter((room) => room.status === 'available').map((room) => <option key={room.id} value={room.id}>{room.property} · {room.building} {room.floorCode} · {room.code}</option>)}</select></label><label>วันเริ่มจอง<span className="required">*</span><input name="plannedStart" type="date" required /></label><label>วันสิ้นสุด<span className="required">*</span><input name="plannedEnd" type="date" required /></label><label className="form-full">หมดอายุการจอง (ไม่บังคับ)<input name="expiresAt" type="datetime-local" /></label></div>
      </Modal>}

      {modal === 'contract' && <Modal key={contractBooking?.id ?? 'direct-contract'} title="สร้างสัญญาเช่า" subtitle="ตรวจสอบช่วงห้องว่างก่อนบันทึกสัญญา" error={formError} close={() => setModal(null)} submit={(event) => submitForm(event, '/contracts', loadData)}>
        <div className="form-grid">
          <label className="form-full">อ้างอิงการจองที่ยืนยันแล้ว<select name="bookingId" defaultValue={contractBooking?.id ?? ''} onChange={(event) => { const booking = bookings.find((item) => item.id === event.target.value); const form = event.currentTarget.form; if (booking && form) { (form.elements.namedItem('customerId') as HTMLSelectElement).value = booking.customerId ?? ''; (form.elements.namedItem('roomId') as HTMLSelectElement).value = booking.roomId; (form.elements.namedItem('startDate') as HTMLInputElement).value = booking.plannedStart.slice(0, 10); (form.elements.namedItem('endDate') as HTMLInputElement).value = booking.plannedEnd.slice(0, 10) } }}><option value="">ไม่อ้างอิง (ทำสัญญาโดยตรง)</option>{bookings.filter((booking) => booking.status === 'confirmed').map((booking) => <option key={booking.id} value={booking.id}>{booking.documentNo} · {booking.customerName} · {booking.roomCode} · {formatDate(booking.plannedStart)}–{formatDate(booking.plannedEnd)}</option>)}</select></label>
          <label className="form-full">ผู้ทำสัญญา<span className="required">*</span><select name="customerId" required defaultValue={contractBooking?.customerId ?? ''}><option value="" disabled>เลือกผู้เช่า</option>{customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.fullName} ({customer.code})</option>)}</select></label>
          <label className="form-full">ห้องพัก<span className="required">*</span><select name="roomId" required defaultValue={contractBooking?.roomId ?? ''}><option value="" disabled>เลือกห้องว่าง</option>{rooms.map((room) => <option key={room.id} value={room.id}>{room.property} · {room.building} {room.floorCode} · {room.code} ({statusLabels[room.status]})</option>)}</select></label>
          <label>วันเริ่มสัญญา<span className="required">*</span><input name="startDate" type="date" required defaultValue={contractBooking?.plannedStart.slice(0, 10) ?? ''} /></label><label>วันสิ้นสุดสัญญา<span className="required">*</span><input name="endDate" type="date" required defaultValue={contractBooking?.plannedEnd.slice(0, 10) ?? ''} /></label>
          <label>รอบค่าเช่า<select name="rentalCycle" defaultValue="monthly"><option value="monthly">รายเดือน</option><option value="yearly">รายปี</option></select></label>
          <label>ค่าเช่าต่องวด (บาท)<span className="required">*</span><input name="rentAmount" type="number" min="0" step="0.01" required /></label>
          <label>เงินประกัน (บาท)<input name="depositRequired" type="number" min="0" step="0.01" defaultValue="0" /></label>
          <label>วันตัดรอบบิล<input name="billingDay" type="number" min="1" max="28" defaultValue="25" /></label>
          <label>ครบกำหนดหลังออกบิล (วัน)<input name="dueDays" type="number" min="0" max="365" defaultValue="7" /></label>
        </div>
      </Modal>}
    </div>
  )
}

function LoginPage({ login, busy, error }: { login: (event: FormEvent<HTMLFormElement>) => void; busy: boolean; error: string }) {
  return <main className="login-shell"><section className="login-card"><div className="login-brand"><span className="brand-mark"><Icon size={25}><path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1z" /></Icon></span><div><strong>บ้านสุข เรสซิเดนซ์</strong><small>ระบบบริหารห้องเช่า</small></div></div><p className="eyebrow">ยินดีต้อนรับ</p><h1>เข้าสู่ระบบ</h1><p className="login-description">ใช้บัญชีเจ้าหน้าที่ที่ผู้ดูแลระบบสร้างไว้</p><form onSubmit={login}><label>ชื่อผู้ใช้<input name="username" autoComplete="username" required /></label><label>รหัสผ่าน<input name="password" type="password" autoComplete="current-password" required /></label>{error && <p className="form-error" role="alert">{error}</p>}<button className="button button-primary login-submit" type="submit" disabled={busy}>{busy ? 'กำลังเข้าสู่ระบบ...' : 'เข้าสู่ระบบ'}</button></form><p className="login-footnote">ต้องตั้งค่า PostgreSQL และสร้างบัญชีผู้ดูแลก่อนเริ่มใช้งาน ดูขั้นตอนใน README</p></section></main>
}

function Overview({ rooms, counts, dateLabel, onOpenRooms, onAddRoom }: { rooms: Room[]; counts: Record<RoomStatus, number>; dateLabel: string; onOpenRooms: () => void; onAddRoom: () => void }) {
  const total = rooms.length
  const occupancy = total ? Math.round((counts.occupied / total) * 100) : 0
  const monthlyRent = rooms.filter((room) => room.status === 'occupied').reduce((sum, room) => sum + Number(room.rent), 0)
  return <>
    <section className="welcome-row"><div><p className="eyebrow">{dateLabel}</p><h1>สวัสดี, ผู้ดูแล <span className="wave">✦</span></h1><p className="subheading">ข้อมูลสรุปจากห้องพักและสัญญาที่มีผลในปัจจุบัน</p></div><button className="button button-primary" type="button" onClick={onAddRoom}><Icon size={18}><path d="M12 5v14m-7-7h14" /></Icon> เพิ่มห้องพัก</button></section>
    <section className="stats-grid" aria-label="สรุปสถานะห้อง"><StatCard title="ห้องพักทั้งหมด" value={total} caption="ห้องในทุกอาคาร" icon={<><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M3 10h18M8 10v10m8-10v10" /></>} tone="blue" /><StatCard title="มีผู้พักอาศัย" value={counts.occupied} caption={`${occupancy}% ของห้องทั้งหมด`} icon={<><circle cx="9" cy="8" r="3" /><path d="M3 20a6 6 0 0 1 12 0m3-9a3 3 0 1 0 0-6m1 9a5 5 0 0 1 3 5" /></>} tone="green" /><StatCard title="ห้องว่าง" value={counts.available} caption="พร้อมให้เช่า" icon={<><path d="M3 10 12 3l9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1z" /><path d="M9 14h6" /></>} tone="amber" /><StatCard title="งดใช้ / ปิด" value={counts.maintenance + counts.disabled} caption="รอตรวจสอบ / ซ่อมแซม" icon={<><path d="m14 7 3 3m-9 9 9-9a4 4 0 0 0-5-5l-3 3-2-2-4 4 2 2-1 1a2 2 0 0 0 3 3l1-1Z" /></>} tone="rose" /></section>
    <section className="dashboard-grid"><div className="panel occupancy-panel"><div className="panel-heading"><div><h2>สถานะห้องพัก</h2><p>สถานะปัจจุบันจากสัญญาและรายการห้อง</p></div><button type="button" className="subtle-link" onClick={onOpenRooms}>ดูห้องพักทั้งหมด <span>→</span></button></div><div className="occupancy-content"><div className="donut-wrap"><div className="donut" style={{ '--occupied': `${total ? (counts.occupied / total) * 100 : 0}%`, '--reserved': `${total ? (counts.reserved / total) * 100 : 0}%`, '--maintenance': `${total ? (counts.maintenance / total) * 100 : 0}%`, '--available': `${total ? (counts.available / total) * 100 : 0}%` } as React.CSSProperties}><div className="donut-center"><strong>{occupancy}%</strong><span>เข้าพัก</span></div></div></div><div className="legend-list"><LegendRow label="มีผู้พัก" value={counts.occupied} color="legend-green" /><LegendRow label="ว่าง" value={counts.available} color="legend-blue" /><LegendRow label="จองแล้ว" value={counts.reserved} color="legend-amber" /><LegendRow label="งดใช้ / ปิด" value={counts.maintenance + counts.disabled} color="legend-rose" /></div></div><div className="occupancy-foot"><span>อัตราการเข้าพัก</span><strong>{occupancy}%</strong><span className="occupancy-foot-note">จากห้องที่ลงทะเบียน</span></div></div><div className="panel rent-panel"><div className="panel-heading"><div><h2>ค่าเช่าตามสัญญา</h2><p>ยอดต่อเดือนของห้องที่มีผู้พัก</p></div></div><div className="rent-total"><strong>฿ {formatBaht(monthlyRent)}</strong></div><p className="rent-caption">ยังไม่ใช่ยอดรับเงินจริงหรือรายได้ทางบัญชี</p><div className="rent-empty">ระบบจะแสดงรายงานรายเดือนได้เมื่อเปิดใช้โมดูลรอบบิลและรับชำระ</div></div></section>
    <section className="panel rooms-panel"><div className="panel-heading"><div><h2>ห้องพักล่าสุด</h2><p>สถานะห้องพักจากฐานข้อมูล</p></div><button type="button" className="subtle-link" onClick={onOpenRooms}>ไปหน้าจัดการห้อง <span>→</span></button></div><RoomTable rooms={rooms.slice(0, 5)} /></section>
  </>
}

function RoomsPage({ rooms, counts, search, setSearch, statusFilter, setStatusFilter, onAdd }: { rooms: Room[]; counts: Record<RoomStatus, number>; search: string; setSearch: (value: string) => void; statusFilter: string; setStatusFilter: (value: string) => void; onAdd: () => void }) {
  const count = Object.values(counts).reduce((sum, value) => sum + value, 0)
  return <>
    <section className="welcome-row rooms-welcome"><div><p className="eyebrow">ข้อมูลพื้นฐาน / ห้องพัก</p><h1>จัดการห้องพัก</h1><p className="subheading">ค้นหาและดูสถานะห้องพักในทุกโครงการและอาคาร</p></div><button className="button button-primary" type="button" onClick={onAdd}><Icon size={18}><path d="M12 5v14m-7-7h14" /></Icon> เพิ่มห้องพัก</button></section>
    <section className="stats-grid room-stats"><MiniStat label="ทั้งหมด" value={count} color="blue" /><MiniStat label="มีผู้พัก" value={counts.occupied} color="green" /><MiniStat label="ว่าง" value={counts.available} color="amber" /><MiniStat label="จอง / งดใช้ / ปิด" value={counts.reserved + counts.maintenance + counts.disabled} color="rose" /></section>
    <section className="panel rooms-panel full-rooms-panel"><div className="room-toolbar"><div><h2>รายการห้องพัก <span className="result-count">{rooms.length} ห้อง</span></h2><p>ข้อมูลสถานะและผู้เช่าปัจจุบัน</p></div><div className="filters"><label className="search-box"><Icon size={18}><circle cx="11" cy="11" r="7" /><path d="m20 20-4-4" /></Icon><input aria-label="ค้นหาห้องพัก" placeholder="ค้นหาห้อง, อาคาร, ผู้เช่า..." value={search} onChange={(event) => setSearch(event.target.value)} /></label><label className="select-wrap"><span className="sr-only">กรองตามสถานะ</span><select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option value="all">ทุกสถานะ</option>{Object.entries(statusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label></div></div><RoomTable rooms={rooms} emptyMessage={search || statusFilter !== 'all' ? 'ไม่พบห้องที่ตรงกับเงื่อนไขค้นหา' : 'ยังไม่มีห้องพัก กรุณาเพิ่มโครงการ อาคาร ชั้น และประเภทห้องก่อน'} /></section>
  </>
}

function TenantsPage({ customers, onAdd }: { customers: Customer[]; onAdd: () => void }) {
  return <><section className="welcome-row"><div><p className="eyebrow">ข้อมูลบุคคล</p><h1>ผู้เช่าและลูกค้า</h1><p className="subheading">ข้อมูลผู้ทำสัญญาและผู้พักที่บันทึกไว้</p></div><button className="button button-primary" type="button" onClick={onAdd}><Icon size={18}><path d="M12 5v14m-7-7h14" /></Icon> เพิ่มผู้เช่า</button></section><section className="panel rooms-panel full-rooms-panel"><div className="panel-heading"><div><h2>รายชื่อผู้เช่า <span className="result-count">{customers.length} ราย</span></h2><p>สร้างรหัสผู้เช่าอัตโนมัติเมื่อบันทึก</p></div></div><div className="table-scroll"><table className="room-table"><thead><tr><th>รหัส</th><th>ชื่อ-นามสกุล</th><th>โทรศัพท์</th><th>อีเมล</th></tr></thead><tbody>{customers.length ? customers.map((customer) => <tr key={customer.id}><td><strong>{customer.code}</strong></td><td>{customer.fullName}</td><td>{customer.phone || '—'}</td><td>{customer.email || '—'}</td></tr>) : <tr><td className="empty-cell" colSpan={4}>ยังไม่มีข้อมูลผู้เช่า</td></tr>}</tbody></table></div></section></>
}

function BookingsPage({ bookings, rooms, customers, onAdd, onCreateContract, onStatusChange }: { bookings: Booking[]; rooms: Room[]; customers: Customer[]; onAdd: () => void; onCreateContract: (booking: Booking) => void; onStatusChange: (id: string, status: 'confirmed' | 'cancelled') => void }) {
  const statusText: Record<string, string> = { pending: 'รอดำเนินการ', confirmed: 'ยืนยันแล้ว', converted: 'ทำสัญญาแล้ว', cancelled: 'ยกเลิก', expired: 'หมดอายุ' }
  return <><section className="welcome-row"><div><p className="eyebrow">การเช่า / จองห้อง</p><h1>รายการจอง</h1><p className="subheading">ตรวจสอบห้องว่างและช่วงวันที่ก่อนยืนยันการจอง</p></div><button className="button button-primary" type="button" disabled={!customers.length || !rooms.some((room) => room.status === 'available')} onClick={onAdd}><Icon size={18}><path d="M12 5v14m-7-7h14" /></Icon> สร้างรายการจอง</button></section>{!customers.length && <div className="inline-warning">เพิ่มผู้จองในเมนูผู้เช่าก่อนทำรายการจอง</div>}<section className="panel rooms-panel full-rooms-panel"><div className="panel-heading"><div><h2>การจองทั้งหมด <span className="result-count">{bookings.length} รายการ</span></h2><p>การจองที่รอ ยืนยัน หรือเปลี่ยนเป็นสัญญาแล้ว</p></div></div><div className="table-scroll"><table className="room-table"><thead><tr><th>เลขที่จอง</th><th>ผู้จอง</th><th>ห้องพัก</th><th>ช่วงวันที่</th><th>สถานะ</th><th>ดำเนินการ</th></tr></thead><tbody>{bookings.length ? bookings.map((booking) => <tr key={booking.id}><td><strong>{booking.documentNo}</strong></td><td>{booking.customerName}</td><td>{booking.building} · {booking.roomCode}</td><td>{formatDate(booking.plannedStart)} – {formatDate(booking.plannedEnd)}</td><td><span className={`status-pill ${booking.status === 'confirmed' ? 'occupied' : booking.status === 'pending' ? 'reserved' : 'available'}`}><i />{statusText[booking.status] ?? booking.status}</span></td><td>{booking.status === 'pending' ? <div className="row-actions"><button className="text-action" type="button" onClick={() => onStatusChange(booking.id, 'confirmed')}>ยืนยัน</button><button className="text-action danger" type="button" onClick={() => onStatusChange(booking.id, 'cancelled')}>ยกเลิก</button></div> : booking.status === 'confirmed' ? <button className="text-action" type="button" onClick={() => onCreateContract(booking)}>ทำสัญญา</button> : <span className="muted-dash">—</span>}</td></tr>) : <tr><td className="empty-cell" colSpan={6}>ยังไม่มีรายการจอง</td></tr>}</tbody></table></div></section></>
}

function ContractsPage({ contracts, rooms, customers, bookings, onAdd, onMove, onEnd }: {
  contracts: Contract[]
  rooms: Room[]
  customers: Customer[]
  bookings: Booking[]
  onAdd: () => void
  onMove: (id: string, payload: Record<string, FormDataEntryValue>) => Promise<void>
  onEnd: (id: string, payload: Record<string, FormDataEntryValue>) => Promise<void>
}) {
  const availableCount = rooms.filter((room) => room.status === 'available').length
  const availableBookings = bookings.filter((booking) => booking.status === 'confirmed')
  return <>
    <section className="welcome-row"><div><p className="eyebrow">การเช่า / สัญญา</p><h1>สัญญาเช่า</h1><p className="subheading">รายการสัญญาและช่วงเวลาใช้งานห้อง</p></div><button className="button button-primary" type="button" disabled={!customers.length || (!availableCount && !availableBookings.length)} title={!customers.length ? 'เพิ่มผู้เช่าก่อนสร้างสัญญา' : undefined} onClick={onAdd}><Icon size={18}><path d="M12 5v14m-7-7h14" /></Icon> สร้างสัญญา</button></section>
    {!customers.length && <div className="inline-warning">เพิ่มผู้เช่าก่อนสร้างสัญญาเช่า</div>}
    <section className="panel rooms-panel full-rooms-panel"><div className="panel-heading"><div><h2>สัญญาทั้งหมด <span className="result-count">{contracts.length} ฉบับ</span></h2><p>ย้ายห้องเริ่มมีผลวันถัดไป เพื่อเก็บช่วงห้องเดิมจนถึงวันก่อนย้าย</p></div></div>
      <div className="table-scroll"><table className="room-table"><thead><tr><th>เลขที่สัญญา</th><th>ผู้ทำสัญญา</th><th>ห้องพัก</th><th>รอบ / ค่าเช่า</th><th>ระยะเวลา</th><th>สถานะ</th><th>ดำเนินการ</th></tr></thead><tbody>{contracts.length ? contracts.map((contract) => <tr key={contract.id}>
        <td><strong>{contract.documentNo}</strong></td><td>{contract.customerName}</td><td>{contract.building ? `${contract.building} · ` : ''}{contract.roomCode}</td>
        <td>{contract.rentalCycle === 'monthly' ? 'รายเดือน' : 'รายปี'} · ฿ {formatBaht(contract.rentAmount)}</td>
        <td>{formatDate(contract.startDate)} – {formatDate(contract.endDate)}</td>
        <td><span className={`status-pill ${contract.status === 'active' ? 'occupied' : 'reserved'}`}><i />{contract.status === 'active' ? 'ใช้งาน' : contract.status}</span></td>
        <td>{contract.status === 'active' ? <div className="contract-actions">
          <details><summary className="text-action">ย้ายห้อง</summary><form className="contract-action-form" onSubmit={(event) => { event.preventDefault(); void onMove(contract.id, toPayload(event.currentTarget)) }}>
            <label>ห้องปลายทาง<select name="roomId" required defaultValue=""><option value="" disabled>เลือกห้องว่าง</option>{rooms.filter((room) => room.status === 'available' && room.id !== contract.roomId).map((room) => <option key={room.id} value={room.id}>{room.building} · {room.code}</option>)}</select></label>
            <label>วันเริ่มห้องใหม่<input name="effectiveDate" type="date" min={tomorrowIsoDate} max={contract.endDate} required /></label>
            <label>ค่าเช่าห้องใหม่<input name="rentAmount" type="number" min="0" step="0.01" defaultValue={contract.rentAmount} required /></label>
            <label>บันทึกมิเตอร์ส่งมอบ<textarea name="meterHandoverNote" rows={2} maxLength={2000} /></label>
            <button className="button button-primary" type="submit" disabled={rooms.filter((room) => room.status === 'available' && room.id !== contract.roomId).length === 0}>ยืนยันย้าย</button>
          </form></details>
          <details><summary className="text-action danger">สิ้นสุดสัญญา</summary><form className="contract-action-form" onSubmit={(event) => { event.preventDefault(); void onEnd(contract.id, toPayload(event.currentTarget)) }}>
            <label>วันสุดท้ายที่พัก<input name="endDate" type="date" min={contract.startDate} max={todayIsoDate} defaultValue={todayIsoDate < contract.startDate ? contract.startDate : todayIsoDate} required /></label>
            <p className="form-hint">ระบบจะหยุดสัญญาและปิดช่วงห้องเท่านั้น กรุณาตรวจหนี้ เงินประกัน และรายการคืนเงินแยกต่างหาก</p>
            <button className="button button-secondary" type="submit">สิ้นสุดสัญญา</button>
          </form></details>
        </div> : <span className="muted-dash">—</span>}</td>
      </tr>) : <tr><td className="empty-cell" colSpan={7}>ยังไม่มีสัญญาเช่า</td></tr>}</tbody></table></div>
    </section>
  </>
}

function MaintenancePage({ requests, rooms, suppliers, onAdd, onStatusChange, onCreateJob, onCompleteJob }: {
  requests: MaintenanceRequest[]
  rooms: Room[]
  suppliers: Lookups['suppliers']
  onAdd: () => void
  onStatusChange: (id: string, status: 'assigned' | 'in_progress' | 'completed' | 'cancelled') => void
  onCreateJob: (id: string, payload: Record<string, FormDataEntryValue>) => Promise<void>
  onCompleteJob: (id: string, jobId: string, payload: Record<string, FormDataEntryValue>) => Promise<void>
}) {
  const nextStatus: Record<string, 'assigned' | 'in_progress' | 'completed'> = { new: 'assigned', assigned: 'in_progress', in_progress: 'completed' }
  const label: Record<string, string> = { new: 'ใหม่', assigned: 'มอบหมายแล้ว', in_progress: 'กำลังดำเนินการ', completed: 'เสร็จสิ้น', cancelled: 'ยกเลิก' }
  return <>
    <section className="welcome-row"><div><p className="eyebrow">ปฏิบัติการ / ดูแลที่พัก</p><h1>งานซ่อม</h1><p className="subheading">เปิดเรื่อง มอบหมาย บันทึกต้นทุนและผู้รับผิดชอบค่าใช้จ่าย</p></div><button className="button button-primary" type="button" disabled={!rooms.length} onClick={onAdd}><Icon size={18}><path d="M12 5v14m-7-7h14" /></Icon> เปิดงานซ่อม</button></section>
    <section className="panel rooms-panel full-rooms-panel"><div className="panel-heading"><div><h2>รายการงานซ่อม <span className="result-count">{requests.length} รายการ</span></h2><p>ผู้รายงาน ห้องพัก และระดับความสำคัญ</p></div></div>
      <div className="table-scroll"><table className="room-table"><thead><tr><th>เลขที่งาน</th><th>ห้อง</th><th>รายละเอียด</th><th>ความสำคัญ</th><th>สถานะ</th><th>งาน/ต้นทุน</th><th>ดำเนินการ</th></tr></thead><tbody>{requests.length ? requests.map((request) => <tr key={request.id}>
        <td><strong>{request.documentNo}</strong><small>{formatDate(request.reportedAt)} · {request.reportedBy}</small></td><td>{request.building} · {request.roomCode}</td><td className="description-cell">{request.description}</td><td>{request.priority}</td>
        <td><span className={`status-pill ${request.status === 'completed' ? 'occupied' : request.status === 'cancelled' ? 'maintenance' : 'reserved'}`}><i />{label[request.status] ?? request.status}</span></td>
        <td><details><summary className="text-action">{request.jobs.length} รายการ</summary><div className="maintenance-job-list">
          {request.jobs.map((job) => <div className="maintenance-job" key={job.id}><strong>{job.supplierName || 'งานภายใน'} · ฿ {formatBaht(job.cost)}</strong><span>{job.workNote || 'ยังไม่มีบันทึกผล'} · {job.payer === 'tenant' ? 'ผู้เช่ารับผิดชอบ' : 'กิจการรับผิดชอบ'}</span>          {job.completedAt ? <small>เสร็จ {formatDate(job.completedAt)}</small> : request.status === 'in_progress' && <form className="contract-action-form" onSubmit={(event) => { event.preventDefault(); void onCompleteJob(request.id, job.id, toPayload(event.currentTarget)) }}>
            <label>ผลการซ่อม<input name="workNote" required maxLength={5000} /></label><label>ต้นทุนจริง<input name="cost" type="number" min="0" step="0.01" defaultValue={job.cost} required /></label>
            <label>ผู้รับผิดชอบค่าใช้จ่าย<select name="payer" defaultValue={job.payer}><option value="business">กิจการ</option><option value="tenant" disabled={!request.contractId}>ผู้เช่า</option></select></label>
            <button className="button button-secondary" type="submit">บันทึกผลซ่อม</button>
          </form>}</div>)}
          {['new', 'assigned'].includes(request.status) && <form className="contract-action-form" onSubmit={(event) => { event.preventDefault(); void onCreateJob(request.id, toPayload(event.currentTarget)) }}>
            <strong>มอบหมายงานย่อย</strong><label>ผู้จำหน่าย (ถ้ามี)<select name="supplierId" defaultValue=""><option value="">งานภายใน / ยังไม่ระบุ</option>{suppliers.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}</select></label>
            <label>บันทึกงาน/รายละเอียด<input name="workNote" maxLength={5000} /></label><label>ประมาณการต้นทุน<input name="cost" type="number" min="0" step="0.01" defaultValue="0" required /></label>
            <label>ผู้รับผิดชอบค่าใช้จ่าย<select name="payer" defaultValue="business"><option value="business">กิจการ</option><option value="tenant" disabled={!request.contractId}>ผู้เช่า</option></select></label>
            <button className="button button-primary" type="submit">เพิ่มงานย่อย</button>
          </form>}
        </div></details></td>
        <td>{nextStatus[request.status] ? <button className="text-action" type="button" disabled={request.status === 'in_progress' && request.jobs.some((job) => !job.completedAt)} onClick={() => onStatusChange(request.id, nextStatus[request.status])}>{request.status === 'new' ? 'เริ่มรับงาน' : request.status === 'assigned' ? 'เริ่มดำเนินการ' : 'ปิดงาน'}</button> : <span className="muted-dash">—</span>}</td>
      </tr>) : <tr><td className="empty-cell" colSpan={7}>ยังไม่มีงานซ่อม</td></tr>}</tbody></table></div>
    </section>
  </>
}

function ComplaintsPage({ complaints, onAdd, onStatusChange }: { complaints: Complaint[]; onAdd: () => void; onStatusChange: (id: string, status: 'in_progress' | 'resolved' | 'cancelled', resolution?: string) => void }) {
  return <><section className="welcome-row"><div><p className="eyebrow">ปฏิบัติการ / เสียงจากผู้เช่า</p><h1>ข้อร้องเรียน</h1><p className="subheading">ติดตามเรื่องร้องเรียนแยกจากสถานะงานซ่อม</p></div><button className="button button-primary" type="button" onClick={onAdd}><Icon size={18}><path d="M12 5v14m-7-7h14" /></Icon> รับเรื่องร้องเรียน</button></section><section className="panel rooms-panel full-rooms-panel"><div className="panel-heading"><div><h2>ข้อร้องเรียนทั้งหมด <span className="result-count">{complaints.length} รายการ</span></h2><p>ผลการแก้ไขจะถูกบันทึกพร้อมสถานะ</p></div></div><div className="table-scroll"><table className="room-table"><thead><tr><th>เลขที่เรื่อง</th><th>ห้อง</th><th>รายละเอียด</th><th>ผลแก้ไข</th><th>สถานะ</th><th>การดำเนินการ</th></tr></thead><tbody>{complaints.length ? complaints.map((complaint) => <tr key={complaint.id}><td><strong>{complaint.documentNo}</strong><small>{formatDate(complaint.reportedAt)}</small></td><td>{complaint.building} · {complaint.roomCode}</td><td className="description-cell">{complaint.description}</td><td>{complaint.resolution || '—'}</td><td>{complaint.status}</td><td>{['new', 'in_progress'].includes(complaint.status) ? <div className="row-actions"><button className="text-action" type="button" onClick={() => onStatusChange(complaint.id, 'in_progress')}>ดำเนินการ</button><button className="text-action danger" type="button" onClick={() => { const value = window.prompt('บันทึกผลการแก้ไข'); if (value?.trim()) onStatusChange(complaint.id, 'resolved', value.trim()) }}>ปิดเรื่อง</button></div> : <span className="muted-dash">—</span>}</td></tr>) : <tr><td className="empty-cell" colSpan={6}>ยังไม่มีข้อร้องเรียน</td></tr>}</tbody></table></div></section></>
}

function BillingPage({ periods, meters, readings, invoices, properties, accounts, onChanged }: {
  periods: BillingPeriod[]
  meters: Meter[]
  readings: MeterReading[]
  invoices: Invoice[]
  properties: Lookups['properties']
  accounts: Lookups['accounts']
  onChanged: () => Promise<void>
}) {
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [receivableAccountId, setReceivableAccountId] = useState('')
  const [taxPayableAccountId, setTaxPayableAccountId] = useState('')
  const openPeriods = periods.filter((period) => period.status === 'open')
  const receivableAccounts = accounts.filter((account) => account.accountType === 'asset')
  const liabilityAccounts = accounts.filter((account) => account.accountType === 'liability')

  async function submit(event: FormEvent<HTMLFormElement>, path: string) {
    event.preventDefault()
    const form = event.currentTarget
    setError('')
    setNotice('')
    setBusy(true)
    try {
      await api(path, { method: 'POST', body: JSON.stringify(toPayload(form)) })
      form.reset()
      setNotice('บันทึกข้อมูลเรียบร้อย')
      await onChanged()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'บันทึกข้อมูลไม่สำเร็จ')
    } finally {
      setBusy(false)
    }
  }

  async function verifyReading(id: string) {
    setError('')
    setNotice('')
    try {
      await api(`/meter-readings/${id}/verify`, { method: 'PATCH' })
      setNotice('ยืนยันค่ามิเตอร์เรียบร้อย')
      await onChanged()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'ยืนยันค่ามิเตอร์ไม่สำเร็จ')
    }
  }

  async function generateInvoices(period: BillingPeriod) {
    setError('')
    setNotice('')
    setBusy(true)
    try {
      const result = await api<{ generated: { id: string; documentNo: string }[]; skipped: { contractId: string; reason: string }[] }>(
        `/billing-periods/${period.id}/generate-invoices`,
        { method: 'POST' },
      )
      setNotice(`สร้างฉบับร่าง ${result.generated.length} รายการ${result.skipped.length ? ` · ข้าม ${result.skipped.length} สัญญาที่ยังไม่พร้อม` : ''}`)
      await onChanged()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'สร้างฉบับร่างไม่สำเร็จ')
    } finally {
      setBusy(false)
    }
  }

  async function issueInvoice(invoiceId: string) {
    setError('')
    setNotice('')
    setBusy(true)
    try {
      await api(`/invoices/${invoiceId}/issue`, {
        method: 'POST',
        body: JSON.stringify({
          receivableAccountId,
          taxPayableAccountId: taxPayableAccountId || undefined,
        }),
      })
      setNotice('ออกใบแจ้งหนี้และบันทึกรายการบัญชีเรียบร้อย')
      await onChanged()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'ออกใบแจ้งหนี้ไม่สำเร็จ')
    } finally {
      setBusy(false)
    }
  }

  async function printInvoice(invoiceId: string) {
    setError('')
    setNotice('')
    const printWindow = window.open('', '_blank')
    if (!printWindow) {
      setError('เปิดหน้าพิมพ์ไม่ได้ กรุณาอนุญาตป๊อปอัปสำหรับเว็บไซต์นี้')
      return
    }
    try {
      const data = await api<InvoicePrintData>(`/invoices/${invoiceId}/print-data`)
      printWindow.document.open()
      printWindow.document.write(invoicePrintMarkup(data))
      printWindow.document.close()
      printWindow.focus()
      window.setTimeout(() => printWindow.print(), 300)
    } catch (cause) {
      printWindow.close()
      setError(cause instanceof Error ? cause.message : 'เตรียมเอกสารสำหรับพิมพ์ไม่สำเร็จ')
    }
  }

  return <>
    <section className="welcome-row"><div><p className="eyebrow">การเงิน / วางบิล</p><h1>รอบบิลและใบแจ้งหนี้</h1><p className="subheading">เปิดงวด บันทึกและตรวจค่ามิเตอร์ แล้วสร้างใบแจ้งหนี้ฉบับร่าง</p></div></section>
    {error && <div className="page-error" role="alert">{error}</div>}
    {notice && <div className="success-notice" role="status">{notice}</div>}
    <section className="setup-grid billing-forms">
      <SetupCard title="เปิดรอบบิล" description="กำหนดขอบเขตหนึ่งรอบต่อโครงการ" submit={(event) => void submit(event, '/billing-periods')}>
        <label>โครงการ<select name="propertyId" required defaultValue=""><option value="" disabled>เลือกโครงการ</option>{properties.map((property) => <option key={property.id} value={property.id}>{property.name}</option>)}</select></label>
        <label>รหัสรอบบิล<input name="code" maxLength={30} required placeholder="เช่น 2026-10" /></label>
        <label>วันเริ่มรอบ<input name="startDate" type="date" required /></label>
        <label>วันสิ้นสุดรอบ<input name="endDate" type="date" required /></label>
        <button className="button button-primary" type="submit" disabled={busy || !properties.length}>เปิดรอบบิล</button>
      </SetupCard>
      <SetupCard title="บันทึกค่ามิเตอร์" description={`${meters.length} เครื่องที่ยังติดตั้งอยู่`} submit={(event) => void submit(event, '/meter-readings')}>
        <label>รอบบิล<select name="billingPeriodId" required defaultValue=""><option value="" disabled>เลือกรอบบิล</option>{openPeriods.map((period) => <option key={period.id} value={period.id}>{period.property ?? ''} · {period.code}</option>)}</select></label>
        <label>เครื่องมิเตอร์<select name="meterId" required defaultValue=""><option value="" disabled>เลือกมิเตอร์</option>{meters.map((meter) => <option key={meter.id} value={meter.id}>{meter.roomCode} · {meter.utilityType === 'water' ? 'น้ำ' : 'ไฟ'} · {meter.serialNo}</option>)}</select></label>
        <label>ค่าครั้งก่อน<input name="previousValue" type="number" min="0" step="0.001" required /></label>
        <label>ค่าปัจจุบัน<input name="currentValue" type="number" min="0" step="0.001" required /></label>
        <label>รอบหมุนเมื่อมิเตอร์วนกลับ<input name="rolloverCount" type="number" min="0" step="1" defaultValue="0" required /></label>
        <button className="button button-primary" type="submit" disabled={busy || !openPeriods.length || !meters.length}>บันทึกค่ามิเตอร์</button>
      </SetupCard>
    </section>
    <section className="panel rooms-panel full-rooms-panel"><div className="panel-heading"><div><h2>ค่ามิเตอร์ <span className="result-count">{readings.length} รายการ</span></h2><p>ตรวจสอบค่าที่บันทึกก่อนนำไปคำนวณ</p></div></div><div className="table-scroll"><table className="room-table"><thead><tr><th>รอบบิล</th><th>ห้อง / ประเภท</th><th>ก่อนหน้า → ปัจจุบัน</th><th>ใช้ไป</th><th>ตรวจสอบ</th></tr></thead><tbody>{readings.length ? readings.map((reading) => <tr key={reading.id}><td>{reading.billingPeriod}</td><td>{reading.roomCode} · {reading.utilityType === 'water' ? 'น้ำ' : 'ไฟ'}</td><td>{reading.previousValue} → {reading.currentValue}{reading.rolloverCount > 0 ? ` (+${reading.rolloverCount} รอบ)` : ''}</td><td>{reading.unitsUsed}</td><td>{reading.verified ? <span className="status-pill occupied"><i />ยืนยันแล้ว</span> : <button className="text-action" type="button" onClick={() => void verifyReading(reading.id)}>ยืนยันค่า</button>}</td></tr>) : <tr><td className="empty-cell" colSpan={5}>ยังไม่มีค่ามิเตอร์</td></tr>}</tbody></table></div></section>
    <section className="panel rooms-panel full-rooms-panel"><div className="panel-heading"><div><h2>ใบแจ้งหนี้ <span className="result-count">{invoices.length} รายการ</span></h2><p>ออกฉบับร่างพร้อมลงบัญชีลูกหนี้และรายได้</p></div></div><div className="billing-account-mapping"><label>บัญชีลูกหนี้<select value={receivableAccountId} onChange={(event) => setReceivableAccountId(event.target.value)}><option value="">เลือกบัญชี</option>{receivableAccounts.map((account) => <option key={account.id} value={account.id}>{account.code} · {account.name}</option>)}</select></label><label>บัญชีภาษีค้างจ่าย (ถ้ามีภาษี)<select value={taxPayableAccountId} onChange={(event) => setTaxPayableAccountId(event.target.value)}><option value="">ไม่เลือก</option>{liabilityAccounts.map((account) => <option key={account.id} value={account.id}>{account.code} · {account.name}</option>)}</select></label></div><div className="table-scroll"><table className="room-table"><thead><tr><th>เลขที่เอกสาร</th><th>รอบบิล</th><th>ผู้เช่า</th><th>ครบกำหนด</th><th>ยอดรวม</th><th>สถานะ</th><th>ดำเนินการ</th></tr></thead><tbody>{invoices.length ? invoices.map((invoice) => <tr key={invoice.id}><td><strong>{invoice.documentNo}</strong></td><td>{invoice.billingPeriod ?? '—'}</td><td>{invoice.customerName}</td><td>{formatDate(invoice.dueDate)}</td><td>฿ {formatBaht(invoice.total)}</td><td><span className={`status-pill ${invoice.status === 'issued' ? 'occupied' : 'reserved'}`}><i />{invoice.status === 'draft' ? 'ฉบับร่าง' : invoice.status === 'issued' ? 'ออกแล้ว' : invoice.status}</span></td><td><div className="row-actions">{invoice.status === 'draft' && <button className="text-action" type="button" disabled={busy || !receivableAccountId} onClick={() => void issueInvoice(invoice.id)}>ออกใบแจ้งหนี้</button>}{invoice.status !== 'void' && <button className="text-action" type="button" onClick={() => void printInvoice(invoice.id)}>พิมพ์</button>}{invoice.attachments.map((attachment) => <a className="text-action" key={attachment.id} href={`/api/attachments/${attachment.id}`}>{attachment.fileName}</a>)}</div></td></tr>) : <tr><td className="empty-cell" colSpan={7}>ยังไม่มีใบแจ้งหนี้</td></tr>}</tbody></table></div></section>
    <section className="panel rooms-panel full-rooms-panel"><div className="panel-heading"><div><h2>สร้างฉบับร่างจากรอบบิล</h2><p>บิลซ้ำจะไม่ถูกสร้างอีก; สัญญารายงวด/ข้อมูลมิเตอร์ที่ไม่ครบจะถูกข้าม</p></div></div><div className="table-scroll"><table className="room-table"><thead><tr><th>โครงการ</th><th>รอบบิล</th><th>ช่วงเวลา</th><th>สถานะ</th><th>ดำเนินการ</th></tr></thead><tbody>{periods.length ? periods.map((period) => <tr key={period.id}><td>{period.property ?? '—'}</td><td>{period.code}</td><td>{formatDate(period.startDate)} – {formatDate(period.endDate)}</td><td>{period.status === 'open' ? 'เปิด' : 'ปิด'}</td><td>{period.status === 'open' ? <button className="text-action" type="button" disabled={busy} onClick={() => void generateInvoices(period)}>สร้างฉบับร่าง</button> : <span className="muted-dash">—</span>}</td></tr>) : <tr><td className="empty-cell" colSpan={5}>ยังไม่มีรอบบิล</td></tr>}</tbody></table></div></section>
  </>
}

function PaymentsPage({ payments, invoices, customers, bankAccounts, accounts, onChanged }: {
  payments: Payment[]
  invoices: Invoice[]
  customers: Customer[]
  bankAccounts: Lookups['bankAccounts']
  accounts: Lookups['accounts']
  onChanged: () => Promise<void>
}) {
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [receivableAccountId, setReceivableAccountId] = useState('')
  const [advanceLiabilityAccountId, setAdvanceLiabilityAccountId] = useState('')
  const [selectedInvoiceId, setSelectedInvoiceId] = useState('')
  const receivableAccounts = accounts.filter((account) => account.accountType === 'asset')
  const liabilityAccounts = accounts.filter((account) => account.accountType === 'liability')
  const dueInvoices = invoices.filter((invoice) => {
    const outstanding = Math.round((Number(invoice.total) - Number(invoice.paidAmount)) * 100)
    return invoice.status === 'issued' && outstanding > 0
  })

  async function createPayment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = event.currentTarget
    const values = toPayload(form)
    setError('')
    setNotice('')
    setBusy(true)
    try {
      const amount = Number(values.amount)
      const allocations = selectedInvoiceId ? [{ invoiceId: selectedInvoiceId, amount }] : []
      const result = await api<{ documentNo: string }>('/payments', {
        method: 'POST',
        body: JSON.stringify({ ...values, allocations }),
      })
      form.reset()
      setSelectedInvoiceId('')
      setNotice(`บันทึกรายการ ${result.documentNo} เป็นสถานะรอตรวจ ยังไม่ลดหนี้`)
      await onChanged()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'บันทึกรับชำระไม่สำเร็จ')
    } finally {
      setBusy(false)
    }
  }

  async function confirmPayment(payment: Payment) {
    setError('')
    setNotice('')
    setBusy(true)
    try {
      const allocated = payment.allocations.reduce((total, allocation) => total + Number(allocation.amount), 0)
      await api(`/payments/${payment.id}/confirm`, {
        method: 'POST',
        body: JSON.stringify({
          receivableAccountId,
          advanceLiabilityAccountId: Math.round((Number(payment.amount) - allocated) * 100) > 0
            ? advanceLiabilityAccountId || undefined
            : undefined,
        }),
      })
      setNotice(`ยืนยันรับชำระ ${payment.documentNo} และออกใบเสร็จเรียบร้อย`)
      await onChanged()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'ยืนยันรับชำระไม่สำเร็จ')
    } finally {
      setBusy(false)
    }
  }

  async function printReceipt(payment: Payment) {
    setError('')
    setNotice('')
    const printWindow = window.open('', '_blank')
    if (!printWindow) {
      setError('เปิดหน้าพิมพ์ไม่ได้ กรุณาอนุญาตป๊อปอัปสำหรับเว็บไซต์นี้')
      return
    }
    try {
      const data = await api<ReceiptPrintData>(`/receipts/${payment.receiptId}/print-data`)
      printWindow.document.open()
      printWindow.document.write(receiptPrintMarkup(data))
      printWindow.document.close()
      printWindow.focus()
      window.setTimeout(() => printWindow.print(), 300)
    } catch (cause) {
      printWindow.close()
      setError(cause instanceof Error ? cause.message : 'เตรียมใบเสร็จสำหรับพิมพ์ไม่สำเร็จ')
    }
  }

  async function voidPayment(payment: Payment) {
    const reason = window.prompt(`ระบุเหตุผลยกเลิกรายการ ${payment.documentNo}`)
    if (!reason?.trim()) return
    setError('')
    setNotice('')
    setBusy(true)
    try {
      await api(`/payments/${payment.id}/void`, {
        method: 'POST',
        body: JSON.stringify({ reason: reason.trim() }),
      })
      setNotice(`ยกเลิกรายการ ${payment.documentNo} เรียบร้อย${payment.status === 'confirmed' ? ' พร้อมกลับรายการบัญชีและใบเสร็จ' : ''}`)
      await onChanged()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'ยกเลิกรับชำระไม่สำเร็จ')
    } finally {
      setBusy(false)
    }
  }

  return <>
    <section className="welcome-row"><div><p className="eyebrow">การเงิน / รับชำระ</p><h1>รับชำระและใบเสร็จ</h1><p className="subheading">บันทึกสถานะรอตรวจ และยืนยันเมื่อเจ้าหน้าที่ตรวจสอบเงินจริงแล้ว</p></div></section>
    {error && <div className="page-error" role="alert">{error}</div>}
    {notice && <div className="success-notice" role="status">{notice}</div>}
    <section className="setup-grid billing-forms">
      <section className="panel setup-card"><div className="panel-heading"><h2>บันทึกรับชำระ</h2><span>สถานะเริ่มต้นเป็นรอตรวจ</span></div><form className="setup-form" onSubmit={(event) => void createPayment(event)}>
        <label>ผู้ชำระ<select name="customerId" required defaultValue=""><option value="" disabled>เลือกผู้เช่า</option>{customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.fullName} · {customer.code}</option>)}</select></label>
        <label>จัดสรรให้ใบแจ้งหนี้ (ไม่บังคับ)<select value={selectedInvoiceId} onChange={(event) => setSelectedInvoiceId(event.target.value)}><option value="">ยังไม่จัดสรร</option>{dueInvoices.map((invoice) => <option key={invoice.id} value={invoice.id}>{invoice.documentNo} · {invoice.customerName} · ค้าง ฿{formatBaht(Number(invoice.total) - Number(invoice.paidAmount))}</option>)}</select></label>
        <label>สมุดเงิน<select name="bankAccountId" required defaultValue=""><option value="" disabled>เลือกบัญชีรับเงิน</option>{bankAccounts.map((account) => <option key={account.id} value={account.id}>{account.code} · {account.name}</option>)}</select></label>
        <label>ยอดรับ (บาท)<input name="amount" type="number" min="0.01" step="0.01" required /></label>
        <label>วิธีชำระ<select name="method" defaultValue="transfer"><option value="transfer">โอนเงิน</option><option value="cash">เงินสด</option><option value="cheque">เช็ค</option><option value="card">บัตร</option></select></label>
        <label>เลขอ้างอิง<input name="reference" maxLength={150} /></label>
        <button className="button button-primary" type="submit" disabled={busy || !customers.length || !bankAccounts.length}>บันทึกรอตรวจ</button>
      </form></section>
      <section className="panel setup-card"><div className="panel-heading"><h2>บัญชีสำหรับยืนยันและลงบัญชี</h2><span>เลือกตามผังบัญชีของกิจการ</span></div><div className="setup-form">
        <label>บัญชีลูกหนี้<select value={receivableAccountId} onChange={(event) => setReceivableAccountId(event.target.value)}><option value="">เลือกบัญชีสินทรัพย์</option>{receivableAccounts.map((account) => <option key={account.id} value={account.id}>{account.code} · {account.name}</option>)}</select></label>
        <label>บัญชีเงินรับล่วงหน้า (กรณียังไม่จัดสรร)<select value={advanceLiabilityAccountId} onChange={(event) => setAdvanceLiabilityAccountId(event.target.value)}><option value="">เลือกบัญชีหนี้สิน</option>{liabilityAccounts.map((account) => <option key={account.id} value={account.id}>{account.code} · {account.name}</option>)}</select></label>
        <p className="subheading">เมื่อยืนยัน ระบบจะตรวจยอดค้างอีกครั้ง บันทึกสมุดรายวันแบบสมดุล และออกใบเสร็จใน transaction เดียว</p>
      </div></section>
    </section>
    <section className="panel rooms-panel full-rooms-panel"><div className="panel-heading"><div><h2>รายการรับชำระ <span className="result-count">{payments.length} รายการ</span></h2><p>รายการ pending ยังไม่ถูกนำไปหักยอดค้าง</p></div></div><div className="table-scroll"><table className="room-table"><thead><tr><th>เลขที่รับเงิน</th><th>ผู้ชำระ</th><th>ยอดรับ</th><th>จัดสรรบิล</th><th>สมุดเงิน / วิธี</th><th>สถานะ / ใบเสร็จ</th><th>ดำเนินการ</th></tr></thead><tbody>{payments.length ? payments.map((payment) => <tr key={payment.id}><td><strong>{payment.documentNo}</strong><small>{formatDate(payment.receivedAt)}</small></td><td>{payment.customerName}</td><td>฿ {formatBaht(payment.amount)}</td><td>{payment.allocations.length ? payment.allocations.map((allocation) => <div key={allocation.invoiceId}>{allocation.documentNo} · ฿{formatBaht(allocation.amount)}</div>) : <span className="muted-dash">ยังไม่จัดสรร</span>}</td><td>{payment.bankAccount}<small>{payment.method}{payment.reference ? ` · ${payment.reference}` : ''}</small></td><td><span className={`status-pill ${payment.status === 'confirmed' ? 'occupied' : payment.status === 'void' ? 'maintenance' : 'reserved'}`}><i />{payment.status === 'pending' ? 'รอตรวจ' : payment.status === 'confirmed' ? `ยืนยันแล้ว · ${payment.receiptNo ?? 'มีใบเสร็จ'}` : payment.status}</span></td><td><div className="row-actions">{payment.status === 'pending' && <button className="text-action" type="button" disabled={busy || !receivableAccountId} onClick={() => void confirmPayment(payment)}>ตรวจเงินจริงและยืนยัน</button>}{payment.status === 'confirmed' && payment.receiptId && <button className="text-action" type="button" onClick={() => void printReceipt(payment)}>พิมพ์ใบเสร็จ</button>}{payment.status !== 'void' ? <button className="text-action danger" type="button" disabled={busy} onClick={() => void voidPayment(payment)}>ยกเลิก/กลับรายการ</button> : <span className="muted-dash">—</span>}</div></td></tr>) : <tr><td className="empty-cell" colSpan={7}>ยังไม่มีรายการรับชำระ</td></tr>}</tbody></table></div></section>
  </>
}

function FundsPage({ transactions, contracts, bookings, invoices, bankAccounts, accounts, onChanged }: {
  transactions: FundTransaction[]
  contracts: Contract[]
  bookings: Booking[]
  invoices: Invoice[]
  bankAccounts: Lookups['bankAccounts']
  accounts: Lookups['accounts']
  onChanged: () => Promise<void>
}) {
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [transactionType, setTransactionType] = useState<'receive' | 'refund' | 'apply_invoice'>('receive')
  const [ownerType, setOwnerType] = useState<'booking' | 'contract'>('contract')
  const [ownerId, setOwnerId] = useState('')
  const [selectedInvoiceId, setSelectedInvoiceId] = useState('')
  const liabilities = accounts.filter((account) => account.accountType === 'liability')
  const assets = accounts.filter((account) => account.accountType === 'asset')
  const payableInvoices = invoices.filter((invoice) => invoice.status === 'issued' && invoice.contractId === ownerId)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = event.currentTarget
    const values = toPayload(form)
    setError('')
    setNotice('')
    setBusy(true)
    const { ownerId: selectedOwner, ...fields } = values
    const payload = {
      ...fields,
      bookingId: ownerType === 'booking' ? selectedOwner : undefined,
      contractId: ownerType === 'contract' ? selectedOwner : undefined,
      invoiceId: transactionType === 'apply_invoice' ? selectedInvoiceId : undefined,
      receivableAccountId: transactionType === 'apply_invoice' ? fields.receivableAccountId : undefined,
      bankAccountId: transactionType === 'receive' || transactionType === 'refund' ? fields.bankAccountId : undefined,
      method: transactionType === 'receive' || transactionType === 'refund' ? fields.method : undefined,
    }
    try {
      const result = await api<{ documentNo: string }>('/fund-transactions', {
        method: 'POST',
        body: JSON.stringify(payload),
      })
      form.reset()
      setOwnerId('')
      setSelectedInvoiceId('')
      setNotice(`บันทึก ${result.documentNo} และรายการบัญชีแล้ว`)
      await onChanged()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'บันทึกเงินกองไม่สำเร็จ')
    } finally {
      setBusy(false)
    }
  }

  async function reverseFundTransaction(transaction: FundTransaction) {
    const reason = window.prompt(`ระบุเหตุผลกลับรายการ ${transaction.documentNo}`)
    if (reason === null) return
    setError('')
    setNotice('')
    setBusy(true)
    try {
      const result = await api<{ reversalDocuments: string[]; journalNo: string }>(
        `/fund-transactions/${transaction.id}/reverse`,
        { method: 'POST', body: JSON.stringify({ reason }) },
      )
      setNotice(`กลับรายการ ${transaction.documentNo} แล้ว (${result.reversalDocuments.join(', ')}; ${result.journalNo})`)
      await onChanged()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'กลับรายการเงินกองไม่สำเร็จ')
    } finally {
      setBusy(false)
    }
  }

  return <>
    <section className="welcome-row"><div><p className="eyebrow">การเงิน / เงินกองผู้เช่า</p><h1>เงินจอง ประกัน และล่วงหน้า</h1><p className="subheading">ลงรับ/คืนเงินจริง และใช้เงินกองหักใบแจ้งหนี้พร้อมตรวจยอดคงเหลือ</p></div></section>
    {error && <div className="page-error" role="alert">{error}</div>}
    {notice && <div className="success-notice" role="status">{notice}</div>}
    <section className="panel setup-card"><div className="panel-heading"><h2>บันทึกรายการเงินกอง</h2><span>รายการรับ/คืนถือว่าเจ้าหน้าที่ตรวจเงินจริงแล้ว</span></div><form className="setup-grid fund-form" onSubmit={(event) => void submit(event)}>
      <label>ประเภทรายการ<select name="transactionType" value={transactionType} onChange={(event) => { const value = event.target.value === 'apply_invoice' ? 'apply_invoice' : event.target.value === 'refund' ? 'refund' : 'receive'; setTransactionType(value); if (value === 'apply_invoice') { setOwnerType('contract'); setOwnerId('') } }}><option value="receive">รับเงินเข้ากอง</option><option value="refund">คืนเงินจากกอง</option><option value="apply_invoice">หักชำระใบแจ้งหนี้</option></select></label>
      <label>ประเภทเงิน<select name="fundType" defaultValue="deposit"><option value="reservation">เงินจอง</option><option value="deposit">เงินประกัน</option><option value="advance">เงินล่วงหน้า</option></select></label>
      <label>อ้างอิงรายการ<select name="ownerType" value={ownerType} onChange={(event) => { setOwnerType(event.target.value === 'booking' ? 'booking' : 'contract'); setOwnerId(''); setSelectedInvoiceId('') }}><option value="contract">สัญญาเช่า</option>{transactionType !== 'apply_invoice' && <option value="booking">การจอง</option>}</select></label>
      <label>{ownerType === 'contract' ? 'สัญญา' : 'การจอง'}<select name="ownerId" required value={ownerId} onChange={(event) => { setOwnerId(event.target.value); setSelectedInvoiceId('') }}>
        <option value="" disabled>เลือกรายการ</option>{ownerType === 'contract' ? contracts.map((contract) => <option key={contract.id} value={contract.id}>{contract.documentNo} · {contract.customerName} · {contract.roomCode}</option>) : bookings.map((booking) => <option key={booking.id} value={booking.id}>{booking.documentNo} · {booking.customerName} · {booking.roomCode}</option>)}
      </select></label>
      {transactionType === 'apply_invoice' && <label>ใบแจ้งหนี้<select value={selectedInvoiceId} onChange={(event) => setSelectedInvoiceId(event.target.value)} required><option value="" disabled>เลือกบิลของสัญญา</option>{payableInvoices.map((invoice) => <option key={invoice.id} value={invoice.id}>{invoice.documentNo} · {invoice.customerName} · ฿{formatBaht(invoice.total)}</option>)}</select></label>}
      <label>ยอดเงิน (บาท)<input name="amount" type="number" min="0.01" step="0.01" required /></label>
      {(transactionType === 'receive' || transactionType === 'refund') && <><label>สมุดเงิน<select name="bankAccountId" required defaultValue=""><option value="" disabled>เลือกสมุดเงิน</option>{bankAccounts.map((bank) => <option key={bank.id} value={bank.id}>{bank.code} · {bank.name}</option>)}</select></label><label>วิธีชำระ<select name="method" defaultValue="transfer"><option value="transfer">โอนเงิน</option><option value="cash">เงินสด</option><option value="cheque">เช็ค</option><option value="card">บัตร</option></select></label></>}
      <label>บัญชีหนี้สินเงินกอง<select name="liabilityAccountId" required defaultValue=""><option value="" disabled>เลือกบัญชี</option>{liabilities.map((account) => <option key={account.id} value={account.id}>{account.code} · {account.name}</option>)}</select></label>
      {transactionType === 'apply_invoice' && <label>บัญชีลูกหนี้<select name="receivableAccountId" required defaultValue=""><option value="" disabled>เลือกบัญชี</option>{assets.map((account) => <option key={account.id} value={account.id}>{account.code} · {account.name}</option>)}</select></label>}
      <button className="button button-primary" type="submit" disabled={busy || !liabilities.length}>{busy ? 'กำลังบันทึก…' : 'บันทึกและลงบัญชี'}</button>
    </form></section>
    <FundTransferForm contracts={contracts} bookings={bookings} accounts={accounts} onChanged={onChanged} />
    <section className="panel rooms-panel full-rooms-panel"><div className="panel-heading"><div><h2>ประวัติเงินกอง <span className="result-count">{transactions.length} รายการ</span></h2><p>ยอดกองตรวจสอบย้อนหลังจากรายการ posted และ reversal</p></div></div><div className="table-scroll"><table className="room-table"><thead><tr><th>เอกสาร</th><th>ผู้เช่า / สัญญา</th><th>ประเภทกอง</th><th>รายการ</th><th>ใบแจ้งหนี้</th><th>ยอด</th><th>วันที่</th><th>จัดการ</th></tr></thead><tbody>{transactions.length ? transactions.map((transaction) => {
      const reversed = transactions.some((candidate) => candidate.transactionType === 'reversal' && candidate.relatedTransactionId === transaction.id)
      const canReverse = transaction.status === 'posted' && transaction.transactionType !== 'reversal'
        && transaction.transactionType !== 'transfer_in' && !reversed
      return <tr key={transaction.id}><td><strong>{transaction.documentNo}</strong></td><td>{transaction.customerName}<small>{transaction.sourceDocument}</small></td><td>{transaction.fundType === 'reservation' ? 'เงินจอง' : transaction.fundType === 'deposit' ? 'เงินประกัน' : 'เงินล่วงหน้า'}</td><td>{transaction.transactionType}</td><td>{transaction.invoiceNo ?? '—'}</td><td>฿ {formatBaht(transaction.amount)}</td><td>{formatDate(transaction.occurredAt)}</td><td>{canReverse && <button className="button button-secondary" type="button" disabled={busy} onClick={() => void reverseFundTransaction(transaction)}>กลับรายการ</button>}{reversed && <small>กลับรายการแล้ว</small>}</td></tr>
    }) : <tr><td className="empty-cell" colSpan={8}>ยังไม่มีรายการเงินกอง</td></tr>}</tbody></table></div></section>
  </>
}

function FundTransferForm({ contracts, bookings, accounts, onChanged }: {
  contracts: Contract[]
  bookings: Booking[]
  accounts: Lookups['accounts']
  onChanged: () => Promise<void>
}) {
  const [sourceId, setSourceId] = useState('')
  const [destinationId, setDestinationId] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const selectedBooking = bookings.find((booking) => booking.id === sourceId)
  const matchingContracts = selectedBooking
    ? contracts.filter((contract) => contract.customerId === selectedBooking.customerId)
    : []

  async function transfer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = event.currentTarget
    const values = toPayload(form)
    setError('')
    setNotice('')
    setBusy(true)
    const payload = {
      fromFundType: values.fromFundType,
      toFundType: values.toFundType,
      amount: values.amount,
      fromBookingId: sourceId,
      toContractId: destinationId,
      sourceLiabilityAccountId: values.sourceLiabilityAccountId,
      destinationLiabilityAccountId: values.destinationLiabilityAccountId,
    }
    try {
      const result = await api<{ outgoing: string; incoming: string; journalNo: string }>('/fund-transactions/transfer', {
        method: 'POST',
        body: JSON.stringify(payload),
      })
      setNotice(`โอนสำเร็จ ${result.outgoing} → ${result.incoming} (สมุดรายวัน ${result.journalNo})`)
      setSourceId('')
      setDestinationId('')
      form.reset()
      await onChanged()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'โอนเงินกองไม่สำเร็จ')
    } finally {
      setBusy(false)
    }
  }

  return <section className="panel setup-card fund-transfer-card"><div className="panel-heading"><h2>โอนเงินจองไปยังสัญญา</h2><span>บันทึกคู่รายการและปรับบัญชีหนี้สินใน transaction เดียว</span></div>
    {error && <div className="page-error" role="alert">{error}</div>}
    {notice && <div className="success-notice" role="status">{notice}</div>}
    <form className="setup-grid fund-form" onSubmit={(event) => void transfer(event)}>
      <label>การจองต้นทาง<select required value={sourceId} onChange={(event) => { setSourceId(event.target.value); setDestinationId('') }}><option value="" disabled>เลือกการจอง</option>{bookings.map((booking) => <option key={booking.id} value={booking.id}>{booking.documentNo} · {booking.customerName}</option>)}</select></label>
      <label>สัญญาปลายทาง<select required value={destinationId} onChange={(event) => setDestinationId(event.target.value)}><option value="" disabled>เลือกสัญญาของผู้เช่ารายเดียวกัน</option>{matchingContracts.map((contract) => <option key={contract.id} value={contract.id}>{contract.documentNo} · {contract.customerName}</option>)}</select></label>
      <label>ประเภทเงินต้นทาง<select name="fromFundType" defaultValue="reservation"><option value="reservation">เงินจอง</option><option value="deposit">เงินประกัน</option><option value="advance">เงินล่วงหน้า</option></select></label>
      <label>ประเภทเงินปลายทาง<select name="toFundType" defaultValue="deposit"><option value="reservation">เงินจอง</option><option value="deposit">เงินประกัน</option><option value="advance">เงินล่วงหน้า</option></select></label>
      <label>ยอดโอน (บาท)<input name="amount" type="number" min="0.01" step="0.01" required /></label>
      <label>บัญชีหนี้สินต้นทาง<select name="sourceLiabilityAccountId" required defaultValue=""><option value="" disabled>เลือกบัญชี</option>{accounts.filter((account) => account.accountType === 'liability').map((account) => <option key={account.id} value={account.id}>{account.code} · {account.name}</option>)}</select></label>
      <label>บัญชีหนี้สินปลายทาง<select name="destinationLiabilityAccountId" required defaultValue=""><option value="" disabled>เลือกบัญชี</option>{accounts.filter((account) => account.accountType === 'liability').map((account) => <option key={account.id} value={account.id}>{account.code} · {account.name}</option>)}</select></label>
      <button className="button button-primary" type="submit" disabled={busy}>{busy ? 'กำลังโอน…' : 'โอนและบันทึกคู่รายการ'}</button>
    </form>
  </section>
}

function ExpensesPage({ expenses, bankAccounts, accounts, suppliers, onChanged }: {
  expenses: Expense[]
  bankAccounts: Lookups['bankAccounts']
  accounts: Lookups['accounts']
  suppliers: Lookups['suppliers']
  onChanged: () => Promise<void>
}) {
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [inputTaxAccountId, setInputTaxAccountId] = useState('')
  const expenseAccounts = accounts.filter((account) => account.accountType === 'expense')
  const assetAccounts = accounts.filter((account) => account.accountType === 'asset')

  async function createExpense(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = event.currentTarget
    setError('')
    setNotice('')
    setBusy(true)
    try {
      const result = await api<{ documentNo: string; total: string }>('/expenses', {
        method: 'POST',
        body: JSON.stringify(toPayload(form)),
      })
      setNotice(`สร้างรายการร่าง ${result.documentNo} ยอดรวม ฿${formatBaht(result.total)}`)
      form.reset()
      await onChanged()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'บันทึกรายการค่าใช้จ่ายไม่สำเร็จ')
    } finally {
      setBusy(false)
    }
  }

  async function postExpense(expense: Expense) {
    setError('')
    setNotice('')
    setBusy(true)
    try {
      const result = await api<{ journalNo: string }>(`/expenses/${expense.id}/post`, {
        method: 'POST',
        body: JSON.stringify(inputTaxAccountId ? { inputTaxAccountId } : {}),
      })
      setNotice(`ลงบัญชี ${expense.documentNo} แล้ว (${result.journalNo})`)
      await onChanged()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'ลงบัญชีค่าใช้จ่ายไม่สำเร็จ')
    } finally {
      setBusy(false)
    }
  }

  async function voidExpense(expense: Expense) {
    const reason = window.prompt(`ระบุเหตุผลยกเลิกรายการ ${expense.documentNo}`)
    if (reason === null) return
    setError('')
    setNotice('')
    setBusy(true)
    try {
      await api(`/expenses/${expense.id}/void`, {
        method: 'POST',
        body: JSON.stringify({ reason }),
      })
      setNotice(`ยกเลิกรายการ ${expense.documentNo} แล้ว`)
      await onChanged()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'ยกเลิกรายการค่าใช้จ่ายไม่สำเร็จ')
    } finally {
      setBusy(false)
    }
  }

  return <>
    <section className="welcome-row"><div><p className="eyebrow">การเงิน / รายจ่าย</p><h1>ค่าใช้จ่าย</h1><p className="subheading">บันทึกร่าง ตรวจทาน ลงบัญชี และกลับรายการโดยเก็บประวัติ</p></div></section>
    {error && <div className="page-error" role="alert">{error}</div>}
    {notice && <div className="success-notice" role="status">{notice}</div>}
    <section className="panel setup-card">
      <div className="panel-heading"><h2>บันทึกรายการค่าใช้จ่าย</h2><span>รายการใหม่จะเป็นร่าง ยังไม่ลงบัญชี</span></div>
      {!bankAccounts.length || !expenseAccounts.length
        ? <div className="empty-cell">ตั้งค่าสมุดเงินและบัญชีประเภทค่าใช้จ่ายก่อนเริ่มบันทึก</div>
        : <form className="setup-grid fund-form" onSubmit={(event) => void createExpense(event)}>
          <label>วันที่<input name="expenseDate" type="date" defaultValue={todayIsoDate} required /></label>
          <label>หมวดรายจ่าย<input name="paymentCategory" maxLength={30} required placeholder="เช่น repair, supplies" /></label>
          <label>รายละเอียด<input name="description" maxLength={1000} required /></label>
          <label>บัญชีค่าใช้จ่าย<select name="expenseAccountId" required defaultValue=""><option value="" disabled>เลือกบัญชี</option>{expenseAccounts.map((account) => <option key={account.id} value={account.id}>{account.code} · {account.name}</option>)}</select></label>
          <label>สมุดเงินที่จ่าย<select name="bankAccountId" required defaultValue=""><option value="" disabled>เลือกสมุดเงิน</option>{bankAccounts.map((bank) => <option key={bank.id} value={bank.id}>{bank.code} · {bank.name}</option>)}</select></label>
          <label>ผู้จำหน่าย<select name="supplierId" defaultValue=""><option value="">ไม่ระบุ</option>{suppliers.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.code} · {supplier.name}</option>)}</select></label>
          <label>วิธีชำระ<select name="paymentMethod" defaultValue="transfer"><option value="cash">เงินสด</option><option value="transfer">โอนเงิน</option><option value="cheque">เช็ค</option><option value="card">บัตร</option></select></label>
          <label>เลขที่เอกสารผู้ขาย<input name="supplierDocumentNo" maxLength={100} /></label>
          <label>ภาษี<select name="taxMode" defaultValue="none"><option value="none">ไม่คิดภาษี</option><option value="inclusive">ยอดที่กรอกมีภาษีรวมแล้ว</option><option value="exclusive">บวกภาษีจากยอดที่กรอก</option></select></label>
          <label>อัตราภาษี %<input name="taxRate" type="number" min="0" max="100" step="0.0001" defaultValue="0" required /></label>
          <label>ยอดฐาน/ยอดรวม (บาท)<input name="amount" type="number" min="0.01" step="0.01" required /></label>
          <button className="button button-primary" type="submit" disabled={busy}>{busy ? 'กำลังบันทึก…' : 'บันทึกเป็นร่าง'}</button>
        </form>}
    </section>
    <section className="panel setup-card expenses-list">
      <div className="panel-heading"><div><h2>รายการค่าใช้จ่าย <span className="result-count">{expenses.length}</span></h2><p>การลงบัญชีและการยกเลิกเก็บ journal/reversal แยกจากเอกสารต้นฉบับ</p></div></div>
      <label className="expense-tax-account">บัญชีภาษีซื้อสำหรับการลงบัญชี<select value={inputTaxAccountId} onChange={(event) => setInputTaxAccountId(event.target.value)}><option value="">เลือกเมื่อรายการมีภาษี</option>{assetAccounts.map((account) => <option key={account.id} value={account.id}>{account.code} · {account.name}</option>)}</select></label>
      <div className="table-scroll"><table className="room-table expense-table"><thead><tr><th>เอกสาร / วันที่</th><th>รายละเอียด</th><th>หมวด</th><th>สมุดเงิน</th><th>วิธี</th><th>ยอดรวม</th><th>สถานะ / บัญชี</th><th>ดำเนินการ</th></tr></thead><tbody>
        {expenses.length ? expenses.map((expense) => <tr key={expense.id}>
          <td><strong>{expense.documentNo}</strong><small>{formatDate(expense.expenseDate)}{expense.supplierName ? ` · ${expense.supplierName}` : ''}{expense.supplierDocumentNo ? ` · ${expense.supplierDocumentNo}` : ''}</small></td>
          <td>{expense.items.map((item, index) => <span className="expense-item" key={`${expense.id}-${index}`}>{item.description}<small>{item.accountCode} · {item.accountName} · ภาษี ฿{formatBaht(item.taxAmount)}</small></span>)}</td>
          <td>{expense.paymentCategory}</td><td>{expense.bankCode} · {expense.bankName}</td><td>{expense.paymentMethod}</td>
          <td>฿ {formatBaht(expense.total)}</td>
          <td><strong>{expense.status === 'draft' ? 'ร่าง' : expense.status === 'posted' ? 'ลงบัญชีแล้ว' : 'ยกเลิก'}</strong><small>{expense.journalNo ? `JV ${expense.journalNo}` : ''}{expense.reversalNo ? ` · กลับ ${expense.reversalNo}` : ''}</small></td>
          <td className="expense-actions">{expense.status === 'draft' && <button className="button button-secondary" type="button" disabled={busy} onClick={() => void postExpense(expense)}>ลงบัญชี</button>}{expense.status !== 'void' && <button className="button button-secondary" type="button" disabled={busy} onClick={() => void voidExpense(expense)}>ยกเลิก</button>}</td>
        </tr>) : <tr><td className="empty-cell" colSpan={8}>ยังไม่มีรายการค่าใช้จ่าย</td></tr>}
      </tbody></table></div>
    </section>
  </>
}

function TenantPortalPage() {
  const [data, setData] = useState<PortalDashboard | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let active = true
    api<PortalDashboard>('/portal')
      .then((result) => { if (active) setData(result) })
      .catch((cause: unknown) => { if (active) setError(cause instanceof Error ? cause.message : 'โหลดข้อมูลผู้เช่าไม่สำเร็จ') })
    return () => { active = false }
  }, [])

  const activeContracts = (data?.contracts ?? []).filter((contract) =>
    contract.status === 'active' && contract.startDate <= todayIsoDate && contract.endDate >= todayIsoDate,
  )

  async function submitRequest(event: FormEvent<HTMLFormElement>, endpoint: string, successMessage: string) {
    event.preventDefault()
    const form = event.currentTarget
    setError('')
    setNotice('')
    setBusy(true)
    try {
      await api(endpoint, { method: 'POST', body: JSON.stringify(toPayload(form)) })
      form.reset()
      setNotice(successMessage)
      setData(await api<PortalDashboard>('/portal'))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'ส่งข้อมูลไม่สำเร็จ')
    } finally {
      setBusy(false)
    }
  }

  async function printInvoice(invoiceId: string) {
    setError('')
    const printWindow = window.open('', '_blank')
    if (!printWindow) {
      setError('เปิดหน้าพิมพ์ไม่ได้ กรุณาอนุญาตป๊อปอัปสำหรับเว็บไซต์นี้')
      return
    }
    try {
      const printData = await api<InvoicePrintData>(`/portal/invoices/${invoiceId}/print-data`)
      printWindow.document.open()
      printWindow.document.write(invoicePrintMarkup(printData))
      printWindow.document.close()
      printWindow.focus()
      window.setTimeout(() => printWindow.print(), 300)
    } catch (cause) {
      printWindow.close()
      setError(cause instanceof Error ? cause.message : 'เตรียมใบแจ้งหนี้สำหรับพิมพ์ไม่สำเร็จ')
    }
  }

  async function submitEvidence(event: FormEvent<HTMLFormElement>, invoiceId: string) {
    event.preventDefault()
    const form = event.currentTarget
    const fileInput = form.elements.namedItem('file')
    if (!(fileInput instanceof HTMLInputElement) || !fileInput.files?.[0]) {
      setError('กรุณาเลือกไฟล์หลักฐานการชำระเงิน')
      return
    }
    const body = new FormData()
    body.append('file', fileInput.files[0])
    setError('')
    setNotice('')
    setBusy(true)
    try {
      const response = await fetch(`/api/portal/invoices/${invoiceId}/evidence`, {
        method: 'POST',
        credentials: 'same-origin',
        body,
      })
      const result = await response.json().catch(() => ({})) as { error?: string }
      if (!response.ok) throw new Error(result.error || `เกิดข้อผิดพลาด (${response.status})`)
      form.reset()
      setNotice('ส่งหลักฐานให้เจ้าหน้าที่ตรวจสอบแล้ว')
      setData(await api<PortalDashboard>('/portal'))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'ส่งหลักฐานการชำระเงินไม่สำเร็จ')
    } finally {
      setBusy(false)
    }
  }

  return <>
    <section className="welcome-row"><div><p className="eyebrow">บริการผู้เช่า</p><h1>สวัสดี{data ? ` ${data.customer.fullName}` : ''}</h1><p className="subheading">ดูข้อมูลสัญญาและยอดบิล พร้อมติดตามเรื่องที่แจ้งไว้</p></div></section>
    {error && <div className="page-error" role="alert">{error}</div>}
    {notice && <div className="success-notice" role="status">{notice}</div>}
    {!data ? <div className="panel setup-card"><p className="subheading">กำลังโหลดข้อมูลบัญชีผู้เช่า...</p></div> : <>
      <section className="panel setup-card portal-section">
        <div className="panel-heading"><div><h2>สัญญาเช่าของฉัน</h2><p>{data.customer.code}</p></div></div>
        <div className="portal-contract-grid">{data.contracts.length ? data.contracts.map((contract) => <article className="portal-contract" key={contract.id}>
          <strong>{contract.documentNo}</strong><span>{contract.building ? `${contract.building} · ` : ''}{contract.roomCode ? `ห้อง ${contract.roomCode}` : 'ไม่มีข้อมูลห้องปัจจุบัน'}</span>
          <small>{formatDate(contract.startDate)} – {formatDate(contract.endDate)} · {contract.status}</small>
        </article>) : <p className="empty-cell">ยังไม่มีสัญญาที่แสดงได้</p>}</div>
      </section>
      <section className="panel setup-card portal-section">
        <div className="panel-heading"><div><h2>ใบแจ้งหนี้</h2><p>ยอดรับชำระรวมเฉพาะรายการที่ยืนยันแล้ว</p></div></div>
        <div className="table-scroll"><table className="room-table"><thead><tr><th>เอกสาร</th><th>ครบกำหนด</th><th>ยอดบิล</th><th>ชำระแล้ว</th><th>คงเหลือ</th><th>สถานะ</th><th>ดำเนินการ</th></tr></thead><tbody>
          {data.invoices.length ? data.invoices.map((invoice) => {
            const outstanding = Math.max(0, Number(invoice.total) - Number(invoice.paidAmount))
            return <tr key={invoice.id}><td><strong>{invoice.documentNo}</strong></td><td>{formatDate(invoice.dueDate)}</td><td>฿ {formatBaht(invoice.total)}</td><td>฿ {formatBaht(invoice.paidAmount)}</td><td><strong>฿ {formatBaht(outstanding)}</strong></td><td>{invoice.status}</td><td><div className="row-actions"><button className="text-action" type="button" onClick={() => void printInvoice(invoice.id)}>พิมพ์</button>{outstanding > 0 && <form className="portal-evidence-form" onSubmit={(event) => void submitEvidence(event, invoice.id)}><input aria-label={`แนบหลักฐาน ${invoice.documentNo}`} name="file" type="file" accept="application/pdf,image/jpeg,image/png,image/webp" required /><button className="text-action" type="submit" disabled={busy}>ส่งหลักฐาน</button></form>}</div>{invoice.attachments.length > 0 && <small>{invoice.attachments.map((attachment) => <a key={attachment.id} href={`/api/portal/attachments/${attachment.id}`}>{attachment.fileName}</a>)}</small>}</td></tr>
          }) : <tr><td className="empty-cell" colSpan={7}>ยังไม่มีใบแจ้งหนี้</td></tr>}
        </tbody></table></div>
      </section>
      <section className="admin-grid portal-section">
        <div className="panel setup-card"><div className="panel-heading"><div><h2>แจ้งซ่อม</h2><p>ส่งคำขอสำหรับสัญญาที่กำลังใช้งาน</p></div></div>
          <form className="setup-form" onSubmit={(event) => void submitRequest(event, '/portal/maintenance-requests', 'ส่งคำขอแจ้งซ่อมแล้ว')}>
            <label>สัญญา<select name="contractId" required disabled={!activeContracts.length}>{activeContracts.map((contract) => <option key={contract.id} value={contract.id}>{contract.documentNo} · ห้อง {contract.roomCode ?? '—'}</option>)}</select></label>
            <label>ระดับความสำคัญ<select name="priority" defaultValue="normal"><option value="low">ต่ำ</option><option value="normal">ปกติ</option><option value="high">สูง</option></select></label>
            <label>รายละเอียด<textarea name="description" rows={4} maxLength={5000} required /></label>
            <button className="button button-primary" type="submit" disabled={busy || !activeContracts.length}>ส่งคำขอ</button>
          </form>
        </div>
        <div className="panel setup-card"><div className="panel-heading"><div><h2>แจ้งข้อร้องเรียน</h2><p>ส่งเรื่องให้เจ้าหน้าที่ตรวจสอบ</p></div></div>
          <form className="setup-form" onSubmit={(event) => void submitRequest(event, '/portal/complaints', 'ส่งข้อร้องเรียนแล้ว')}>
            <label>สัญญา<select name="contractId" required disabled={!activeContracts.length}>{activeContracts.map((contract) => <option key={contract.id} value={contract.id}>{contract.documentNo} · ห้อง {contract.roomCode ?? '—'}</option>)}</select></label>
            <label>รายละเอียด<textarea name="description" rows={4} maxLength={5000} required /></label>
            <button className="button button-primary" type="submit" disabled={busy || !activeContracts.length}>ส่งเรื่อง</button>
          </form>
        </div>
      </section>
      <section className="admin-grid portal-section">
        <div className="panel setup-card"><div className="panel-heading"><h2>คำขอแจ้งซ่อม</h2></div><div className="table-scroll"><table className="room-table"><thead><tr><th>เอกสาร</th><th>ห้อง</th><th>รายละเอียด</th><th>สถานะ</th></tr></thead><tbody>{data.maintenanceRequests.length ? data.maintenanceRequests.map((item) => <tr key={item.id}><td>{item.documentNo}</td><td>{item.roomCode}</td><td>{item.description}</td><td>{item.status}</td></tr>) : <tr><td className="empty-cell" colSpan={4}>ยังไม่มีคำขอแจ้งซ่อม</td></tr>}</tbody></table></div></div>
        <div className="panel setup-card"><div className="panel-heading"><h2>ข้อร้องเรียน</h2></div><div className="table-scroll"><table className="room-table"><thead><tr><th>เอกสาร</th><th>ห้อง</th><th>รายละเอียด</th><th>สถานะ</th></tr></thead><tbody>{data.complaints.length ? data.complaints.map((item) => <tr key={item.id}><td>{item.documentNo}</td><td>{item.roomCode}</td><td>{item.description}</td><td>{item.status}{item.resolution && <small>{item.resolution}</small>}</td></tr>) : <tr><td className="empty-cell" colSpan={4}>ยังไม่มีข้อร้องเรียน</td></tr>}</tbody></table></div></div>
      </section>
    </>}
  </>
}

function UsersPage({ users, roles, permissions, customers, onChanged }: {
  users: ManagedUser[]
  roles: ManagedRole[]
  permissions: PermissionOption[]
  customers: { id: string; code: string; fullName: string }[]
  onChanged: () => Promise<void>
}) {
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [newUserRoles, setNewUserRoles] = useState<string[]>([])
  const [roleSelections, setRoleSelections] = useState<Record<string, string[]>>({})
  const [customerSelections, setCustomerSelections] = useState<Record<string, string>>({})
  const [newRolePermissions, setNewRolePermissions] = useState<string[]>([])
  const [rolePermissionSelections, setRolePermissionSelections] = useState<Record<string, string[]>>({})

  function toggleSelection(current: string[], value: string) {
    return current.includes(value) ? current.filter((item) => item !== value) : [...current, value]
  }

  const renderPermissionChecks = (selected: string[], onChange: (value: string[]) => void) => (
    <div className="permission-checks">{permissions.map((permission) => <label key={permission.code}>
      <input type="checkbox" checked={selected.includes(permission.code)} onChange={() => onChange(toggleSelection(selected, permission.code))} />
      <span><strong>{permission.code}</strong>{permission.description && <small>{permission.description}</small>}</span>
    </label>)}</div>
  )

  async function createUser(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = event.currentTarget
    setError('')
    setNotice('')
    setBusy(true)
    try {
      await api('/admin/users', {
        method: 'POST',
        body: JSON.stringify({ ...toPayload(form), roleIds: newUserRoles }),
      })
      form.reset()
      setNewUserRoles([])
      setNotice('สร้างบัญชีผู้ใช้เรียบร้อย')
      await onChanged()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'สร้างบัญชีไม่สำเร็จ')
    } finally {
      setBusy(false)
    }
  }

  async function createRole(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = event.currentTarget
    setError('')
    setNotice('')
    setBusy(true)
    try {
      await api('/admin/roles', {
        method: 'POST',
        body: JSON.stringify({ ...toPayload(form), permissionCodes: newRolePermissions }),
      })
      form.reset()
      setNewRolePermissions([])
      setNotice('สร้างบทบาทเรียบร้อย')
      await onChanged()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'สร้างบทบาทไม่สำเร็จ')
    } finally {
      setBusy(false)
    }
  }

  async function saveUser(user: ManagedUser, active = user.active) {
    const roleIds = roleSelections[user.id] ?? user.roleIds.map(String)
    const customerId = customerSelections[user.id] ?? user.customerId ?? ''
    setError('')
    setNotice('')
    setBusy(true)
    try {
      await api(`/admin/users/${user.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ active, roleIds, customerId }),
      })
      setNotice(active === user.active ? `บันทึกบทบาท ${user.username} แล้ว` : `${active ? 'เปิดใช้งาน' : 'ปิดใช้งาน'} ${user.username} แล้ว`)
      setRoleSelections((current) => {
        const next = { ...current }
        delete next[user.id]
        return next
      })
      setCustomerSelections((current) => {
        const next = { ...current }
        delete next[user.id]
        return next
      })
      await onChanged()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'บันทึกผู้ใช้ไม่สำเร็จ')
    } finally {
      setBusy(false)
    }
  }

  async function resetPassword(user: ManagedUser) {
    const password = window.prompt(`ตั้งรหัสผ่านใหม่ให้ ${user.username} (อย่างน้อย 12 ตัวอักษร)`)
    if (password === null) return
    setError('')
    setNotice('')
    setBusy(true)
    try {
      await api(`/admin/users/${user.id}/reset-password`, {
        method: 'POST',
        body: JSON.stringify({ password }),
      })
      setNotice(`เปลี่ยนรหัสผ่าน ${user.username} แล้ว`)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'เปลี่ยนรหัสผ่านไม่สำเร็จ')
    } finally {
      setBusy(false)
    }
  }

  async function saveRole(role: ManagedRole) {
    const permissionCodes = rolePermissionSelections[role.id] ?? role.permissionCodes
    setError('')
    setNotice('')
    setBusy(true)
    try {
      await api(`/admin/roles/${role.id}/permissions`, {
        method: 'PATCH',
        body: JSON.stringify({ permissionCodes }),
      })
      setNotice(`บันทึกสิทธิ์ของบทบาท ${role.name} แล้ว`)
      setRolePermissionSelections((current) => {
        const next = { ...current }
        delete next[role.id]
        return next
      })
      await onChanged()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'บันทึกสิทธิ์ไม่สำเร็จ')
    } finally {
      setBusy(false)
    }
  }

  return <>
    <section className="welcome-row"><div><p className="eyebrow">การดูแลระบบ</p><h1>ผู้ใช้และสิทธิ์</h1><p className="subheading">จัดการบัญชีผู้ใช้ บทบาท และสิทธิ์ที่ API อนุญาต</p></div></section>
    {error && <div className="page-error" role="alert">{error}</div>}
    {notice && <div className="success-notice" role="status">{notice}</div>}
    {!roles.length && <div className="panel setup-card"><p className="subheading">ยังไม่มีบทบาท กรุณาสร้าง/ตั้งค่าบทบาทผู้ดูแลผ่านขั้นตอน bootstrap ก่อน</p></div>}
    <section className="admin-grid">
      <div className="panel setup-card"><div className="panel-heading"><h2>สร้างผู้ใช้</h2></div><form className="setup-form" onSubmit={(event) => void createUser(event)}>
        <label>ชื่อผู้ใช้<input name="username" maxLength={100} autoComplete="off" required /></label>
        <label>ชื่อแสดงผล<input name="displayName" maxLength={200} required /></label>
        <label>รหัสผ่านเริ่มต้น (อย่างน้อย 12 ตัว)<input name="password" type="password" minLength={12} maxLength={200} autoComplete="new-password" required /></label>
        <label>ผูกบัญชีกับผู้เช่า (สำหรับพอร์ทัล)<select name="customerId" defaultValue=""><option value="">ไม่ผูกบัญชีผู้เช่า</option>{customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.code} · {customer.fullName}</option>)}</select></label>
        <fieldset><legend>บทบาทเริ่มต้น</legend><div className="role-checks">{roles.map((role) => <label key={role.id}><input type="checkbox" checked={newUserRoles.includes(role.id)} onChange={() => setNewUserRoles((current) => toggleSelection(current, role.id))} />{role.name}</label>)}</div></fieldset>
        <button className="button button-primary" type="submit" disabled={busy || !newUserRoles.length}>สร้างบัญชี</button>
      </form></div>
      <div className="panel setup-card"><div className="panel-heading"><h2>สร้างบทบาท</h2></div><form className="setup-form" onSubmit={(event) => void createRole(event)}>
        <label>รหัสบทบาท<input name="code" maxLength={30} required /></label><label>ชื่อบทบาท<input name="name" maxLength={100} required /></label>
        <fieldset><legend>สิทธิ์</legend>{renderPermissionChecks(newRolePermissions, setNewRolePermissions)}</fieldset>
        <button className="button button-primary" type="submit" disabled={busy}>สร้างบทบาท</button>
      </form></div>
    </section>
    <section className="panel setup-card admin-list"><div className="panel-heading"><div><h2>บัญชีผู้ใช้ <span className="result-count">{users.length}</span></h2><p>เปลี่ยนบทบาทและเปิด/ปิดการใช้งานได้โดยไม่ลบบัญชีหรือประวัติ</p></div></div>
      <div className="table-scroll"><table className="room-table admin-table"><thead><tr><th>ผู้ใช้</th><th>บทบาท</th><th>สถานะ</th><th>ดำเนินการ</th></tr></thead><tbody>
        {users.map((user) => <tr key={user.id}><td><strong>{user.displayName}</strong><small>{user.username}</small><select aria-label={`ผู้เช่าที่ผูกกับ ${user.username}`} value={customerSelections[user.id] ?? user.customerId ?? ''} onChange={(event) => setCustomerSelections((current) => ({ ...current, [user.id]: event.target.value }))}><option value="">ไม่ผูกบัญชีผู้เช่า</option>{customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.code} · {customer.fullName}</option>)}</select></td>
          <td><div className="role-checks">{roles.map((role) => <label key={role.id}><input type="checkbox" checked={(roleSelections[user.id] ?? user.roleIds).map(String).includes(role.id)} onChange={() => setRoleSelections((current) => ({ ...current, [user.id]: toggleSelection(current[user.id] ?? user.roleIds.map(String), role.id) }))} />{role.name}</label>)}</div></td>
          <td>{user.active ? 'ใช้งาน' : 'ปิดใช้งาน'}</td>
          <td className="expense-actions"><button className="button button-secondary" type="button" disabled={busy} onClick={() => void saveUser(user)}>บันทึกบทบาท</button><button className="button button-secondary" type="button" disabled={busy} onClick={() => void saveUser(user, !user.active)}>{user.active ? 'ปิดใช้งาน' : 'เปิดใช้งาน'}</button><button className="button button-secondary" type="button" disabled={busy} onClick={() => void resetPassword(user)}>ตั้งรหัสผ่านใหม่</button></td>
        </tr>)}
        {!users.length && <tr><td className="empty-cell" colSpan={4}>ไม่มีผู้ใช้</td></tr>}
      </tbody></table></div>
    </section>
    <section className="admin-list"><h2 className="admin-section-title">บทบาทและสิทธิ์</h2>{roles.map((role) => <article className="panel setup-card role-card" key={role.id}>
      <div className="panel-heading"><div><h2>{role.name}</h2><p>{role.code}</p></div><button className="button button-primary" type="button" disabled={busy} onClick={() => void saveRole(role)}>บันทึกสิทธิ์</button></div>
      {renderPermissionChecks(rolePermissionSelections[role.id] ?? role.permissionCodes, (value) => setRolePermissionSelections((current) => ({ ...current, [role.id]: value })))}
    </article>)}</section>
  </>
}

function ReportsPage({ receivables: initialReceivables, onChanged }: { receivables: Receivable[]; onChanged: () => Promise<void> }) {
  const [receivables, setReceivables] = useState(initialReceivables)
  useEffect(() => { setReceivables(initialReceivables) }, [initialReceivables])
  const [asOf, setAsOf] = useState(todayIsoDate)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const totalOutstanding = receivables.reduce((total, row) => total + Number(row.outstanding), 0)

  async function loadReport(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault()
    setError('')
    setBusy(true)
    try {
      const result = await api<{ receivables: Receivable[] }>(`/reports/receivables?asOf=${encodeURIComponent(asOf)}`)
      setReceivables(result.receivables)
      await onChanged()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'โหลดรายงานไม่สำเร็จ')
    } finally {
      setBusy(false)
    }
  }

  async function exportReport() {
    setError('')
    try {
      const response = await fetch(`/api/reports/receivables.csv?asOf=${encodeURIComponent(asOf)}`, { credentials: 'same-origin' })
      if (!response.ok) {
        const body = await response.json().catch(() => ({})) as { error?: string }
        throw new Error(body.error || `ส่งออกรายงานไม่สำเร็จ (${response.status})`)
      }
      const blob = await response.blob()
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `receivables-${asOf}.csv`
      link.click()
      URL.revokeObjectURL(url)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'ส่งออกรายงานไม่สำเร็จ')
    }
  }

  return <>
    <section className="welcome-row"><div><p className="eyebrow">วิเคราะห์ผล / การเงิน</p><h1>รายงานลูกหนี้คงค้าง</h1><p className="subheading">ยอดคงค้างคำนวณจากการรับชำระที่ยืนยันแล้วและรายการเงินกองที่ลงบัญชี</p></div><button className="button button-secondary" type="button" onClick={() => void exportReport()}>ส่งออก CSV</button></section>
    {error && <div className="page-error" role="alert">{error}</div>}
    <section className="panel setup-card"><form className="report-filter" onSubmit={(event) => void loadReport(event)}><label>คำนวณยอด ณ วันที่<input type="date" value={asOf} onChange={(event) => setAsOf(event.target.value)} required /></label><button className="button button-primary" type="submit" disabled={busy}>{busy ? 'กำลังโหลด…' : 'แสดงรายงาน'}</button><strong>ลูกหนี้รวม ฿ {formatBaht(totalOutstanding)}</strong></form></section>
    <section className="panel rooms-panel full-rooms-panel"><div className="panel-heading"><div><h2>รายการค้างชำระ <span className="result-count">{receivables.length} ใบ</span></h2><p>วันที่ครบกำหนดล่วงเวลาแยกจากยอดชำระบางส่วน</p></div></div><div className="table-scroll"><table className="room-table"><thead><tr><th>เลขที่ใบแจ้งหนี้</th><th>ผู้เช่า</th><th>ครบกำหนด</th><th>ยอดบิล</th><th>รับชำระ</th><th>หักเงินกอง</th><th>คงค้าง</th><th>เกินกำหนด</th></tr></thead><tbody>{receivables.length ? receivables.map((row) => <tr key={row.id}><td><strong>{row.documentNo}</strong></td><td>{row.customerName}<small>{row.customerCode}</small></td><td>{formatDate(row.dueDate)}</td><td>฿ {formatBaht(row.total)}</td><td>฿ {formatBaht(row.paidAmount)}</td><td>฿ {formatBaht(row.fundApplied)}</td><td><strong>฿ {formatBaht(row.outstanding)}</strong></td><td>{row.daysOverdue > 0 ? `${row.daysOverdue} วัน` : '—'}</td></tr>) : <tr><td className="empty-cell" colSpan={8}>ไม่พบยอดลูกหนี้คงค้างในวันที่เลือก</td></tr>}</tbody></table></div></section>
    <ExpenseReportPanel />
    <JournalReportPanel />
  </>
}

function JournalReportPanel() {
  const [from, setFrom] = useState(`${todayIsoDate.slice(0, 8)}01`)
  const [to, setTo] = useState(todayIsoDate)
  const [rows, setRows] = useState<JournalReportLine[]>([])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const debitTotal = rows.reduce((sum, row) => sum + Math.round(Number(row.debit) * 100), 0) / 100
  const creditTotal = rows.reduce((sum, row) => sum + Math.round(Number(row.credit) * 100), 0) / 100

  async function load(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    setBusy(true)
    try {
      const result = await api<{ journalLines: JournalReportLine[] }>(`/reports/journal-entries?${new URLSearchParams({ from, to })}`)
      setRows(result.journalLines)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'โหลดรายงานสมุดรายวันไม่สำเร็จ')
    } finally {
      setBusy(false)
    }
  }

  async function exportCsv() {
    setError('')
    try {
      const response = await fetch(`/api/reports/journal-entries.csv?${new URLSearchParams({ from, to })}`, { credentials: 'same-origin' })
      if (!response.ok) {
        const body = await response.json().catch(() => ({})) as { error?: string }
        throw new Error(body.error || `ส่งออกรายงานไม่สำเร็จ (${response.status})`)
      }
      const url = URL.createObjectURL(await response.blob())
      const link = document.createElement('a')
      link.href = url
      link.download = `journal-entries-${from}-to-${to}.csv`
      link.click()
      URL.revokeObjectURL(url)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'ส่งออกรายงานสมุดรายวันไม่สำเร็จ')
    }
  }

  return <section className="panel setup-card expenses-list">
    <div className="panel-heading"><div><h2>รายการสมุดรายวัน</h2><p>แสดงรายการบัญชีที่ลงบัญชีแล้วในช่วงวันที่เลือก</p></div><button className="button button-secondary" type="button" onClick={() => void exportCsv()}>ส่งออก CSV</button></div>
    {error && <div className="page-error" role="alert">{error}</div>}
    <form className="report-filter expense-report-filter" onSubmit={(event) => void load(event)}>
      <label>ตั้งแต่วันที่<input type="date" value={from} onChange={(event) => setFrom(event.target.value)} required /></label>
      <label>ถึงวันที่<input type="date" value={to} onChange={(event) => setTo(event.target.value)} required /></label>
      <button className="button button-primary" type="submit" disabled={busy}>{busy ? 'กำลังโหลด…' : 'แสดงรายงาน'}</button>
      <strong>เดบิต ฿ {formatBaht(debitTotal)} · เครดิต ฿ {formatBaht(creditTotal)}</strong>
    </form>
    <div className="table-scroll"><table className="room-table expense-table"><thead><tr><th>สมุดรายวัน / วันที่</th><th>รายละเอียด</th><th>บัญชี</th><th>เดบิต</th><th>เครดิต</th></tr></thead><tbody>
      {rows.length ? rows.map((row, index) => <tr key={`${row.documentNo}-${row.accountCode}-${index}`}><td><strong>{row.documentNo}</strong><small>{formatDate(row.entryDate)}</small></td><td>{row.description}</td><td>{row.accountCode} · {row.accountName}</td><td>฿ {formatBaht(row.debit)}</td><td>฿ {formatBaht(row.credit)}</td></tr>) : <tr><td className="empty-cell" colSpan={5}>กำหนดช่วงวันที่แล้วกดแสดงรายงาน</td></tr>}
    </tbody></table></div>
  </section>
}

function ExpenseReportPanel() {
  const [from, setFrom] = useState(`${todayIsoDate.slice(0, 8)}01`)
  const [to, setTo] = useState(todayIsoDate)
  const [status, setStatus] = useState('posted')
  const [rows, setRows] = useState<ExpenseReportRow[]>([])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const total = rows.reduce((sum, row) => sum + Math.round(Number(row.total) * 100), 0) / 100

  async function load(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    setBusy(true)
    try {
      const query = new URLSearchParams({ from, to, status })
      const result = await api<{ expenses: ExpenseReportRow[] }>(`/reports/expenses?${query}`)
      setRows(result.expenses)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'โหลดรายงานค่าใช้จ่ายไม่สำเร็จ')
    } finally {
      setBusy(false)
    }
  }

  async function exportCsv() {
    const query = new URLSearchParams({ from, to, status })
    try {
      const response = await fetch(`/api/reports/expenses.csv?${query}`, { credentials: 'same-origin' })
      if (!response.ok) {
        const body = await response.json().catch(() => ({})) as { error?: string }
        throw new Error(body.error || `ส่งออกรายงานไม่สำเร็จ (${response.status})`)
      }
      const url = URL.createObjectURL(await response.blob())
      const link = document.createElement('a')
      link.href = url
      link.download = `expenses-${from}-to-${to}.csv`
      link.click()
      URL.revokeObjectURL(url)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'ส่งออกรายงานค่าใช้จ่ายไม่สำเร็จ')
    }
  }

  return <section className="panel setup-card expenses-list">
    <div className="panel-heading"><div><h2>รายงานค่าใช้จ่าย</h2><p>สรุปตามวันที่เอกสารและสถานะ รายงานตัวเลขเฉพาะรายการที่เลือก</p></div><button className="button button-secondary" type="button" onClick={() => void exportCsv()}>ส่งออก CSV</button></div>
    {error && <div className="page-error" role="alert">{error}</div>}
    <form className="report-filter expense-report-filter" onSubmit={(event) => void load(event)}>
      <label>ตั้งแต่วันที่<input type="date" value={from} onChange={(event) => setFrom(event.target.value)} required /></label>
      <label>ถึงวันที่<input type="date" value={to} onChange={(event) => setTo(event.target.value)} required /></label>
      <label>สถานะ<select value={status} onChange={(event) => setStatus(event.target.value)}><option value="posted">ลงบัญชีแล้ว</option><option value="draft">ร่าง</option><option value="void">ยกเลิก</option><option value="all">ทุกสถานะ</option></select></label>
      <button className="button button-primary" type="submit" disabled={busy}>{busy ? 'กำลังโหลด…' : 'แสดงรายงาน'}</button>
      <strong>ยอดรวม ฿ {formatBaht(total)}</strong>
    </form>
    <div className="table-scroll"><table className="room-table expense-table"><thead><tr><th>เอกสาร / วันที่</th><th>ผู้จำหน่าย</th><th>หมวด</th><th>รายละเอียด</th><th>บัญชี</th><th>สุทธิ</th><th>ภาษีซื้อ</th><th>รวม</th><th>สถานะ / สมุดรายวัน</th></tr></thead><tbody>
      {rows.length ? rows.map((row) => <tr key={row.documentNo}><td><strong>{row.documentNo}</strong><small>{formatDate(row.expenseDate)} · {row.supplierDocumentNo ?? 'ไม่มีเลขอ้างอิง'}</small></td><td>{row.supplier || '—'}</td><td>{row.category}</td><td>{row.description}</td><td>{row.expenseAccount}</td><td>฿ {formatBaht(row.netAmount)}</td><td>฿ {formatBaht(row.taxAmount)}</td><td>฿ {formatBaht(row.total)}</td><td>{row.status}<small>{row.journalNo ?? ''}{row.reversalNo ? ` · ${row.reversalNo}` : ''}</small></td></tr>) : <tr><td className="empty-cell" colSpan={9}>ยังไม่มีผลรายงาน กำหนดตัวกรองแล้วกดแสดงรายงาน</td></tr>}
    </tbody></table></div>
  </section>
}

function SetupPage({ lookups, rooms, onSaved }: { lookups: Lookups; rooms: Room[]; onSaved: () => void }) {
  const [error, setError] = useState('')
  const [saved, setSaved] = useState('')
  async function create(event: FormEvent<HTMLFormElement>, path: string) {
    event.preventDefault()
    setError('')
    setSaved('')
    try {
      await api(path, { method: 'POST', body: JSON.stringify(toPayload(event.currentTarget)) })
      setSaved('บันทึกข้อมูลเรียบร้อย')
      event.currentTarget.reset()
      onSaved()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'บันทึกข้อมูลไม่สำเร็จ')
    }
  }
  return <><section className="welcome-row"><div><p className="eyebrow">การดูแลระบบ</p><h1>ตั้งค่าข้อมูลพื้นฐาน</h1><p className="subheading">โครงการ ห้องพัก ผังบัญชี ค่าบริการ และอัตราสาธารณูปโภค</p></div></section>{error && <div className="page-error" role="alert">{error}</div>}{saved && <div className="success-notice" role="status">{saved}</div>}<section className="setup-grid">
    <SetupCard title="1. โครงการ" description={`${lookups.properties.length} โครงการ`} submit={(event) => create(event, '/properties')}><label>รหัสโครงการ<input name="code" maxLength={30} required placeholder="เช่น MAIN" /></label><label>ชื่อโครงการ<input name="name" maxLength={200} required placeholder="ชื่อโครงการ/ที่พัก" /></label><label>ที่อยู่<textarea name="address" rows={2} /></label></SetupCard>
    <SetupCard title="2. อาคาร" description={`${lookups.buildings.length} อาคาร`} submit={(event) => create(event, '/buildings')}><label>โครงการ<select name="propertyId" required defaultValue=""><option value="" disabled>เลือกโครงการ</option>{lookups.properties.map((property) => <option key={property.id} value={property.id}>{property.name}</option>)}</select></label><label>รหัสอาคาร<input name="code" maxLength={30} required placeholder="เช่น A" /></label><label>ชื่ออาคาร<input name="name" maxLength={200} required placeholder="อาคาร A" /></label></SetupCard>
    <SetupCard title="3. ชั้น" description={`${lookups.floors.length} ชั้น`} submit={(event) => create(event, '/floors')}><label>อาคาร<select name="buildingId" required defaultValue=""><option value="" disabled>เลือกอาคาร</option>{lookups.buildings.map((building) => <option key={building.id} value={building.id}>{building.name}</option>)}</select></label><label>รหัสชั้น<input name="code" maxLength={30} required placeholder="เช่น 1" /></label></SetupCard>
    <SetupCard title="4. ประเภทห้อง" description={`${lookups.roomTypes.length} ประเภท`} submit={(event) => create(event, '/room-types')}><label>รหัสประเภทห้อง<input name="code" maxLength={30} required placeholder="เช่น STD" /></label><label>ชื่อประเภทห้อง<input name="name" maxLength={100} required placeholder="ห้องมาตรฐาน" /></label><label>ค่าเช่าตั้งต้น (บาท)<input name="defaultRent" type="number" min="0" step="0.01" required /></label><label>จำนวนผู้พักสูงสุด<input name="capacity" type="number" min="1" step="1" defaultValue="1" required /></label></SetupCard>
    <SetupCard title="5. ผังบัญชี" description={`${lookups.accounts.length} บัญชี`} submit={(event) => create(event, '/accounts')}><label>รหัสบัญชี<input name="code" maxLength={30} required /></label><label>ชื่อบัญชี<input name="name" maxLength={150} required /></label><label>ประเภทบัญชี<select name="accountType" defaultValue="income"><option value="asset">สินทรัพย์</option><option value="liability">หนี้สิน</option><option value="equity">ส่วนของเจ้าของ</option><option value="income">รายได้</option><option value="expense">ค่าใช้จ่าย</option></select></label></SetupCard>
    <SetupCard title="ผู้จำหน่าย" description={`${lookups.suppliers.length} ราย`} submit={(event) => create(event, '/suppliers')}><label>รหัสผู้จำหน่าย<input name="code" maxLength={30} required /></label><label>ชื่อผู้จำหน่าย<input name="name" maxLength={200} required /></label><label>เลขประจำตัวผู้เสียภาษี<input name="taxId" maxLength={30} /></label><label>โทรศัพท์<input name="phone" maxLength={40} /></label><label>ที่อยู่<textarea name="address" rows={2} /></label></SetupCard>
    <SetupCard title="6. รายการค่าบริการ" description={`${lookups.charges.length} รายการ`} submit={(event) => create(event, '/charges')}><label>รหัส<input name="code" maxLength={30} required /></label><label>ชื่อรายการ<input name="name" maxLength={150} required /></label><label>หมวดรายการ<input name="category" maxLength={30} required placeholder="rent / water / electricity" /></label><label>บัญชีรายได้<select name="accountId" required defaultValue=""><option value="" disabled>เลือกบัญชี</option>{lookups.accounts.map((account) => <option key={account.id} value={account.id}>{account.code} · {account.name}</option>)}</select></label><label>ยอดตั้งต้น<input name="defaultAmount" type="number" min="0" step="0.01" defaultValue="0" required /></label><label>ภาษี<select name="taxMode" defaultValue="none"><option value="none">ไม่คิดภาษี</option><option value="inclusive">รวมภาษี</option><option value="exclusive">บวกภาษีเพิ่ม</option></select></label><label>อัตราภาษี %<input name="taxRate" type="number" min="0" max="100" step="0.0001" defaultValue="0" required /></label></SetupCard>
    <SetupCard title="7. อัตราสาธารณูปโภค" description={`${lookups.tariffs.length} อัตรา`} submit={(event) => create(event, '/utility-tariffs')}><label>โครงการ<select name="propertyId" required defaultValue=""><option value="" disabled>เลือกโครงการ</option>{lookups.properties.map((property) => <option key={property.id} value={property.id}>{property.name}</option>)}</select></label><label>ประเภท<select name="utilityType"><option value="water">น้ำ</option><option value="electricity">ไฟฟ้า</option></select></label><label>ชื่ออัตรา<input name="name" maxLength={150} required /></label><label>รายการค่าบริการ<select name="chargeId" required defaultValue=""><option value="" disabled>เลือกค่าบริการ</option>{lookups.charges.map((charge) => <option key={charge.id} value={charge.id}>{charge.code} · {charge.name}</option>)}</select></label><label>วิธีคิด<select name="pricingMethod"><option value="meter">ตามหน่วยมิเตอร์</option><option value="flat">เหมาจ่าย</option></select></label><label>ราคาต่อหน่วย<input name="unitRate" type="number" min="0" step="0.0001" defaultValue="0" /></label><label>ยอดเหมาจ่าย<input name="fixedAmount" type="number" min="0" step="0.01" defaultValue="0" /></label><label>เริ่มใช้วันที่<input name="effectiveFrom" type="date" required /></label></SetupCard>
    <SetupCard title="8. เครื่องมิเตอร์" description={`${rooms.length} ห้อง`} submit={(event) => create(event, '/meters')}><label>ห้อง<select name="roomId" required defaultValue=""><option value="" disabled>เลือกห้อง</option>{rooms.map((room) => <option key={room.id} value={room.id}>{room.building} · {room.code}</option>)}</select></label><label>อัตราสาธารณูปโภค<select name="tariffId" required defaultValue=""><option value="" disabled>เลือกอัตรา</option>{lookups.tariffs.map((tariff) => <option key={tariff.id} value={tariff.id}>{tariff.name}</option>)}</select></label><label>เลขเครื่อง<input name="serialNo" maxLength={100} required /></label><label>ค่ารอบหมุน (ถ้ามี)<input name="rolloverValue" type="number" min="0.001" step="0.001" /></label><label>วันที่ติดตั้ง<input name="installedAt" type="date" required /></label></SetupCard>
    <SetupCard title="9. ผูกอัตรากับห้อง" description="กำหนดช่วงเวลามีผล" submit={(event) => create(event, '/room-utility-tariffs')}><label>ห้อง<select name="roomId" required defaultValue=""><option value="" disabled>เลือกห้อง</option>{rooms.map((room) => <option key={room.id} value={room.id}>{room.building} · {room.code}</option>)}</select></label><label>อัตราสาธารณูปโภค<select name="tariffId" required defaultValue=""><option value="" disabled>เลือกอัตรา</option>{lookups.tariffs.map((tariff) => <option key={tariff.id} value={tariff.id}>{tariff.name}</option>)}</select></label><label>เริ่มใช้วันที่<input name="effectiveFrom" type="date" required /></label><label>สิ้นสุด (ไม่บังคับ)<input name="effectiveTo" type="date" /></label></SetupCard>
    </section></>
}

function SetupCard({ title, description, submit, children }: { title: string; description: string; submit: (event: FormEvent<HTMLFormElement>) => void; children: ReactNode }) {
  return <section className="panel setup-card"><div className="panel-heading"><h2>{title}</h2><span>{description}</span></div><form onSubmit={submit} className="setup-form">{children}<button className="button button-primary" type="submit">บันทึก</button></form></section>
}

function Modal({ title, subtitle, error, close, submit, children }: { title: string; subtitle: string; error: string; close: () => void; submit: (event: FormEvent<HTMLFormElement>) => void; children: ReactNode }) {
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) close() }}><section className="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title"><div className="modal-heading"><div><p className="eyebrow">บันทึกลงฐานข้อมูล</p><h2 id="modal-title">{title}</h2><p>{subtitle}</p></div><button type="button" className="icon-button close-button" aria-label="ปิด" onClick={close}>×</button></div><form onSubmit={submit}>{children}{error && <p className="form-error" role="alert">{error}</p>}<div className="modal-actions"><button className="button button-secondary" type="button" onClick={close}>ยกเลิก</button><button className="button button-primary" type="submit">บันทึกข้อมูล</button></div></form></section></div>
}

function StatCard({ title, value, caption, icon, tone }: { title: string; value: number; caption: string; icon: ReactNode; tone: string }) {
  return <article className="stat-card"><span className={`stat-icon ${tone}`}><Icon>{icon}</Icon></span><div className="stat-copy"><span className="stat-title">{title}</span><strong>{value}<small> ห้อง</small></strong><span className="stat-caption">{caption}</span></div></article>
}

function MiniStat({ label, value, color }: { label: string; value: number; color: string }) {
  return <article className="mini-stat"><span className={`mini-dot ${color}`} /><span>{label}</span><strong>{value}</strong></article>
}

function LegendRow({ label, value, color }: { label: string; value: number; color: string }) {
  return <div className="legend-row"><span className={`legend-dot ${color}`} /><span>{label}</span><strong>{value}</strong><small>ห้อง</small></div>
}

function RoomTable({ rooms, emptyMessage = 'ยังไม่มีข้อมูลห้องพัก' }: { rooms: Room[]; emptyMessage?: string }) {
  return <div className="table-scroll"><table className="room-table"><thead><tr><th>ห้องพัก</th><th>โครงการ / อาคาร / ชั้น</th><th>ผู้เช่าปัจจุบัน</th><th>ค่าเช่าต่อเดือน</th><th>สถานะ</th></tr></thead><tbody>{rooms.length ? rooms.map((room) => <tr key={room.id}><td><span className="room-avatar"><Icon size={17}><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M3 10h18M8 10v10m8-10v10" /></Icon></span><strong>{room.code}</strong></td><td><span className="building-cell">{room.property} · {room.building}</span><small>ชั้น {room.floorCode}</small></td><td>{room.tenant ? <span className="tenant-cell"><span className="tenant-avatar">{room.tenant.slice(0, 1)}</span>{room.tenant}</span> : <span className="muted-dash">—</span>}</td><td className="rent-cell">฿ {formatBaht(room.rent)}<small>/ เดือน</small></td><td><span className={`status-pill ${room.status}`}><i />{statusLabels[room.status] ?? room.status}</span></td></tr>) : <tr><td className="empty-cell" colSpan={5}>{emptyMessage}</td></tr>}</tbody></table></div>
}

export default App
