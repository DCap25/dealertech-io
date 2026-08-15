'use server'

import { revalidatePath } from 'next/cache'
import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { getDb, schema } from '@/db/client'
import { requirePlatformAdmin } from '@/lib/auth/session'
import { createStore } from '@/lib/invites/provision'
import { createInvitation } from '@/lib/invites/create'
import { normaliseEmail } from '@/lib/invites/invite'
import { knownMakes } from '@/lib/warranty'

export interface ProvisionState {
  error?: string
  /** Shown once. Only the hash is stored, so there is nothing to recover. */
  link?: string
  dealershipName?: string
  invitedEmail?: string
}

/**
 * Turn a lead into a dealership.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS DOES NOT CREATE AN ACCOUNT
 * ---------------------------------------------------------------------------
 * The sales-led path deliberately stops at an invitation. Whoever signs the
 * contract is rarely the person who will sit at the keyboard, and creating an
 * account means choosing a password on somebody's behalf and then transmitting
 * it — which is the one thing a system holding a dealership's customer records
 * should never do. They get a link, they choose their own password, and the
 * account is theirs from the first second.
 *
 * The writes here run privileged rather than under the caller's row-level
 * security, because creating an organisation is not something any policy grants
 * — there is no tenant to belong to yet. `requirePlatformAdmin()` is therefore
 * doing the whole job of authorising this, which is why it is the first line.
 */
export async function provisionFromLead(
  _previous: ProvisionState,
  formData: FormData,
): Promise<ProvisionState> {
  const admin = await requirePlatformAdmin()

  const leadId = String(formData.get('leadId') ?? '')
  const dealershipName = String(formData.get('dealershipName') ?? '').trim()
  const franchiseMake = String(formData.get('franchiseMake') ?? '').trim().toUpperCase()
  const state = String(formData.get('state') ?? '').trim().toUpperCase()
  const laborRate = Number(formData.get('laborRate') ?? 0)
  const adminEmail = normaliseEmail(String(formData.get('adminEmail') ?? ''))

  if (!dealershipName) return { error: 'Enter the dealership name.' }
  if (!adminEmail.includes('@')) return { error: 'Enter the email to invite.' }
  if (!Number.isFinite(laborRate) || laborRate <= 0) {
    return { error: 'Enter their door rate — every estimate is priced from it.' }
  }
  if (state && state.length !== 2) return { error: 'Use the two-letter state code.' }
  if (franchiseMake && !knownMakes().includes(franchiseMake)) {
    // A brand the warranty engine does not know would produce a dealership
    // whose every coverage answer is "no reference data" — a broken-looking
    // product rather than a missing program.
    return { error: 'Pick a franchise brand the warranty engine knows, or leave it blank.' }
  }

  const db = getDb()

  try {
    const { storeId } = await createStore(
      { dealershipName, franchiseMake: franchiseMake || null, state: state || null, laborRate },
      randomUUID().slice(0, 8),
    )

    /*
      ADMIN, not SERVICE_MANAGER.

      They are the first person in an empty dealership and need to be able to
      invite everybody else. Every account after this one comes through an
      invitation with an explicitly chosen role.
    */
    const { token } = await createInvitation({
      storeId,
      email: adminEmail,
      role: 'ADMIN',
      invitedByUserId: admin.id,
    })

    if (leadId) {
      // Marked here rather than as a separate click, so a provisioned lead
      // cannot sit in the "not contacted" count looking like work to do.
      await db.update(schema.demoRequests)
        .set({ contacted: true, contactedAt: new Date() })
        .where(eq(schema.demoRequests.id, leadId))
    }

    revalidatePath('/admin')
    return { link: `/invite/${token}`, dealershipName, invitedEmail: adminEmail }
  } catch (cause) {
    const why = cause instanceof Error ? cause.message : String(cause)
    return { error: `Could not create the dealership: ${why}` }
  }
}
