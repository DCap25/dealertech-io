/**
 * What counts as a service agreement you can upload.
 *
 * Pure, so the rules that decide whether a file is even worth sending to a
 * paid API can be tested without a file, a request or a key.
 */

/**
 * Exactly the image formats the vision API will accept.
 *
 * Not a preference — jpeg, png, gif and webp are the whole list, and anything
 * else sent as an `image` block comes back a 400. Kept as its own union so the
 * compiler, not a cast, is what stops a fifth format reaching the call.
 *
 * HEIC used to be here, on the reasoning that it is what an iPhone produces by
 * default and a customer should not have to know that. The reasoning was right
 * and the conclusion was backwards: listing HEIC in the file input's `accept`
 * is precisely what made iOS hand over the raw .heic instead of transcoding.
 * Leave it out and the photo picker converts to JPEG at selection time — the
 * customer still never learns the word, and the file that arrives is readable.
 */
export const IMAGE_MEDIA_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const

export type ImageMediaType = (typeof IMAGE_MEDIA_TYPES)[number]

/**
 * PDFs and images, and the images are not an afterthought.
 *
 * A customer whose only copy of the contract is a photo on their phone has a
 * perfectly good file, and refusing it would send them home for paperwork that
 * is already in their hand. What the upload path drops is the *camera* as the
 * primary route — an advisor photographing a legal document across a service
 * counter, in whatever light the drive has, hoping the fold in the middle
 * missed the mileage limit.
 */
export const ACCEPTED_MEDIA_TYPES = ['application/pdf', ...IMAGE_MEDIA_TYPES] as const

export type AcceptedMediaType = (typeof ACCEPTED_MEDIA_TYPES)[number]

/**
 * Twenty megabytes.
 *
 * Above the 12MB the photo path allowed, because a scanned multi-page contract
 * is legitimately bigger than one phone photo, and below the point where the
 * request is the problem. Checked *before* the file is base64-encoded and
 * before the API call, so an oversized upload costs nothing but a message.
 *
 * This is the *PDF* ceiling. Images have their own, lower one — see below.
 */
export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024

/**
 * Seven megabytes, for images only.
 *
 * The vision API caps a single image at 10MB *base64-encoded*, and base64 is
 * four bytes out of every three: 7MiB of pixels encodes to 7 × 4/3 ≈ 9.3MiB,
 * comfortably inside 10 with room for the rest of the request. A file between
 * this and MAX_UPLOAD_BYTES used to pass validation, get stored, get encoded,
 * get sent, and come back a 400 — which the advisor saw as "we could not read
 * the document", the one explanation that is not true.
 *
 * PDFs keep the 20MB limit: they go as `document` blocks, which are bounded by
 * the 32MB request limit rather than the per-image one.
 */
export const MAX_IMAGE_BYTES = 7 * 1024 * 1024

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

  /*
    Browsers send an empty type for files they cannot identify, and some send
    the wrong one. Saying which formats work is more useful than echoing back
    a MIME type the person never chose.

    The one arrival worth naming is a raw .heic, which reaches here only from a
    desktop or Files-app picker — on a phone the `accept` attribute has already
    had iOS convert it. That person is holding a file their own computer opens
    fine and has no reason to guess what is wrong with it, so the message says
    what to do rather than what a container format is.
  */
  if (!isAccepted(file.type)) {
    return {
      ok: false,
      reason: 'TYPE',
      message: `${file.type || 'That file'} is not something we can read. Upload a PDF, or a JPEG, PNG or WebP photo — if it came off an iPhone, export or share it as JPEG or PDF first.`,
    }
  }

  /*
    Two ceilings, because the model has two. A PDF goes as a document block and
    gets the full 20MB; an image goes as an image block and has to survive
    base64 under the API's per-image limit. Checking the right one here is what
    keeps an oversized photo from being reported as an unreadable one.
  */
  const limit = isPdf(file.type) ? MAX_UPLOAD_BYTES : MAX_IMAGE_BYTES
  if (file.size > limit) {
    const advice = isPdf(file.type)
      ? 'Scan it at a lower resolution, or upload just the pages with the product, administrator, dates and VIN on them.'
      : 'Photograph or scan it at a lower resolution, or save it as a PDF and upload that instead.'
    return {
      ok: false,
      reason: 'SIZE',
      message: `That file is ${megabytes(file.size)}, over the ${megabytes(limit)} limit. ${advice}`,
    }
  }

  return { ok: true, mediaType: file.type }
}

/**
 * PDFs go to the model as documents; everything else goes as an image.
 *
 * A type predicate rather than a plain boolean so the caller's `else` branch
 * narrows to `ImageMediaType` on its own. That is the whole point: the image
 * branch of the extraction call used to carry a cast asserting the media type
 * was one the API accepts, which is exactly the claim that was false for HEIC.
 */
export function isPdf(mediaType: string): mediaType is 'application/pdf' {
  return mediaType === 'application/pdf'
}

/** The `accept` attribute for the file input, kept in step with the server rule. */
export const UPLOAD_ACCEPT_ATTRIBUTE = ACCEPTED_MEDIA_TYPES.join(',')
