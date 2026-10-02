import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { detectEvidenceFileType, safeEvidenceFileName } from '../server/attachment-validation.ts'

describe('tenant evidence file validation', () => {
  it('detects only supported file signatures', () => {
    assert.deepEqual(detectEvidenceFileType(Buffer.from('%PDF-1.7')), {
      mimeType: 'application/pdf',
      extension: 'pdf',
    })
    assert.deepEqual(detectEvidenceFileType(Buffer.from([0xff, 0xd8, 0xff, 0xe0])), {
      mimeType: 'image/jpeg',
      extension: 'jpg',
    })
    assert.deepEqual(detectEvidenceFileType(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])), {
      mimeType: 'image/png',
      extension: 'png',
    })
    assert.deepEqual(detectEvidenceFileType(Buffer.from('RIFF0000WEBP')), {
      mimeType: 'image/webp',
      extension: 'webp',
    })
    assert.equal(detectEvidenceFileType(Buffer.from('<svg></svg>')), null)
  })

  it('keeps only a sanitized leaf file name', () => {
    assert.equal(safeEvidenceFileName('../../receipt<1>.pdf'), 'receipt_1_.pdf')
    assert.equal(safeEvidenceFileName('C:\\private\\receipt.pdf'), 'receipt.pdf')
    assert.equal(safeEvidenceFileName('\u0000\u001f\u007f'), 'payment-evidence')
  })
})
