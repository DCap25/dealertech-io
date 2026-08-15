'use server'

import { revalidatePath } from 'next/cache'
import { cookies } from 'next/headers'
import { ACTIVE_STORE_COOKIE, requireUser } from '@/lib/auth/session'

/**
 * Switch which rooftop is being worked.
 *
 * The check that matters is here, not in the menu that called it. A server
 * action is a POST endpoint, so the store id arriving in the form is a claim,
 * not a fact — it is only honoured if the signed-in user already holds an
 * active role at that store. Refusing silently would be worse than refusing
 * loudly, so an unrecognised store leaves the cookie alone and the caller is
 * simply returned to a workspace still showing the rooftop they are entitled
 * to.
 */
export async function switchStore(formData: FormData): Promise<void> {
  const user = await requireUser()
  const storeId = String(formData.get('storeId') ?? '')

  if (!user.memberships.some((m) => m.storeId === storeId)) return

  const jar = await cookies()
  jar.set(ACTIVE_STORE_COOKIE, storeId, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    // A year. It is a workspace preference, not a credential — the membership
    // check above is what decides access on every single request.
    maxAge: 60 * 60 * 24 * 365,
  })

  // Every workspace surface is scoped to the store, so all of them are stale.
  revalidatePath('/', 'layout')
}
