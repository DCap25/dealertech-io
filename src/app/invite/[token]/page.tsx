import Link from 'next/link'
import { loadInvite } from '@/lib/invites/accept'
import { INVITABLE_ROLES, inviteStatusMessage } from '@/lib/invites/invite'
import { AcceptForm } from './accept-form'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Join your dealership' }

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-6 py-12">
      <Link
        href="/"
        className="text-xs font-bold uppercase tracking-[0.2em] text-neutral-500 transition hover:text-neutral-900 dark:hover:text-white"
      >
        DealerTech.io
      </Link>
      {children}
    </main>
  )
}

export default async function InvitePage({
  params,
}: {
  params: Promise<{ token: string }>
}) {
  const { token } = await params
  const invite = await loadInvite(token, new Date())

  /*
    An unknown token and a revoked one are told apart deliberately.

    Enumeration is not a real risk here — the token is 32 random bytes, so
    guessing one is not something anybody is going to do — and being vague
    would leave a genuine invitee unable to tell "your manager cancelled this"
    from "you mistyped the link", which are different problems with different
    fixes.
  */
  if (!invite) {
    return (
      <Shell>
        <h1 className="mt-2 text-2xl font-bold tracking-tight">This link is not valid</h1>
        <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-400">
          Check you copied the whole thing — invitation links are long and easy to truncate. If it
          still does not work, ask your service manager to send a new one.
        </p>
        <Link href="/login" className="mt-6 text-sm font-medium underline">
          Sign in instead
        </Link>
      </Shell>
    )
  }

  if (invite.status !== 'VALID') {
    return (
      <Shell>
        <h1 className="mt-2 text-2xl font-bold tracking-tight">
          {invite.status === 'ACCEPTED' ? 'Already used' : 'This invitation has lapsed'}
        </h1>
        <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-400">
          {inviteStatusMessage(invite.status)}
        </p>
        <Link href="/login" className="mt-6 text-sm font-medium underline">
          Sign in
        </Link>
      </Shell>
    )
  }

  const role = INVITABLE_ROLES.find((r) => r.code === invite.role)

  return (
    <Shell>
      <h1 className="mt-2 text-3xl font-bold tracking-tight">Join {invite.storeName}</h1>
      <p className="mt-1.5 text-sm text-neutral-600 dark:text-neutral-400">
        You have been invited as a{' '}
        <span className="font-semibold">{role?.label.toLowerCase() ?? invite.role}</span>.
        {role && <span className="block mt-0.5 text-neutral-500">{role.hint}</span>}
      </p>

      <AcceptForm token={token} email={invite.email} />

      <p className="mt-8 text-xs leading-relaxed text-neutral-500">
        By creating an account you get access to {invite.storeName}&rsquo;s customer and vehicle
        records. Those are the dealership&rsquo;s, not yours — treat them accordingly.
      </p>
    </Shell>
  )
}
