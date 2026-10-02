import 'dotenv/config'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createPortalFixture } from './portal-api-fixture.ts'

test('tenant portal only exposes the signed-in tenant invoices and printable invoice data', {
  skip: !process.env.DATABASE_URL,
}, async () => {
  const fixture = await createPortalFixture()
  try {
    const cookie = await fixture.login(fixture.tenantA.username)
    const dashboard = await fetch(`${fixture.baseUrl}/api/portal`, { headers: { Cookie: cookie } })
    assert.equal(dashboard.status, 200)
    const data = await dashboard.json() as { invoices: { id: string; documentNo: string }[] }
    assert.deepEqual(data.invoices.map((invoice) => invoice.id), [fixture.tenantA.invoiceId])

    const printData = await fetch(
      `${fixture.baseUrl}/api/portal/invoices/${fixture.tenantA.invoiceId}/print-data`,
      { headers: { Cookie: cookie } },
    )
    assert.equal(printData.status, 200)
    const printable = await printData.json() as { invoice: { documentNo: string }; items: unknown[] }
    assert.equal(printable.invoice.documentNo.startsWith('PTI-'), true)
    assert.deepEqual(printable.items, [])

    const otherTenantInvoice = await fetch(
      `${fixture.baseUrl}/api/portal/invoices/${fixture.tenantB.invoiceId}/print-data`,
      { headers: { Cookie: cookie } },
    )
    assert.equal(otherTenantInvoice.status, 404)

    const anonymous = await fetch(`${fixture.baseUrl}/api/portal`)
    assert.equal(anonymous.status, 401)
  } finally {
    await fixture.cleanup()
  }
})
