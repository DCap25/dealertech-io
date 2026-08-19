/**
 * What counts as a service agreement you can upload.
 *
 * Pure, so the rules that decide whether a file is even worth sending to a
 * paid API can be tested without a file, a request or a key.
 */

/**
 * PDFs and images, and the images are not an afterthought.
 *
 * A customer whose only copy of the contract is a photo on their phone has a
 * perfectly good file, and refusing it would send them home for paperwork that
 * is already in their hand. What the upload path drops is the *camera* as the
 * primary route — an advisor photographing a legal document across a service
 * counter, in whatever light the drive has, hoping the fold in the middle
 * missed the mileage limit.
 *
 * HEIC is here because it is what an iPhone produces by default and a customer
 * should not have to know that.
 */
export const ACCEPTED_MEDIA_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
] as const

export type AcceptedMediaType = (typeof ACCEPTED_MEDIA_TYPES)[number]

/**
 * Twenty megabytes.
 *
 * Above the 12MB the photo path allowed, because a scanned multi-page contract
 * is legitimately bigger than one phone photo, and below the point where the
 * request is the problem. Checked *before* the file is base64-encoded and
 * before the API call, so an oversized upload costs nothing but a message.
 */
export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024

/** Pages beyond this are an appendix nobody needs read, and cost real money. */
export const MAX_PDF_PAGES = 30

export type UploadRejection =
  | { ok: false; reason: 'MISSING'; message: string }
  | { ok: false; reason: 'TYPE'; message: string }
  | { ok: false; reason: 'SIZE'; message: string }

export type UploadCheck = { ok: true; mediaType: AcceptedMediaType } | UploadRejection

function isAccepted(type: string): type is AcceptedMediaType {
  return (ACCEPTED_MEDIA_TYPES as readonly string[]).includes(type)
}

function megabytes(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`
}

/**
 * Is this file worth an extraction call?
 *
 * Every rejection says what to do next rather than what went wrong. An advisor
 * standing at a podium with a customer waiting does not need to be told their
 * file failed validation; they need to be told to export it as a PDF.
 */
export function checkUpload(file: { type: string; size: number } | null): UploadCheck {
  if (!file || file.size === 0) {
    return {
      ok: false,
      reason: 'MISSING',
      message: 'Choose the service agreement first — a PDF or a photo of it.',
    }
  }

  // Browsers send an empty type for files they cannot identify, and some send
  // the wrong one. Saying which formats work is more useful than echoing back
  // a MIME type the person never chose.
  if (!isAccepted(file.type)) {
    return {
      ok: false,
      reason: 'TYPE',
      message: `${file.type || 'That file'} is not something we can read. Upload a PDF, or a JPEG, PNG or HEIC photo of the agreement.`,
    }
  }

  if (file.size > MAX_UPLOAD_BYTES) {
    return {
      ok: false,
      reason: 'SIZE',
      message: `That file is ${megabytes(file.size)}, over the ${megabytes(MAX_UPLOAD_BYTES)} limit. Scan it at a lower resolution, or upload just the pages with the product, administrator, dates and VIN on them.`,
    }
  }

  return { ok: true, mediaType: file.type }
}

/** PDFs go to the model as documents; everything else goes as an image. */
export function isPdf(mediaType: string): boolean {
  return mediaType === 'application/pdf'
}

/** The `accept` attribute for the file input, kept in step with the server rule. */
export const UPLOAD_ACCEPT_ATTRIBUTE = ACCEPTED_MEDIA_TYPES.join(',')
