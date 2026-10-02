export type InvoicePrintData = {
  invoice: {
    documentNo: string
    issuedAt: string
    dueDate: string
    status: string
    subtotal: string
    taxTotal: string
    total: string
    snapshot: Record<string, unknown>
  }
  items: {
    id: string
    description: string
    quantity: string
    unitPrice: string
    netAmount: string
    taxRate: string
    taxAmount: string
    lineTotal: string
    taxMode: string
  }[]
}

export type ReceiptPrintData = {
  receipt: {
    documentNo: string
    issuedAt: string
    status: string
    snapshot: {
      paymentNo: string
      customerName: string
      address: string | null
      amount: string
      method: string
      reference: string | null
      receivedAt: string
      allocations: { documentNo: string; amount: string }[]
    }
  }
}

function escapeHtml(value: unknown) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[character] ?? character)
}

function formatBaht(amount: number | string) {
  return new Intl.NumberFormat('th-TH', { maximumFractionDigits: 2 }).format(Number(amount))
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat('th-TH', { dateStyle: 'medium', timeZone: 'Asia/Bangkok' }).format(new Date(`${value.slice(0, 10)}T00:00:00+07:00`))
}

export function invoicePrintMarkup(data: InvoicePrintData) {
  const invoice = data.invoice
  const snapshot = invoice.snapshot
  const items = data.items.map((item) => `<tr>
    <td>${escapeHtml(item.description)}</td><td class="number">${escapeHtml(item.quantity)}</td>
    <td class="number">${escapeHtml(formatBaht(item.unitPrice))}</td><td class="number">${escapeHtml(item.taxRate)}%</td>
    <td class="number">${escapeHtml(formatBaht(item.taxAmount))}</td><td class="number">${escapeHtml(formatBaht(item.lineTotal))}</td>
  </tr>`).join('')
  return `<!doctype html><html lang="th"><head><meta charset="utf-8"><title>${escapeHtml(invoice.documentNo)}</title>
    <style>
      @page { size: A4; margin: 16mm; }
      body { color: #17212b; font: 12px Arial, sans-serif; }
      h1 { margin: 0 0 6px; font-size: 23px; } h2 { margin: 0 0 4px; font-size: 15px; }
      p { margin: 4px 0; } .heading { display: flex; justify-content: space-between; border-bottom: 2px solid #1d7667; padding-bottom: 12px; }
      .meta { display: grid; grid-template-columns: 1fr 1fr; gap: 5px 24px; margin: 18px 0; }
      table { width: 100%; border-collapse: collapse; margin-top: 16px; }
      th, td { border: 1px solid #d0d5dd; padding: 8px; text-align: left; }
      th { background: #f2f4f7; } .number { text-align: right; white-space: nowrap; }
      .totals { width: 45%; margin: 14px 0 0 auto; } .totals td { border: 0; padding: 5px; }
      .grand { border-top: 2px solid #1d2939 !important; font-size: 14px; font-weight: bold; }
      .footer { margin-top: 55px; display: grid; grid-template-columns: 1fr 1fr; gap: 45px; text-align: center; }
      .signature { border-top: 1px solid #667085; padding-top: 7px; }
      @media screen { body { max-width: 190mm; margin: 20px auto; } }
    </style></head><body>
    <div class="heading"><div><h1>ใบแจ้งหนี้</h1></div><div><strong>${escapeHtml(invoice.documentNo)}</strong><p>สถานะ: ${escapeHtml(invoice.status)}</p></div></div>
    <div class="meta"><div><strong>ผู้เช่า</strong><p>${escapeHtml(snapshot.customerName)}</p><p>${escapeHtml(snapshot.customerAddress)}</p></div>
      <div><p>วันที่ออก: ${escapeHtml(formatDate(invoice.issuedAt))}</p><p>วันครบกำหนด: ${escapeHtml(formatDate(invoice.dueDate))}</p>
        <p>เลขที่สัญญา: ${escapeHtml(snapshot.contractNo)}</p><p>ห้อง: ${escapeHtml(snapshot.roomCode)}</p></div></div>
    <table><thead><tr><th>รายการ</th><th class="number">จำนวน</th><th class="number">ราคาต่อหน่วย</th><th class="number">อัตราภาษี</th><th class="number">ยอดภาษี</th><th class="number">รวม</th></tr></thead><tbody>
      ${items || '<tr><td colspan="6">ไม่มีรายการ</td></tr>'}
    </tbody></table>
    <table class="totals"><tbody><tr><td>ยอดก่อนภาษี</td><td class="number">${escapeHtml(formatBaht(invoice.subtotal))}</td></tr>
      <tr><td>ภาษี</td><td class="number">${escapeHtml(formatBaht(invoice.taxTotal))}</td></tr>
      <tr class="grand"><td>ยอดรวมสุทธิ (บาท)</td><td class="number">${escapeHtml(formatBaht(invoice.total))}</td></tr></tbody></table>
    <div class="footer"><div class="signature">ผู้รับเงิน / ผู้มีอำนาจ</div><div class="signature">ผู้รับเอกสาร</div></div>
    </body></html>`
}

export function receiptPrintMarkup(data: ReceiptPrintData) {
  const { receipt } = data
  const snapshot = receipt.snapshot
  const methodNames: Record<string, string> = { cash: 'เงินสด', transfer: 'โอนเงิน', cheque: 'เช็ค', card: 'บัตร' }
  const allocations = snapshot.allocations.map((allocation) => `<tr>
    <td>${escapeHtml(allocation.documentNo)}</td><td class="number">${escapeHtml(formatBaht(allocation.amount))}</td>
  </tr>`).join('')
  return `<!doctype html><html lang="th"><head><meta charset="utf-8"><title>${escapeHtml(receipt.documentNo)}</title>
    <style>
      @page { size: A4; margin: 16mm; }
      body { color: #17212b; font: 13px Arial, sans-serif; }
      h1 { margin: 0 0 6px; font-size: 23px; } h2 { margin: 0 0 4px; font-size: 15px; }
      p { margin: 5px 0; } .heading { display: flex; justify-content: space-between; border-bottom: 2px solid #1d7667; padding-bottom: 12px; }
      .meta { margin: 20px 0; line-height: 1.7; }
      table { width: 100%; border-collapse: collapse; margin-top: 16px; }
      th, td { border: 1px solid #d0d5dd; padding: 9px; text-align: left; }
      th { background: #f2f4f7; } .number { text-align: right; white-space: nowrap; }
      .amount { margin: 24px 0; padding: 14px; border: 1px solid #d0d5dd; text-align: right; font-size: 18px; font-weight: bold; }
      .footer { margin-top: 60px; display: grid; grid-template-columns: 1fr 1fr; gap: 45px; text-align: center; }
      .signature { border-top: 1px solid #667085; padding-top: 7px; }
      @media screen { body { max-width: 190mm; margin: 20px auto; } }
    </style></head><body>
    <div class="heading"><div><h1>ใบเสร็จรับเงิน</h1></div><div><strong>${escapeHtml(receipt.documentNo)}</strong><p>ออกเมื่อ: ${escapeHtml(formatDate(receipt.issuedAt))}</p></div></div>
    <div class="meta"><p><strong>ได้รับเงินจาก:</strong> ${escapeHtml(snapshot.customerName)}</p>
      <p><strong>ที่อยู่:</strong> ${escapeHtml(snapshot.address)}</p>
      <p><strong>เลขที่รับเงิน:</strong> ${escapeHtml(snapshot.paymentNo)}</p>
      <p><strong>วันที่รับเงิน:</strong> ${escapeHtml(formatDate(snapshot.receivedAt))}</p>
      <p><strong>วิธีชำระ:</strong> ${escapeHtml(methodNames[snapshot.method] ?? snapshot.method)}</p>
      ${snapshot.reference ? `<p><strong>เลขอ้างอิง:</strong> ${escapeHtml(snapshot.reference)}</p>` : ''}</div>
    <table><thead><tr><th>จัดสรรชำระใบแจ้งหนี้</th><th class="number">จำนวนเงิน (บาท)</th></tr></thead><tbody>
      ${allocations || '<tr><td>รับชำระล่วงหน้า / ยังไม่จัดสรร</td><td class="number">—</td></tr>'}
    </tbody></table>
    <div class="amount">ยอดรับชำระ: ฿ ${escapeHtml(formatBaht(snapshot.amount))}</div>
    <div class="footer"><div class="signature">ผู้รับเงิน / ผู้มีอำนาจ</div><div class="signature">ผู้ชำระเงิน</div></div>
    </body></html>`
}
