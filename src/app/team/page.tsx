import { headers } from 'next/headers'
import { and, desc, eq, isNull } from 'drizzle-orm'
import { getDb, schema } from '@/db/client'
import { requireUser, getCurrentStore } from '@/lib/auth/session'
import { WorkspaceNav } from '@/components/auth/workspace-nav'
import { INVITABLE_ROLES, inviteStatus } from '@/lib/invites/invite'
import { InviteForm } from './invite-form'
import { revokeInvite } from './actions'
import { notFound } from 'next/navigation'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Team' }

const roleLabel = (code: string) =>
  INVITABLE_ROLES.find((r) => r.code === code)?.label ?? code

function shortDate(d: Date): string {
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

export default async function TeamPage() {
  const user = await requireUser()
  const store = await getCurrentStore()
  if (!store) notFound()

  // The page is about adding and removing people. Showing it to an advisor
  // would be advertising a door they cannot open.
  const canManage = user.role === 'SERVICE_MANAGER' || user.role === 'ADMIN'
  if (!canManage) notFound()

  const db = getDb()
  const [staff, invitations] = await Promise.all([
    db.select({
      id: schema.users.id,
      name: schema.users.fullName,
      email: schema.users.email,
      role: schema.userStoreRoles.role,
      lastSeenAt: schema.users.lastSeenAt,
    })
      .from(schema.userStoreRoles)
      .innerJoin(schema.users, eq(schema.users.id, schema.userStoreRoles.userId))
      .where(and(
        eq(schema.userStoreRoles.storeId, store.id),
        eq(schema.userStoreRoles.isActive, true),
      )),
    db.select()
      .from(schema.storeInvitations)
      .where(and(
        eq(schema.storeInvitations.storeId, store.id),
        isNull(schema.storeInvitations.acceptedAt),
        isNull(schema.storeInvitations.revokedAt),
      ))
      .orderBy(desc(schema.storeInvitations.createdAt)),
  ])

  // Built here rather than guessed in the browser, so the copied link is
  // correct behind a proxy or on a custom domain.
  const host = (await headers()).get('host') ?? ''
  const protocol = host.startsWith('localhost') || host.startsWith('127.') ? 'http' : 'https'
  const origin = `${protocol}://${host}`

  const now = new Date()

  return (
    <main className="mx-auto max-w-4xl px-6 py-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs font-bold uppercase tracking-widest text-neutral-500">
          {store.name} · Team
        </p>
        <WorkspaceNav current="team" />
      </div>

      <h1 className="mt-3 text-3xl font-bold tracking-tight">Who works here</h1>
      <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
        Everyone with access to {store.name}&rsquo;s customers and vehicles.
      </p>

      <section className="mt-6 rounded-xl border border-neutral-200 p-4 dark:border-neutral-800">
        <h2 className="text-sm font-bold uppercase tracking-widest text-neutral-500">
          Invite someone
        </h2>
        <div className="mt-3">
          <InviteForm origin={origin} />
        </div>
      </section>

      {invitations.length > 0 && (
        <section className="mt-6">
          <h2 className="text-sm font-bold uppercase tracking-widest text-neutral-500">
            Waiting to be accepted ({invitations.length})
          </h2>
          <ul className="mt-2 divide-y divide-neutral-100 rounded-xl border border-neutral-200 dark:divide-neutral-800 dark:border-neutral-800">
            {invitations.map((i) => {
              const status = inviteStatus(i, now)
              return (
                <li key={i.id} className="flex flex-wrap items-center justify-between gap-3 p-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium">{i.email}</p>
                    <p className="text-xs text-neutral-500">
                      {roleLabel(i.role)} ·{' '}
                      {status === 'EXPIRED'
                        ? <span className="text-amber-700 dark:text-amber-400">expired {shortDate(i.expiresAt)}</span>
                        : `expires ${shortDate(i.expiresAt)}`}
                    </p>
                  </div>
                  <form action={revokeInvite}>
                    <input type="hidden" name="invitationId" value={i.id} />
                    <button
                      type="submit"
                      className="rounded-md border border-neutral-300 px-3 py-1.5 text-xs font-medium transition hover:border-rose-500 hover:text-rose-700 dark:border-neutral-700 dark:hover:border-rose-500 dark:hover:text-rose-400"
                    >
                      Revoke
                    </button>
                  </form>
                </li>
              )
            })}
          </ul>
        </section>
      )}

      <section className="mt-6">
        <h2 className="text-sm font-bold uppercase tracking-widest text-neutral-500">
          Staff ({staff.length})
        </h2>
        <ul className="mt-2 divide-y divide-neutral-100 rounded-xl border border-neutral-200 dark:divide-neutral-800 dark:border-neutral-800">
          {staff.map((s) => (
            <li key={s.id} className="flex flex-wrap items-center justify-between gap-3 p-3">
              <div className="min-w-0">
                <p className="text-sm font-medium">{s.name ?? s.email}</p>
                <p className="text-xs text-neutral-500">{s.email}</p>
              </div>
              <span className="rounded bg-neutral-100 px-2 py-1 text-xs font-medium dark:bg-neutral-900">
                {roleLabel(s.role)}
              </span>
            </li>
          ))}
        </ul>
      </section>
    </main>
  )
}
