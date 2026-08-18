import { WorkspaceNav } from '@/components/auth/workspace-nav'
import { Card } from '@/components/ui/primitives'
import { requireUser } from '@/lib/auth/session'
import { fenceSales } from '@/lib/auth/sales'
import { listDevices } from '@/lib/pairing/store'
import { PairForm, UnpairButton } from './pair-form'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Tablets' }

function seenLabel(at: Date | null): string {
  if (!at) return 'never seen'
  const minutes = Math.round((Date.now() - at.getTime()) / 60_000)
  if (minutes < 2) return 'online now'
  if (minutes < 60) return `last seen ${minutes} min ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `last seen ${hours}h ago`
  return `last seen ${Math.round(hours / 24)}d ago`
}

export default async function DevicesPage() {
  const user = await requireUser()
  // A salesperson has one page and this is not it (DRIVE_PLAN §9 Q2).
  fenceSales(user.role)
  const devices = await listDevices(user.storeId)

  return (
    <main className="mx-auto max-w-3xl px-5 py-6 sm:px-6 sm:py-8">
      <header className="border-b border-[var(--border)] pb-5">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <div>
            <p className="text-xs font-bold uppercase tracking-widest text-neutral-500">
              {user.storeName}
            </p>
            <h1 className="mt-1 text-3xl font-bold tracking-tight">Tablets</h1>
          </div>
          <WorkspaceNav />
        </div>
        <p className="mt-2 leading-relaxed text-neutral-600 dark:text-neutral-400">
          Customer-facing tablets you can send a menu to. Open{' '}
          <code className="rounded bg-[var(--surface-muted)] px-1.5 py-0.5 font-mono text-sm">
            /present
          </code>{' '}
          on the device once and pair it with the code it shows.
        </p>
      </header>

      <section className="mt-6">
        <h2 className="text-xs font-bold uppercase tracking-[0.15em] text-neutral-500">
          Pair a tablet
        </h2>
        <Card className="mt-3 p-5">
          <PairForm />
        </Card>
      </section>

      <section className="mt-8 pb-10">
        <h2 className="text-xs font-bold uppercase tracking-[0.15em] text-neutral-500">
          Paired ({devices.length})
        </h2>

        {devices.length === 0 ? (
          <p className="mt-3 rounded-2xl border border-dashed border-[var(--border)] p-8 text-center text-sm text-neutral-500">
            No tablets paired yet.
          </p>
        ) : (
          <Card className="mt-3 divide-y divide-[var(--border)]">
            {devices.map((d) => (
              <div key={d.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3.5">
                <div className="min-w-0">
                  <p className="font-bold">{d.name}</p>
                  <p className="mt-0.5 text-xs text-neutral-500">{seenLabel(d.lastSeenAt)}</p>
                </div>
                <UnpairButton deviceId={d.id} name={d.name ?? 'this tablet'} />
              </div>
            ))}
          </Card>
        )}

        {/*
          Said plainly, because the question "what happens if one walks out of
          the building" is the first one a manager asks.
        */}
        <p className="mt-4 text-xs leading-relaxed text-neutral-500">
          A tablet can only display a menu an advisor sends it and record what the customer taps. It
          cannot search customers, open other visits, or see anything about the store — so a lost
          tablet is worth one customer&rsquo;s menu, not a dealership. Unpairing kills its access
          immediately.
        </p>
      </section>
    </main>
  )
}
