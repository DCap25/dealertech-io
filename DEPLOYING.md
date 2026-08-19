# Deploying to Netlify

The repo side is done: `netlify.toml`, serverless-aware database pooling, and
server-side auth on every protected surface. What is left is account work —
connecting the repo and pasting environment variables — which has to happen in
your browser.

## 1. Create the project

In Netlify, **Add new project → Import an existing project → GitHub →
`DCap25/dealertech-io`**.

Netlify reads `netlify.toml`, so build command, publish directory and Node
version are already correct. It also detects Next.js and installs its own
adapter; do not add `@netlify/plugin-nextjs` by hand.

## 2. Environment variables

Set these on the production context. Everything except `DEMO_DAY_ISO` already
exists in your local `.env.local`.

| Variable | Where it comes from | Notes |
|---|---|---|
| `DATABASE_URL` | Supabase → Project Settings → Database → **Transaction pooler** | **Not** the direct connection. See below. |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase → Project Settings → API | Same value as local. |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Supabase → Project Settings → API | Publishable key. Safe in the browser. |
| `SUPABASE_SECRET_KEY` | Supabase → Project Settings → API | Secret. Server only — never prefix it `NEXT_PUBLIC_`. |
| `DMS_ADAPTER` | `mock` | |
| `DMS_MOCK_SCENARIO` | `AS_SEEDED` | |
| `ANTHROPIC_API_KEY` | optional | Leave unset and the Co-Pilot runs its mock provider. |
| `CRON_SECRET` | you generate it | Any long random string. Authenticates both scheduled jobs. **Without it they refuse every request and never run** — they fail closed on purpose. |
| `STRIPE_SECRET_KEY` | Stripe → the DealerTech account → API keys | A **restricted** key (`rk_...`), not the secret key. Leave unset and billing is off. See below. |
| `STRIPE_WEBHOOK_SECRET` | Stripe → Webhooks → your endpoint | Signing secret. **Without it the endpoint refuses every delivery** rather than trusting unverified JSON. |

### The morning price sync

`netlify/functions/pricing-sync.mts` runs at 11:00 UTC daily and POSTs to
`/api/cron/pricing`, which pulls each store's priced operations from the DMS and
brings the local book into line. Both it and `npm run pricing:sync` call the
same code, so the scheduled path is the one you can test by hand.

Two things to know about it:

- It **refuses** a pull that returns nothing, or that is missing more than a
  fifth of the operations on file. Both are what a half-finished or
  unauthenticated pull looks like, and the safe response is to leave yesterday's
  prices alone. A refusal is recorded in `pricing_sync_runs`, not swallowed.
- A price that moves by more than a factor of ten is **held back** rather than
  applied, because that is a units error rather than a price change. Everything
  else in the same batch still applies.

Generate the secret with something like `openssl rand -base64 32` and set the
same value on the site and, if you run the job by hand against production, in
your shell.

### Billing

DealerTech bills from **its own Stripe account** (`acct_1U57SyKD1OmZb0LX`),
separate from anything else under the same login. That separation is doing real
work: a Stripe webhook endpoint receives every event on its account, so a shared
account would mean two businesses' handlers each seeing the other's traffic.

Leave `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` unset and billing is
simply off — the app runs, tenants keep their lifecycle status, and every
Stripe path refuses rather than falling back. A billing integration that
quietly does nothing when misconfigured looks exactly like "nobody has paid
yet", which is the failure you find out about a month late.

Four steps, in order:

1. **Activate the account.** Business details, EIN, bank account, and set the
   statement descriptor to DEALERTECH. Until this is done Stripe accepts no
   live charge — the catalog and the code work regardless, so this only blocks
   the first real payment.

2. **Create a restricted key** at the account's API keys page and set it as
   `STRIPE_SECRET_KEY`. A restricted key (`rk_...`), not the secret key
   (`sk_...`): write on Customers, Subscriptions, Checkout Sessions and
   Billing Portal, read on Prices and Products, and nothing else. Nothing in
   this product issues refunds or reads balances.

3. **Create the webhook endpoint** pointing at
   `https://<your-domain>/api/webhooks/stripe`, subscribed to
   `checkout.session.completed`, `customer.subscription.created`,
   `customer.subscription.updated`, `customer.subscription.deleted`,
   `invoice.paid`, `invoice.payment_failed` and
   `invoice.marked_uncollectible`. Put its signing secret in
   `STRIPE_WEBHOOK_SECRET`. This has to happen after the first deploy, since
   Stripe verifies the URL is reachable.

4. **Check the catalog agrees with the code** with `npm run check:stripe`. The
   price list exists twice — as volume tiers on the Stripe price, and in
   `src/lib/billing/plans.ts` where the app quotes from — and they must match.
   A mismatch means showing a dealership one number and invoicing another,
   which is the exact failure this product exists to stop an advisor
   committing.

### Enabling ACH, which is a dashboard setting and not code

Dealer groups pay by bank transfer, not card. Turn on **ACH Direct Debit** in
the Stripe dashboard under payment methods, once, and every invoice from that
point offers it.

Nothing in this repository hardcodes a payment method — `payment_method_types`
is never passed on a Checkout session, a subscription or an invoice. That is
deliberate rather than an omission: Stripe then offers whatever the account has
enabled and adapts on its own, so enabling a method is a dashboard decision
rather than a deploy. Hardcoding `['card']` is the common shortcut and it locks
out exactly the method your buyers want.

A tenant is put on invoiced billing from the platform console — the tenant
page has the terms form. It converts an existing card subscription in place
rather than creating a second one, because two live subscriptions would bill
the dealership twice and the discovery would be an invoice landing at an
accounts payable department that already pays us.

### The nightly billing job

`netlify/functions/billing-reconcile.mts` runs at 09:00 UTC and POSTs to
`/api/cron/billing`, guarded by the same `CRON_SECRET`. `npm run billing:run`
calls the identical code.

It does two things nothing else does. It **runs the clocks** — a trial expiring
and a past-due account reaching the end of its fourteen days have no external
trigger, and Stripe never sends a webhook saying "this trial you never
converted has lapsed". And it **catches what webhooks lost**: a delivery Stripe
gave up retrying, an event our handler failed, a quantity somebody changed in
the dashboard directly.

It cannot suspend anybody. The lifecycle engine refuses that from any automatic
actor, so the worst an unattended run can do is move a tenant to RESTRICTED,
which leaves the drive working. Switching a dealership off stays a decision a
person makes, with a reason, from the console.

Scheduled two hours before the price sync deliberately: both walk every tenant
against a rate-limited API, and this one's output is what somebody reads with
their coffee.

### DATABASE_URL must be the transaction pooler

Your local value points at `db.<ref>.supabase.co:5432`, a direct connection.
That holds a real Postgres backend for the life of the socket, which is right
for one long-lived `next start` and wrong for functions, where every concurrent
invocation is its own instance. The project's connection limit is reached long
before its request limit is, and the symptom is intermittent
"remaining connection slots are reserved" rather than anything that looks like
load.

Use the **Transaction pooler** string (host `aws-0-<region>.pooler.supabase.com`,
port `6543`). `getDb()` detects it and switches to one connection per instance
with prepared statements disabled, which is what transaction pooling requires.
If you deploy with a direct URL anyway it will still run, and log a warning on
every cold start.

Keep the direct connection in `.env.local` — migrations and the seed want it.

## 3. Supabase redirect URLs

Supabase → Authentication → URL Configuration: add the Netlify URL to **Site
URL** and **Redirect URLs**. Sign-in sets a cookie on the domain that served
the request, so without this you will sign in and bounce straight back to the
login page.

## 4. Storage for uploaded documents

```bash
npm run storage:provision
```

Creates the private `customer-documents` bucket that uploaded service
agreements (PDF or image) are stored in. Idempotent — and it must be re-run
after upgrading to the upload flow: an existing bucket provisioned before
PDFs were accepted does not allow `application/pdf`, and the script now
updates the allowed types on a bucket that already exists.

Deliberately a setup step rather than something the upload path does on demand:
creating infrastructure from inside a request means every advisor uploading a
contract carries the permission to create buckets, and a first-run failure
surfaces to them as "could not store the document" instead of to whoever set
the project up.

The bucket stays private. Documents are read back through short-lived signed
URLs, so it never needs to be public — and a customer's contract carries their
name, VIN and often a signature.

## 5. After the first deploy

The database is already seeded and shared with local development, so there is
nothing to run. Sign in with any of the seeded accounts.

---

## Things to know before you share the URL

**The site is public.** Netlify sites are reachable by anyone who has the
address, and password protection is a paid feature. The workspace is behind a
session and the demo account list on the sign-in page is hidden outside
development — but the accounts still exist, and they all share one weak
password. Anyone who guesses `dealertech-demo` against `marcus@lonestarford.test`
is in. That is fine for looking at it on your phone. It is not fine for a URL
you post anywhere. Set `DEMO_PASSWORD` to something long, re-run
`npm run auth:provision -- --repair`, and keep the URL to yourself.

**RLS is still not the enforcement boundary.** The app connects with the
privileged `DATABASE_URL`, so tenant scoping is a code convention rather than
something the database enforces. With one seeded store nothing is exposed that
signing in would not show you anyway — but this has to close before any real
dealership data goes in, and a public URL makes it matter sooner.

**Next 16.3 on Netlify is not a verified combination.** Netlify's Next.js
integration is not built on the official Adapter API and is not verified by the
Next.js team; a verified adapter is in progress. Expect the possibility that
something works locally and not in production, and check the auth flow first
after any adapter update.

**Do not run the `middleware-to-proxy` codemod.** `next build` suggests
renaming `src/middleware.ts` to `proxy.ts`, and that rename is the correct
long-term move for Next 16. Netlify's adapter detects `middleware` and does not
yet handle `proxy` — the sibling Cloudflare adapter documents it as
unsupported. Renaming would silently stop the redirect-to-login from running in
production. Every protected page and server action calls `requireUser()` for
exactly this reason, so the failure would be a worse experience rather than an
open door, but the deprecated name stays until Netlify ships adapter support.
