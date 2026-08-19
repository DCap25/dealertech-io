import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  ACCEPTED_MEDIA_TYPES, MAX_UPLOAD_BYTES, UPLOAD_ACCEPT_ATTRIBUTE, checkUpload, isPdf,
} from './upload'

/**
 * The gate in front of the money.
 *
 * Everything rejected here costs nothing: no base64 encoding, no object
 * storage write, no paid API call over a multi-megabyte document.
 */

describe('what gets through', () => {
  it('accepts a PDF, which is what a contract usually arrives as', () => {
    const result = checkUpload({ type: 'application/pdf', size: 2_000_000 })
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('unreachable')
    expect(result.mediaType).toBe('application/pdf')
  })

  it('accepts a photo, because a customer with one on their phone has a real file', () => {
    for (const type of ['image/jpeg', 'image/png', 'image/webp', 'image/heic']) {
      expect(checkUpload({ type, size: 3_000_000 }).ok).toBe(true)
    }
  })

  it('accepts HEIC without making the customer know what HEIC is', () => {
    // It is what an iPhone produces by default.
    expect(checkUpload({ type: 'image/heic', size: 1_000 }).ok).toBe(true)
  })
})

describe('what does not', () => {
  it('rejects nothing at all, and says what to do', () => {
    const result = checkUpload(null)
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('unreachable')
    expect(result.reason).toBe('MISSING')
    expect(result.message).toMatch(/PDF or a photo/i)
  })

  it('rejects a zero-byte file, which a browser will happily submit', () => {
    const result = checkUpload({ type: 'application/pdf', size: 0 })
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('unreachable')
    expect(result.reason).toBe('MISSING')
  })

  it('rejects a format nothing can read, naming the ones that work', () => {
    const result = checkUpload({ type: 'application/msword', size: 1_000 })
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('unreachable')
    expect(result.reason).toBe('TYPE')
    expect(result.message).toMatch(/PDF/i)
  })

  it('handles the empty type a browser sends for a file it cannot identify', () => {
    const result = checkUpload({ type: '', size: 1_000 })
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('unreachable')
    expect(result.message).toMatch(/^That file is not something we can read/)
  })

  it('rejects a file over the cap, before anything expensive happens', () => {
    const result = checkUpload({ type: 'application/pdf', size: MAX_UPLOAD_BYTES + 1 })
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('unreachable')
    expect(result.reason).toBe('SIZE')
    expect(result.message).toMatch(/20\.0MB limit/)
  })

  it('accepts a file exactly at the cap', () => {
    expect(checkUpload({ type: 'application/pdf', size: MAX_UPLOAD_BYTES }).ok).toBe(true)
  })
})

describe('routing to the right content block', () => {
  it('sends a PDF as a document and everything else as an image', () => {
    expect(isPdf('application/pdf')).toBe(true)
    expect(isPdf('image/jpeg')).toBe(false)
  })
})

describe('the accept attribute', () => {
  it('offers the browser exactly what the server will take', () => {
    // A file picker that offers more than the server accepts turns a rejection
    // into a wasted upload; one that offers less hides a supported format.
    expect(UPLOAD_ACCEPT_ATTRIBUTE.split(',')).toEqual([...ACCEPTED_MEDIA_TYPES])
  })
})

describe('the storage bucket agrees with this module', () => {
  it('provisions the same MIME types the upload path accepts', () => {
    /*
      The provisioning script cannot import from here — it runs outside the
      Next build and this module is behind the app's path aliasing. So the two
      lists are checked against each other instead of being allowed to drift.

      Drift here is a bad failure: the bucket rejects the upload inside
      Supabase Storage, and the advisor is told "could not store the document"
      with no indication that the file was fine and the bucket was stale.
    */
    const script = readFileSync('scripts/provision-storage.ts', 'utf8')
    for (const type of ACCEPTED_MEDIA_TYPES) {
      expect(script).toContain(`'${type}'`)
    }
  })
})
