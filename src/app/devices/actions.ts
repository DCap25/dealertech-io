'use server'

import { revalidatePath } from 'next/cache'
import { requireUser } from '@/lib/auth/session'
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

export async function unpairDevice(_previous: PairState, formData: FormData): Promise<PairState> {
  const user = await requireUser()
  const deviceId = String(formData.get('deviceId') ?? '')
  if (!deviceId) return { status: 'ERROR', message: 'No device.' }

  await revokeDevice(user.storeId, deviceId)
  revalidatePath('/devices')
  return { status: 'IDLE', message: 'Tablet unpaired. Its token no longer works.' }
}
