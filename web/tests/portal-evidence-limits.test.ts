import 'dotenv/config'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createPortalFixture, uploadPdf } from './portal-api-fixture.ts'

test('concurrent tenant evidence uploads cannot exceed the five-file invoice limit', {
  skip: !process.env.DATABASE_URL,
}, async () => {
  const fixture = await createPortalFixture()
  try {
    const cookie = await fixture.login(fixture.tenantA.username)
    const responses = await Promise.all(
      Array.from({ length: 6 }, () => uploadPdf(fixture.baseUrl, cookie, fixture.tenantA.invoiceId)),
    )
    const statuses = responses.map((response) => response.status).sort((left, right) => left - right)
    assert.deepEqual(statuses, [201, 201, 201, 201, 201, 409])

    const oversized = await uploadPdf(
      fixture.baseUrl,
      cookie,
      fixture.tenantB.invoiceId,
      Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(5 * 1024 * 1024)]),
    )
    assert.equal(oversized.status, 413)

    const dashboard = await fetch(`${fixture.baseUrl}/api/portal`, { headers: { Cookie: cookie } })
    const data = await dashboard.json() as { invoices: { attachments: unknown[] }[] }
    assert.equal(data.invoices[0].attachments.length, 5)
  } finally {
    await fixture.cleanup()
  }
})
