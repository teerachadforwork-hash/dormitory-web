export type EvidenceFileType = {
  mimeType: 'application/pdf' | 'image/jpeg' | 'image/png' | 'image/webp'
  extension: 'pdf' | 'jpg' | 'png' | 'webp'
}

export function detectEvidenceFileType(bytes: Uint8Array): EvidenceFileType | null {
  if (bytes.length >= 5 && Buffer.from(bytes.subarray(0, 5)).toString('ascii') === '%PDF-') {
    return { mimeType: 'application/pdf', extension: 'pdf' }
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return { mimeType: 'image/jpeg', extension: 'jpg' }
  }
  if (bytes.length >= 8 && Buffer.from(bytes.subarray(0, 8)).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return { mimeType: 'image/png', extension: 'png' }
  }
  if (
    bytes.length >= 12
    && Buffer.from(bytes.subarray(0, 4)).toString('ascii') === 'RIFF'
    && Buffer.from(bytes.subarray(8, 12)).toString('ascii') === 'WEBP'
  ) {
    return { mimeType: 'image/webp', extension: 'webp' }
  }
  return null
}

export function safeEvidenceFileName(fileName: string) {
  const leafName = fileName.split(/[\\/]/).pop() ?? ''
  const sanitized = Array.from(leafName)
    .filter((character) => {
      const code = character.charCodeAt(0)
      return code > 0x1f && code !== 0x7f
    })
    .join('')
    .replace(/[<>:"|?*]/g, '_')
    .trim()
    .slice(0, 180)
  return sanitized || 'payment-evidence'
}
