import { getCurrentUser } from '@/lib/auth/session'
import { switchStore } from '@/app/store-actions'

/**
 * Which rooftop you are working, for people who work more than one.
 *
 * Renders nothing at all for the overwhelming majority of staff, who belong to
 * exactly one store — a dropdown with a single option is furniture that invites
 * a click and does nothing. It appears only when the account genuinely has
 * somewhere else to go.
 *
 * Submits on change rather than behind a Save button. The choice is reversible
 * in one more click and nothing is lost by it, so a confirmation step would be
 * ceremony.
 */
export async function StoreSwitcher() {
  const user = await getCurrentUser()
  if (!user || user.memberships.length < 2) return null

  return (
    <form action={switchStore} className="flex items-center gap-1.5">
      <label htmlFor="storeId" className="sr-only">
        Rooftop
      </label>
      <select
        id="storeId"
        name="storeId"
        defaultValue={user.storeId}
        className="rounded-md border border-neutral-300 bg-white px-2 py-1 text-xs font-medium outline-none focus:border-neutral-900 dark:border-neutral-700 dark:bg-neutral-950 dark:focus:border-neutral-300"
      >
        {user.memberships.map((m) => (
          <option key={m.storeId} value={m.storeId}>
            {m.storeName}
          </option>
        ))}
      </select>
      {/*
        A submit button rather than an onChange handler, so this stays a server
        component and keeps working with JavaScript disabled. Hidden visually
        once a selection changes is not worth the client bundle.
      */}
      <button
        type="submit"
        className="rounded-md border border-neutral-300 px-2 py-1 text-xs font-medium transition hover:border-neutral-900 dark:border-neutral-700 dark:hover:border-neutral-300"
      >
        Switch
      </button>
    </form>
  )
}
