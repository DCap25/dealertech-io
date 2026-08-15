import 'server-only'
import { sql } from 'drizzle-orm'
import { getDb } from './client'

/**
 * Running a request's queries as the user, so row-level security applies.
 *
 * ---------------------------------------------------------------------------
 * WHY THE POLICIES WERE DORMANT
 * ---------------------------------------------------------------------------
 * There are 48 policies across 44 tables, every table is FORCE ROW LEVEL
 * SECURITY, and none of it did anything. The application connects as `postgres`,
 * and that role carries the BYPASSRLS attribute — which outranks FORCE, so
 * every policy was skipped on every query. The isolation boundary was the
 * `WHERE store_id = ?` in each query, exactly the thing RLS exists to survive.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS DOES
 * ---------------------------------------------------------------------------
 * Opens a transaction and, inside it, becomes the `authenticated` role and
 * presents the user's id as a JWT claim. `authenticated` has no BYPASSRLS, so
 * the policies evaluate, and `auth.uid()` resolves from the claim — which is
 * what every policy is written against. `SET LOCAL` scopes both to the
 * transaction, so the connection returns to the pool unchanged.
 *
 * ---------------------------------------------------------------------------
 * THE COST, STATED PLAINLY
 * ---------------------------------------------------------------------------
 * One transaction means one connection, and a connection runs one statement at
 * a time. A page that fires eight queries with Promise.all will now run them in
 * sequence. That is the price of the guarantee and it is worth paying on
 * anything touching customer data — but it is a real change, not a free one,
 * and it is why this is a deliberate seam rather than something applied by
 * magic to every query in the codebase.
 */

/**
 * The role the policies are written for.
 *
 * Supabase creates it, grants it table privileges through default privileges,
 * and — critically — does not give it BYPASSRLS.
 */
const SCOPED_ROLE = 'authenticated'

type ScopedDb = Parameters<Parameters<ReturnType<typeof getDb>['transaction']>[0]>[0]

/**
 * Run a unit of work as a specific user.
 *
 * Everything inside must use the `tx` handed to the callback. Reaching for
 * `getDb()` in there quietly escapes back to the privileged connection, which
 * is the one mistake this whole file exists to prevent.
 */
export async function withUserScope<T>(
  userId: string,
  work: (tx: ScopedDb) => Promise<T>,
): Promise<T> {
  const db = getDb()

  return db.transaction(async (tx) => {
    /*
      Order matters. The claim is set while still `postgres`, because
      `set_config` on `request.jwt.claims` is not something the `authenticated`
      role is granted to do on some Supabase projects. Becoming the role last
      also means a failure to set the claim cannot leave a transaction running
      as an under-privileged role with no identity — it fails outright instead.
    */
    await tx.execute(sql`
      SELECT set_config(
        'request.jwt.claims',
        json_build_object('sub', ${userId}::text, 'role', ${SCOPED_ROLE}::text)::text,
        true
      )
    `)
    await tx.execute(sql.raw(`SET LOCAL ROLE ${SCOPED_ROLE}`))

    return work(tx)
  })
}

/**
 * The same, for a request with no signed-in user.
 *
 * Presents no subject at all, so `auth.uid()` is null and every store-scoped
 * policy matches nothing. Useful for proving a surface really is closed rather
 * than assuming it: if a query returns rows under this, it is not protected by
 * RLS.
 */
export async function withAnonymousScope<T>(
  work: (tx: ScopedDb) => Promise<T>,
): Promise<T> {
  const db = getDb()
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('request.jwt.claims', NULL, true)`)
    await tx.execute(sql.raw(`SET LOCAL ROLE ${SCOPED_ROLE}`))
    return work(tx)
  })
}
