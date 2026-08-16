import { notFound } from 'next/navigation'
import { desc, eq } from 'drizzle-orm'
import { schema } from '@/db/client'
import { withCurrentUserScope } from '@/db/scoped'
import { requireUser } from '@/lib/auth/session'
import { canManageStaff } from '@/lib/team/roster'
import { WorkspaceNav } from '@/components/auth/workspace-nav'
import { ImportWizard } from './import-wizard'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Import history' }

const nowMs = () => Date.now()

function ago(d: Date | null, now: number): string {
  if (!d) return ''
  const hours = Math.floor((now - d.getTime()) / 3_600_000)
  if (hours < 1) return 'just now'
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

/**
 * Bringing a dealership's history with them.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS PAGE IS THE DIFFERENCE BETWEEN A PILOT AND A DEMO
 * ---------------------------------------------------------------------------
 * The opportunity engine reasons almost entirely from history. A store that
 * signs up today and imports nothing gets prep sheets reading "no record on
 * file" against most lines — the engines degrade honestly, which was
 * deliberate, but honest-and-empty is not what anyone renews.
 *
 * Managers only, like the rest of the administrative surface. An advisor has
 * no reason to be here and a bulk write is not something to leave lying about.
 */
export default async function ImportPage() {
  const user = await requireUser()
  // notFound rather than a message, matching /team: a page an advisor cannot
  // use should not advertise itself to them.
  if (!canManageStaff(user.role)) notFound()

  const now = nowMs()

  const batches = await withCurrentUserScope((db) => db
    .select({
      id: schema.importBatches.id,
      fileName: schema.importBatches.fileName,
      status: schema.importBatches.status,
      totalRows: schema.importBatches.totalRows,
      processedRows: schema.importBatches.processedRows,
      failedRows: schema.importBatches.failedRows,
      createdAt: schema.importBatches.createdAt,
    })
    .from(schema.importBatches)
    .where(eq(schema.importBatches.storeId, user.storeId))
    .orderBy(desc(schema.importBatches.createdAt))
    .limit(8))

  return (
    <main className="mx-auto max-w-3xl px-6 py-8">
      <div className="flex justify-end">
        <WorkspaceNav />
      </div>

      <h1 className="mt-3 text-3xl font-bold tracking-tight">Import your history</h1>
      <p className="mt-2 max-w-2xl text-sm text-neutral-600 dark:text-neutral-400">
        Prep sheets are built from what a vehicle has already been through. Bringing your
        declined work across is what makes the first morning worth having — every job your
        store quoted and never followed up becomes a ranked opportunity, re-priced at
        today&rsquo;s rates.
      </p>

      <ImportWizard />

      {batches.length > 0 && (
        <section className="mt-10">
          <h2 className="text-sm font-bold uppercase tracking-widest text-neutral-500">
            Earlier imports
          </h2>
          <ul className="mt-2 divide-y divide-neutral-100 rounded-xl border border-neutral-200 dark:divide-neutral-800 dark:border-neutral-800">
            {batches.map((b) => (
              <li key={b.id} className="flex flex-wrap items-center justify-between gap-3 p-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{b.fileName}</p>
                  <p className="text-xs text-neutral-500">
                    {b.processedRows.toLocaleString()} imported
                    {b.failedRows > 0 && ` · ${b.failedRows.toLocaleString()} skipped`}
                    {' · '}
                    {ago(b.createdAt, now)}
                  </p>
                </div>
                <span
                  className={`rounded px-1.5 py-0.5 text-xs font-semibold ${
                    b.status === 'SUCCESS'
                      ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200'
                      : b.status === 'PARTIAL'
                        ? 'bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200'
                        : 'bg-neutral-200 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300'
                  }`}
                >
                  {b.status.toLowerCase()}
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-neutral-500">
            Importing the same file twice is safe — rows already here are recognised and
            left alone.
          </p>
        </section>
      )}
    </main>
  )
}
