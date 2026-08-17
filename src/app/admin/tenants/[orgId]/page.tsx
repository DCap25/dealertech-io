import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requirePlatformAdmin } from '@/lib/auth/session'
import { loadTenantDetail } from '@/lib/platform/load'
import { resolveAccess } from '@/lib/billing/access'
import { LifecycleBadge, ago } from '../../ui'
import { CancellationControls, LifecycleActions, SupportAccess } from './actions-ui'
import { QuantityForm } from './quantity-form'
import { InvoiceRailForm } from './invoice-rail-form'
import { StripeLink } from '../../stripe-links'
import { changeHistory } from '@/lib/billing/subscription-ops'

export const dynamic = 'force-dynamic'

/**
 * The wall clock, hoisted out of the component.
 *
 * A request-scoped input like the session, not part of rendering. Taken once
 * and threaded down so the "since" on the header and the timestamps in the
 * history cannot disagree about what "now" means.
 */
const nowMs = () => Date.now()

export async function generateMetadata({ params }: { params: Promise<{ orgId: string }> }) {
  const { orgId } = await params
  const detail = await loadTenantDetail(orgId)
  return { title: detail?.org.name ?? 'Tenant' }
}

/**
 * One dealer group, in full.
 *
 * ---------------------------------------------------------------------------
 * WHAT IS NOT ON THIS PAGE
 * ---------------------------------------------------------------------------
 * A customer. A vehicle. A repair order. Not because they are filtered out
 * further down, but because the loader never asks for them and the policies
 * would refuse if it did (migration 0016). The console is the operational
 * view; reaching a dealership's data is a separate, visible act with a row
 * behind it — which is the block at the bottom of this page.
 */
export default async function TenantPage({ params }: { params: Promise<{ orgId: string }> }) {
  await requirePlatformAdmin()
  const { orgId } = await params
  const detail = await loadTenantDetail(orgId)
  // Covers a bad uuid and a caller RLS returned nothing to, identically. The
  // console does not announce itself to people who should not be here.
  if (!detail) notFound()

  const now = nowMs()
  const { org, stores, staff, history, onboarding, billing, subscription } = detail

  /*
    Shown as the dealership experiences it, not as a status string.

    The same engine the workspace runs on, so what this page claims and what an
    advisor actually sees cannot drift apart. A console that says "restricted"
    while the dealership is working fine is worse than no console.
  */
  const access = resolveAccess({
    status: org.lifecycleStatus,
    statusChangedAt: org.lifecycleChangedAt,
    trialEndsAt: org.trialEndsAt,
    // The same instant as everything else on the page.
    asOf: new Date(now),
  })

  const supportGrants = staff.filter((s) => s.expiresAt !== null)

  // Privileged, like everything else in the console's write path: a platform
  // admin holds no role at the dealership whose subscription this describes.
  const changes = subscription ? await changeHistory(org.id) : []

  return (
    <main className="mx-auto max-w-5xl px-6 py-8">
      <Link href="/admin/tenants" className="text-sm text-neutral-500 hover:underline">
        ← Dealerships
      </Link>

      <header className="mt-3 flex flex-wrap items-start justify-between gap-4 border-b border-neutral-200 pb-5 dark:border-neutral-800">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{org.name}</h1>
          <p className="mt-1 text-sm text-neutral-500">
            {stores.length} rooftop{stores.length === 1 ? '' : 's'} · signed up{' '}
            {org.createdAt.toISOString().slice(0, 10)}
          </p>
        </div>
        <div className="text-right">
          <LifecycleBadge status={org.lifecycleStatus} />
          <p className="mt-1 text-xs text-neutral-500">since {ago(org.lifecycleChangedAt, now)}</p>
        </div>
      </header>

      {/* What the dealership sees right now, quoted rather than described. */}
      <section className="mt-6 rounded-xl border border-neutral-200 p-4 dark:border-neutral-800">
        <h2 className="text-xs font-bold uppercase tracking-widest text-neutral-500">
          What they experience
        </h2>
        <p className="mt-2 text-sm">
          <span className="font-semibold">{access.level}</span>
          {access.canWork
            ? ' — the drive, prep sheets and customer menus all work.'
            : ' — the workspace is read-only.'}
        </p>
        {access.blockedActions.length > 0 && (
          <p className="mt-1 text-xs text-neutral-500">
            Blocked: {access.blockedActions.join(', ').toLowerCase().replace(/_/g, ' ')}
          </p>
        )}
        {access.banner && (
          <p className="mt-2 rounded-lg bg-neutral-100 px-3 py-2 text-xs italic dark:bg-neutral-900">
            {access.banner.audience === 'MANAGERS' ? 'Managers see' : 'Everyone sees'}:
            &ldquo;{access.banner.message}&rdquo;
          </p>
        )}
        {access.needsAttention && (
          <p className="mt-2 text-xs font-semibold text-rose-700 dark:text-rose-400">
            {access.needsAttention}
          </p>
        )}
      </section>

      <Section title="Commercial">
        <dl className="grid gap-3 p-4 text-sm sm:grid-cols-2">
          <Field label="Trial ends">
            {org.trialEndsAt ? org.trialEndsAt.toISOString().slice(0, 10) : '—'}
          </Field>
          <Field label="Plan">{subscription?.planKey ?? 'none'}</Field>
          <Field label="Subscription">
            {subscription ? `${subscription.status} · ${subscription.rooftopQuantity} rooftops` : 'none'}
            {/*
              Said on the field itself, not only in the block further down.

              Somebody scanning this page for the commercial state reads these
              four lines and stops. A group who has given notice reading as a
              plain "ACTIVE · 3 rooftops" here is the exact failure the
              cancellation work exists to close, and repeating it costs a
              clause.
            */}
            {subscription?.cancelAtPeriodEnd && (
              <span className="ml-2 rounded bg-rose-100 px-1.5 py-0.5 text-xs font-semibold text-rose-800 dark:bg-rose-950 dark:text-rose-200">
                ends {subscription.currentPeriodEnd?.toISOString().slice(0, 10) ?? 'this period'}
              </span>
            )}
          </Field>
          <Field label="Billing">
            {billing ? `${billing.collectionMode} · ${billing.billingEmail}` : 'no billing account'}
            {billing?.netTermsDays ? ` · net ${billing.netTermsDays}` : ''}
            {billing?.poNumber ? ` · PO ${billing.poNumber}` : ''}
          </Field>

          {/*
            Out to Stripe rather than a re-rendered copy of it. Invoices,
            payment state and dunning history are already built there for every
            edge case we would otherwise reimplement and keep in sync.
          */}
          {(billing?.stripeCustomerId || subscription?.stripeSubscriptionId) && (
            <div className="sm:col-span-2">
              <dt className="text-xs font-bold uppercase tracking-wide text-neutral-500">
                In Stripe
              </dt>
              <dd className="mt-0.5 flex flex-wrap gap-4 text-sm">
                {billing?.stripeCustomerId && (
                  <>
                    <StripeLink path={`customers/${billing.stripeCustomerId}`}>
                      Customer
                    </StripeLink>
                    <StripeLink path={`invoices?customer=${billing.stripeCustomerId}`}>
                      Invoices
                    </StripeLink>
                  </>
                )}
                {subscription?.stripeSubscriptionId && (
                  <StripeLink path={`subscriptions/${subscription.stripeSubscriptionId}`}>
                    Subscription
                  </StripeLink>
                )}
              </dd>
            </div>
          )}
          {subscription && subscription.rooftopQuantity !== stores.filter((s) => s.isActive).length && (
            <div className="sm:col-span-2">
              {/*
                The quantity invariant from the plan, surfaced rather than
                auto-corrected. A rooftop added without a quantity bump and a
                rooftop deactivated mid-dispute look identical to a repair
                routine and are completely different conversations.
              */}
              <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs font-medium text-amber-900 dark:bg-amber-950 dark:text-amber-200">
                Billing for {subscription.rooftopQuantity} rooftops, {stores.filter((s) => s.isActive).length} are active.
              </p>
            </div>
          )}

          <div className="sm:col-span-2">
            <InvoiceRailForm
              organizationId={org.id}
              currentMode={billing?.collectionMode ?? null}
              defaultEmail={billing?.billingEmail ?? ''}
              defaultRooftops={stores.filter((s) => s.isActive).length || 1}
            />
          </div>

          {subscription && (
            <div className="sm:col-span-2">
              <QuantityForm
                organizationId={org.id}
                currentQuantity={subscription.rooftopQuantity}
                activeStores={stores.filter((s) => s.isActive).length}
                periodStart={null}
                periodEnd={subscription.currentPeriodEnd?.toISOString() ?? null}
              />
            </div>
          )}

          {/*
            Only where there is a subscription to end. A comped or
            never-converted tenant has nothing in Stripe to schedule against,
            and the engine refuses them — offering a button that can only
            refuse is how a console teaches people to distrust its buttons.
          */}
          {subscription && subscription.status !== 'COMPED' && (
            <div className="sm:col-span-2">
              <CancellationControls
                organizationId={org.id}
                scheduled={subscription.cancelAtPeriodEnd}
                effectiveAt={subscription.currentPeriodEnd?.toISOString() ?? null}
              />
            </div>
          )}
        </dl>
      </Section>

      {changes.length > 0 && (
        <Section title="Commercial history">
          {/*
            Distinct from the lifecycle history above. That one records the
            state a tenant moved to; this records what was done to the
            arrangement itself — and it is what answers "why was February
            different" when the person who changed it has left.
          */}
          <ul className="divide-y divide-neutral-100 dark:divide-neutral-800">
            {changes.map((c) => (
              <li key={c.id} className="p-3">
                <p className="text-sm">
                  <span className="font-semibold">{c.kind.toLowerCase().replace('_', ' ')}</span>
                  <span className="ml-2 text-xs text-neutral-500">
                    {c.actorName ?? 'system'} · {ago(c.createdAt, now)}
                  </span>
                </p>
                {c.reason && (
                  <p className="mt-0.5 text-xs italic text-neutral-600 dark:text-neutral-400">
                    {c.reason}
                  </p>
                )}
              </li>
            ))}
          </ul>
        </Section>
      )}

      {/*
        Activation, deliberately next to the commercial state rather than on a
        screen of its own. "Paying and never activated" is the row worth a
        phone call, and it is invisible if the two numbers live apart.
      */}
      <Section title="Activation">
        <ul className="divide-y divide-neutral-100 dark:divide-neutral-800">
          {onboarding.map((o) => (
            <li key={o.storeId} className="flex flex-wrap items-center justify-between gap-3 p-3">
              <div className="min-w-0">
                <p className="text-sm font-medium">{o.storeName}</p>
                <p className="text-xs text-neutral-500">
                  {o.progress.doneCount} of {o.progress.totalCount} setup steps
                  {o.progress.outstandingEssential.length > 0 && (
                    <> · missing {o.progress.outstandingEssential.map((s) => s.label.toLowerCase()).join(', ')}</>
                  )}
                </p>
              </div>
              <div className="flex items-center gap-3 text-xs">
                {o.progress.daysToFirstMenu !== null ? (
                  <span className="rounded bg-emerald-100 px-1.5 py-0.5 font-semibold text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200">
                    first menu in {o.progress.daysToFirstMenu}d
                  </span>
                ) : (
                  <span className="rounded bg-amber-100 px-1.5 py-0.5 font-semibold text-amber-900 dark:bg-amber-950 dark:text-amber-200">
                    never presented
                  </span>
                )}
                {o.progress.readyForTheDrive && (
                  <span className="text-neutral-500">ready</span>
                )}
              </div>
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Lifecycle history">
        {history.length === 0 ? (
          <p className="p-4 text-sm text-neutral-500">No transitions recorded.</p>
        ) : (
          <ul className="divide-y divide-neutral-100 dark:divide-neutral-800">
            {history.map((h) => (
              <li key={h.id} className="p-3">
                <p className="text-sm">
                  <span className="text-neutral-500">{h.fromStatus ?? '—'}</span>
                  {' → '}
                  <span className="font-semibold">{h.toStatus}</span>
                  <span className="ml-2 text-xs text-neutral-500">
                    {h.actor === 'PLATFORM_ADMIN' ? (h.actorName ?? 'DealerTech') : h.actor.toLowerCase()}
                    {' · '}
                    {ago(h.createdAt, now)}
                  </span>
                </p>
                {h.reason && (
                  <p className="mt-0.5 text-xs italic text-neutral-600 dark:text-neutral-400">
                    {h.reason}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Actions">
        <LifecycleActions organizationId={org.id} status={org.lifecycleStatus} />
      </Section>

      <Section title={`Rooftops (${stores.length})`}>
        <ul className="divide-y divide-neutral-100 dark:divide-neutral-800">
          {stores.map((s) => (
            <li key={s.id} className="flex flex-wrap items-center justify-between gap-3 p-3">
              <div>
                <p className="text-sm font-medium">
                  {s.name}
                  {!s.isActive && (
                    <span className="ml-2 rounded bg-neutral-200 px-1.5 py-0.5 text-xs dark:bg-neutral-800">
                      inactive
                    </span>
                  )}
                </p>
                <p className="text-xs text-neutral-500">
                  {[s.franchiseMake ?? 'multi-brand', s.state, `$${Number(s.laborRate).toFixed(0)}/hr`]
                    .filter(Boolean).join(' · ')}
                </p>
              </div>
              <span className="text-xs text-neutral-500">
                {staff.filter((m) => m.storeId === s.id).length} staff
              </span>
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Support access">
        <SupportAccess
          organizationId={org.id}
          stores={stores.filter((s) => s.isActive).map((s) => ({ id: s.id, name: s.name }))}
          grants={supportGrants.map((g) => ({
            roleId: g.roleId,
            name: g.name ?? g.email,
            storeId: g.storeId,
            expiresAt: g.expiresAt!.toISOString(),
          }))}
        />
      </Section>
    </main>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-bold uppercase tracking-wide text-neutral-500">{label}</dt>
      <dd className="mt-0.5">{children}</dd>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-8">
      <h2 className="text-sm font-bold uppercase tracking-widest text-neutral-500">{title}</h2>
      <div className="mt-2 rounded-xl border border-neutral-200 dark:border-neutral-800">
        {children}
      </div>
    </section>
  )
}
