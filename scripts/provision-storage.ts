/**
 * Create the private bucket that customer documents live in.
 *
 *   npm run storage:provision
 *
 * Deliberately a setup step and not something the upload path does on demand.
 * Creating infrastructure from inside a request means every advisor taking a
 * photo carries the permission to create buckets, and a first-run failure
 * surfaces to them as "could not store the photo" rather than to whoever set
 * the project up.
 *
 * Idempotent — safe to re-run.
 */
import { createClient } from '@supabase/supabase-js'

const BUCKET = 'customer-documents'

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
    process.exit(0)
  }

  const { error } = await admin.storage.createBucket(BUCKET, {
    // Private, and it stays private. A public bucket would put customers'
    // documents on a guessable URL with no session behind it.
    public: false,
    fileSizeLimit: 15 * 1024 * 1024,
    allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp', 'image/heic'],
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
