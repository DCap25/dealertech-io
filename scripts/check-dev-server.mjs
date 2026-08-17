#!/usr/bin/env node
/**
 * Refuse to build while a dev server is running against this project.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS PREVENTS
 * ---------------------------------------------------------------------------
 * `next build` and `next dev` both own `.next`, and the build wins. Running a
 * build while the dev server is up rewrites the directory underneath it, and
 * the dev server carries on serving from what it had — so the browser gets a
 * stylesheet frozen at whatever the build happened to leave behind.
 *
 * The symptom is the worst kind: the page still loads, and a class you just
 * added silently has no effect. PROJECT_OVERVIEW.md §6 records two separate
 * occasions where that was investigated as a Tailwind bug — once for classes
 * "never reaching the stylesheet", once for `sr-only` "rendering visibly".
 * Neither was Tailwind. Both cost somebody an afternoon, and nothing anywhere
 * pointed at the build that caused it.
 *
 * So the check is here rather than in a doc, because by the time you are
 * reading the doc you are already debugging the wrong thing.
 *
 * ---------------------------------------------------------------------------
 * WHY THE LOCK FILE AND NOT THE PORT
 * ---------------------------------------------------------------------------
 * Checking whether something is listening on 3000 is the obvious version and
 * it is wrong in both directions: a dev server bumped to 3001 because 3000 was
 * taken would sail past, and any unrelated project holding 3000 would block a
 * build that was perfectly safe.
 *
 * `.next/dev/lock` is Next's own record — it is how `next dev` recognises a
 * second instance of itself — and it is scoped to this directory rather than
 * to a port. Reading what the tool already tracks beats inferring it.
 *
 * ---------------------------------------------------------------------------
 * IT FAILS OPEN, EVERY TIME, ON PURPOSE
 * ---------------------------------------------------------------------------
 * Netlify runs `npm run build`, which runs this. A guard that wrongly refuses
 * is a guard that breaks deploys, and a broken deploy is far more expensive
 * than the stale stylesheet this exists to prevent. So every uncertainty —
 * no lock, unreadable lock, a shape it does not recognise, a process that is
 * gone — resolves to "carry on building". It only refuses when it is certain,
 * and even then `ALLOW_BUILD_WITH_DEV_SERVER=1` overrides it.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/*
  CI has no dev server by construction, and this is the one place a false
  positive costs a deploy. Checked before anything else so no later line can
  reach a conclusion on a build machine at all.
*/
if (process.env.CI || process.env.NETLIFY) process.exit(0)

if (process.env.ALLOW_BUILD_WITH_DEV_SERVER) {
  console.warn(
    '[build] ALLOW_BUILD_WITH_DEV_SERVER is set — skipping the dev-server check.\n'
    + '        If a dev server is running, restart it and delete .next afterwards.',
  )
  process.exit(0)
}

let lock
try {
  lock = JSON.parse(readFileSync(join(process.cwd(), '.next', 'dev', 'lock'), 'utf8'))
} catch {
  // No lock, no .next, or not JSON. Nothing to be certain about.
  process.exit(0)
}

const pid = Number(lock?.pid)
if (!Number.isInteger(pid) || pid <= 0) process.exit(0)

/*
  A lock file outlives a dev server that was killed rather than stopped, so
  the pid has to be checked. Signal 0 tests for existence without delivering
  anything; EPERM means the process is there but owned by somebody else, which
  still counts as running.

  Pids get recycled, so this can in principle be wrong about an unrelated
  process that inherited the number. That is what the override is for.
*/
let running = false
try {
  process.kill(pid, 0)
  running = true
} catch (error) {
  running = error?.code === 'EPERM'
}

if (!running) process.exit(0)

const where = lock?.appUrl ?? (lock?.port ? `http://localhost:${lock.port}` : 'this project')

console.error(`
  Refusing to build: a dev server is running (pid ${pid}, ${where}).

  A build would rewrite .next underneath it. The dev server keeps serving what
  it already had, so newly-added Tailwind classes silently stop appearing —
  which reads as a Tailwind bug and is not one. See PROJECT_OVERVIEW.md §6.

  Stop it, then build:

      taskkill /PID ${pid} /F      (Windows)
      kill ${pid}                  (macOS / Linux)

  If you have already built over a running dev server, the fix is to stop it,
  delete .next, and start it again — a stale stylesheet does not recover on
  its own.

  To build anyway: ALLOW_BUILD_WITH_DEV_SERVER=1 npm run build
`)
process.exit(1)
