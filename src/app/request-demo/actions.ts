'use server'

import { getDb, schema } from '@/db/client'

export interface DemoRequestState {
  ok?: boolean
  error?: string
  fieldErrors?: Record<string, string>
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export async function submitDemoRequest(
  _previous: DemoRequestState,
  formData: FormData,
): Promise<DemoRequestState> {
  const value = (key: string) => String(formData.get(key) ?? '').trim()

  // Honeypot. A real person never fills a hidden field; bots fill everything.
  if (value('company_website')) return { ok: true }

  const name = value('name')
  const email = value('email')
  const dealershipName = value('dealershipName')

  const fieldErrors: Record<string, string> = {}
  if (!name) fieldErrors.name = 'Tell us who you are.'
  if (!email) fieldErrors.email = 'We need somewhere to reply.'
  else if (!EMAIL_PATTERN.test(email)) fieldErrors.email = 'That does not look like an email address.'
  if (!dealershipName) fieldErrors.dealershipName = 'Which store?'

  if (Object.keys(fieldErrors).length > 0) return { fieldErrors }

  const rooftopsRaw = Number(value('rooftops'))
  const rooftops = Number.isFinite(rooftopsRaw) && rooftopsRaw > 0 ? Math.floor(rooftopsRaw) : null

  try {
    const db = getDb()
    await db.insert(schema.demoRequests).values({
      name,
      email,
      phone: value('phone') || null,
      dealershipName,
      role: value('role') || null,
      rooftops,
      dms: value('dms') || null,
      message: value('message') || null,
      source: value('source') || 'website',
    })
    return { ok: true }
  } catch (cause) {
    // Never lose a lead to a database hiccup without saying so plainly.
    return {
      error:
        cause instanceof Error
          ? `Could not save your request (${cause.message}). Email dan@dealertech.io and we will pick it up.`
          : 'Could not save your request. Please email dan@dealertech.io.',
    }
  }
}
