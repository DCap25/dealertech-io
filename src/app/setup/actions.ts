'use server'

import { revalidatePath } from 'next/cache'
import { and, eq } from 'drizzle-orm'
import { schema } from '@/db/client'
import { withCurrentUserScope } from '@/db/scoped'
import { checkWork, requireUser } from '@/lib/auth/session'
import { canManageStaff } from '@/lib/team/roster'
import { isAcknowledgeable } from '@/lib/onboarding/steps'

/**
 * Confirming a setting whose default cannot be distinguished from neglect.
 *
 * Only the two steps marked ACKNOWLEDGED can be confirmed. Everything else on
 * the checklist is observed from live data, and offering a tick box for those
 * would let somebody mark the price book done while it is empty — which is the
 * exact lie the derived design exists to prevent.
 *
 * The guard is not decoration: `isAcknowledgeable` is checked against a value
 * arriving from a form, and a hand-edited request naming PRICE_BOOK would
 * otherwise write a row the loader reads back as completion.
 */

export interface SetupState {
  error?: string
  ok?: string
}

export async function acknowledgeStep(
  _previous: SetupState,
  formData: FormData,
): Promise<SetupState> {
  const user = await requireUser()
  if (!canManageStaff(user.role)) {
    return { error: 'Only a service manager or administrator can confirm these.' }
  }

  const stepKey = String(formData.get('stepKey') ?? '')
  if (!isAcknowledgeable(stepKey)) {
    return { error: 'That step is worked out from your data and cannot be ticked off.' }
  }

  // A tick box is a small write, but it is still a write, and onboarding
  // progress is the last thing a suspended account needs to be recording.
  const workable = await checkWork()
  if (!workable.allowed) return { error: workable.error }

  try {
    await withCurrentUserScope(async (db) => {
      const [existing] = await db
        .select({ id: schema.onboardingSteps.id })
        .from(schema.onboardingSteps)
        .where(and(
          eq(schema.onboardingSteps.storeId, user.storeId),
          eq(schema.onboardingSteps.stepKey, stepKey),
        ))
        .limit(1)

      if (existing) {
        await db.update(schema.onboardingSteps).set({
          status: 'DONE',
          completedAt: new Date(),
          completedByUserId: user.id,
          updatedAt: new Date(),
        }).where(eq(schema.onboardingSteps.id, existing.id))
      } else {
        await db.insert(schema.onboardingSteps).values({
          storeId: user.storeId,
          stepKey,
          status: 'DONE',
          completedAt: new Date(),
          completedByUserId: user.id,
        })
      }
    })
  } catch (cause) {
    const why = cause instanceof Error ? cause.message : String(cause)
    return { error: `Could not record that: ${why}` }
  }

  revalidatePath('/setup')
  return { ok: 'Confirmed.' }
}
