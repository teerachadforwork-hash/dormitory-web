import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { invoicePrintMarkup, receiptPrintMarkup, type InvoicePrintData, type ReceiptPrintData } from '../src/printDocuments.ts'

const invoiceFixture: InvoicePrintData = {
  invoice: {
    documentNo: 'INV-2026-0001',
    issuedAt: '2026-10-01',
    dueDate: '2026-10-15',
    status: 'issued',
    subtotal: '1000.00',
    taxTotal: '70.00',
    total: '1070.00',
    snapshot: {
      customerName: 'คุณทดสอบ',
      customerAddress: 'กรุงเทพฯ',
      contractNo: 'CT-001',
      roomCode: 'A-101',
    },
  },
  items: [{
    id: '1',
    description: 'ค่าเช่าห้อง',
    quantity: '1',
    unitPrice: '1000.0000',
    netAmount: '1000.00',
    taxRate: '7.0000',
    taxAmount: '70.00',
    lineTotal: '1070.00',
    taxMode: 'exclusive',
  }],
}

const receiptFixture: ReceiptPrintData = {
  receipt: {
    documentNo: 'RCT-2026-0001',
    issuedAt: '2026-10-02T10:30:00.000Z',
    status: 'issued',
    snapshot: {
      paymentNo: 'PAY-2026-0001',
      customerName: 'คุณทดสอบ',
      address: 'กรุงเทพฯ',
      amount: '1070.00',
      method: 'transfer',
      reference: 'BANK-REF-001',
      receivedAt: '2026-10-02T10:20:00.000Z',
      allocations: [{ documentNo: 'INV-2026-0001', amount: '1070.00' }],
    },
  },
}

describe('print document markup', () => {
  it('renders invoice identity, line items, taxes, totals, and A4 page setup', () => {
    const html = invoicePrintMarkup(invoiceFixture)

    assert.match(html, /<!doctype html>/i)
    assert.match(html, /size: A4/)
    assert.match(html, /INV-2026-0001/)
    assert.match(html, /ค่าเช่าห้อง/)
    assert.match(html, /อัตราภาษี/)
    assert.match(html, /1,070/)
  })

  it('escapes user-controlled invoice fields before writing HTML', () => {
    const html = invoicePrintMarkup({
      ...invoiceFixture,
      invoice: {
        ...invoiceFixture.invoice,
        documentNo: '<script>alert(1)</script>',
        snapshot: { ...invoiceFixture.invoice.snapshot, customerName: '<img src=x onerror=alert(1)>' },
      },
      items: [{ ...invoiceFixture.items[0], description: 'ค่าเช่า <script>bad()</script>' }],
    })

    assert.doesNotMatch(html, /<script>/i)
    assert.doesNotMatch(html, /<img src=/i)
    assert.match(html, /&lt;script&gt;/)
    assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/)
  })

  it('renders receipt customer, payment method, reference, and allocations', () => {
    const html = receiptPrintMarkup(receiptFixture)

    assert.match(html, /ใบเสร็จรับเงิน/)
    assert.match(html, /RCT-2026-0001/)
    assert.match(html, /PAY-2026-0001/)
    assert.match(html, /โอนเงิน/)
    assert.match(html, /BANK-REF-001/)
    assert.match(html, /INV-2026-0001/)
    assert.match(html, /1,070/)
    assert.match(html, /size: A4/)
  })

  it('renders an unallocated receipt and escapes user-controlled receipt fields', () => {
    const html = receiptPrintMarkup({
      receipt: {
        ...receiptFixture.receipt,
        documentNo: '<script>bad()</script>',
        snapshot: {
          ...receiptFixture.receipt.snapshot,
          customerName: '<img src=x onerror=alert(1)>',
          reference: null,
          allocations: [],
        },
      },
    })

    assert.match(html, /รับชำระล่วงหน้า \/ ยังไม่จัดสรร/)
    assert.doesNotMatch(html, /<script>/i)
    assert.doesNotMatch(html, /<img src=/i)
    assert.match(html, /&lt;script&gt;bad\(\)&lt;\/script&gt;/)
    assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/)
    assert.doesNotMatch(html, /BANK-REF-001/)
  })
})
