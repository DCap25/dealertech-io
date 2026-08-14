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

## 4. After the first deploy

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
