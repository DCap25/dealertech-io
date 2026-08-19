/**
 * Create the private bucket that customer documents live in.
 *
 *   npm run storage:provision
 *
 * Deliberately a setup step and not something the upload path does on demand.
 * Creating infrastructure from inside a request means every advisor uploading
 * a contract carries the permission to create buckets, and a first-run failure
 * surfaces to them as "could not store the document" rather than to whoever set
 * the project up.
 *
 * Idempotent — safe to re-run, and re-running is now meaningful: an existing
 * bucket has its allowed MIME types widened rather than being left alone. The
 * bucket predates PDF uploads and was created images-only, so a project set up
 * before that change rejects every PDF at the storage layer with an error the
 * advisor cannot act on. Re-run this after deploying the upload flow.
 */
import { createClient } from '@supabase/supabase-js'

const BUCKET = 'customer-documents'

/**
 * Kept in step with ACCEPTED_MEDIA_TYPES in src/lib/contract-capture/upload.ts.
 *
 * Not imported from there because this script runs outside the Next build and
 * that module is part of the app's path aliasing — so the two are checked by a
 * test instead (src/lib/contract-capture/upload.test.ts).
 */
const ALLOWED_MIME_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
]

const FILE_SIZE_LIMIT = 20 * 1024 * 1024

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const secret = process.env.SUPABASE_SECRET_KEY
  if (!url || !secret) {
    console.error('Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY in .env.local first.')
    process.exit(1)
  }

  const admin = createClient(url, secret, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  const { data: existing } = await admin.storage.getBucket(BUCKET)
  if (existing) {
    console.log(`ok       ${BUCKET} already exists (public: ${existing.public})`)
    if (existing.public) {
      console.warn(
        'WARNING  this bucket is PUBLIC. Customer contracts carry names, VINs and signatures — ' +
          'make it private in the Supabase dashboard.',
      )
    }

    /*
      Widen an existing bucket rather than leaving it as it was found.

      The bucket was created images-only, before contracts could be uploaded as
      PDFs. On a project set up then, every PDF upload fails inside Supabase
      Storage with a MIME-type rejection — which surfaces to the advisor as
      "could not store the document" and to nobody as the actual cause. This is
      the one place that knows the right answer, so it applies it.
    */
    const { error: updateError } = await admin.storage.updateBucket(BUCKET, {
      public: false,
      fileSizeLimit: FILE_SIZE_LIMIT,
      allowedMimeTypes: ALLOWED_MIME_TYPES,
    })
    if (updateError) {
      console.error(`FAILED   could not update ${BUCKET}: ${updateError.message}`)
      process.exit(1)
    }
    console.log(`updated  accepts ${ALLOWED_MIME_TYPES.join(', ')} up to 20MB`)
    process.exit(0)
  }

  const { error } = await admin.storage.createBucket(BUCKET, {
    // Private, and it stays private. A public bucket would put customers'
    // documents on a guessable URL with no session behind it.
    public: false,
    fileSizeLimit: FILE_SIZE_LIMIT,
    allowedMimeTypes: ALLOWED_MIME_TYPES,
  })

  if (error) {
    console.error(`FAILED   could not create ${BUCKET}: ${error.message}`)
    process.exit(1)
  }

  console.log(`created  ${BUCKET} (private)`)
  console.log('\nDocuments are read back through short-lived signed URLs, so the bucket')
  console.log('never needs to be public.')
  process.exit(0)
}

void main()
