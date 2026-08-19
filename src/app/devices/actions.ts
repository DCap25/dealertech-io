'use server'

import { revalidatePath } from 'next/cache'
import { checkWork, requireUser } from '@/lib/auth/session'
import { isWellFormedCode } from '@/lib/pairing/codes'
import { claimDevice, revokeDevice } from '@/lib/pairing/store'

export interface PairState {
  status: 'IDLE' | 'PAIRED' | 'ERROR'
  message?: string
}

export async function pairDevice(_previous: PairState, formData: FormData): Promise<PairState> {
  const user = await requireUser()

  const code = String(formData.get('code') ?? '')
  const name = String(formData.get('name') ?? '').trim()

  if (!isWellFormedCode(code)) {
    return { status: 'ERROR', message: 'That is not a six-character pairing code.' }
  }
  if (!name) {
    return { status: 'ERROR', message: 'Give the tablet a name — "Lane 3", "Waiting room".' }
  }

  // Claiming a tablet writes a device row and mints its bearer token. A
  // suspended account gains no new surfaces.
  const workable = await checkWork()
  if (!workable.allowed) return { status: 'ERROR', message: workable.error }

  const result = await claimDevice({
    code,
    name,
    storeId: user.storeId,
    userId: user.id,
    now: new Date(),
  })

  if (!result.ok) return { status: 'ERROR', message: result.reason }

  revalidatePath('/devices')
  return { status: 'PAIRED', message: `${name} is paired and ready.` }
}

/*
  Deliberately NOT gated on `checkWork`, unlike `pairDevice` above.

  This revokes a tablet's bearer token, and revocation must never be something
  a dealership can lose. A tablet walks out of the building with a live token
  on it; if the only way to kill that token were to settle an invoice first, a
  billing state would have become a security incident. Taking access away is
  always allowed. Handing it out is what stops.
*/
export async function unpairDevice(_previous: PairState, formData: FormData): Promise<PairState> {
  const user = await requireUser()
  const deviceId = String(formData.get('deviceId') ?? '')
  if (!deviceId) return { status: 'ERROR', message: 'No device.' }

  await revokeDevice(user.storeId, deviceId)
  revalidatePath('/devices')
  return { status: 'IDLE', message: 'Tablet unpaired. Its token no longer works.' }
}
