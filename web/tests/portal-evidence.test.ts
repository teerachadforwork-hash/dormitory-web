import 'dotenv/config'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createPortalFixture, uploadPdf } from './portal-api-fixture.ts'

test('tenant uploads payment evidence and only the invoice owner can download it', {
  skip: !process.env.DATABASE_URL,
}, async () => {
  const fixture = await createPortalFixture()
  try {
    const ownerCookie = await fixture.login(fixture.tenantA.username)
    const invalidFile = await uploadPdf(
      fixture.baseUrl,
      ownerCookie,
      fixture.tenantA.invoiceId,
      Buffer.from('<svg onload=alert(1)>'),
    )
    assert.equal(invalidFile.status, 400)

    const uploaded = await uploadPdf(fixture.baseUrl, ownerCookie, fixture.tenantA.invoiceId)
    assert.equal(uploaded.status, 201)
    const { attachment } = await uploaded.json() as { attachment: { id: string; fileName: string } }
    assert.equal(attachment.fileName, 'receipt.pdf')

    const download = await fetch(`${fixture.baseUrl}/api/portal/attachments/${attachment.id}`, {
      headers: { Cookie: ownerCookie },
    })
    assert.equal(download.status, 200)
    assert.equal(download.headers.get('content-type'), 'application/pdf')
    assert.match(download.headers.get('content-disposition') ?? '', /filename\*=UTF-8''receipt\.pdf/)
    assert.equal(Buffer.from(await download.arrayBuffer()).toString(), '%PDF-1.7\nportal test')

    const otherTenantCookie = await fixture.login(fixture.tenantB.username)
    const forbiddenDownload = await fetch(`${fixture.baseUrl}/api/portal/attachments/${attachment.id}`, {
      headers: { Cookie: otherTenantCookie },
    })
    assert.equal(forbiddenDownload.status, 404)
    const anonymousDownload = await fetch(`${fixture.baseUrl}/api/portal/attachments/${attachment.id}`)
    assert.equal(anonymousDownload.status, 401)

    const dashboard = await fetch(`${fixture.baseUrl}/api/portal`, { headers: { Cookie: ownerCookie } })
    const data = await dashboard.json() as { invoices: { attachments: { id: string }[] }[] }
    assert.equal(data.invoices[0].attachments.some((item) => item.id === attachment.id), true)
  } finally {
    await fixture.cleanup()
  }
})
