import type { ReactNode } from 'react'
import { AccountBanner } from './account-banner'
import { PoweredBy } from './site-footer'
import { AppHelpLauncher } from '@/components/copilot/app-help-launcher'

/**
 * Inside the product. Wraps a whole section of the workspace.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS A LAYOUT AND NOT A COMPONENT PER PAGE
 * ---------------------------------------------------------------------------
 * "Every page" has to survive the next page somebody adds. A component pasted
 * into sixteen files is one that will be missing from the seventeenth, and
 * nobody notices a footer that is not there — or, now, a help button. A layout
 * per section covers every route beneath it, including ones that do not exist
 * yet.
 *
 * Three things belong to the workspace and to nothing else: the footer line
 * that says the dealership's software is theirs, the account notice when
 * billing needs attention, and the Co-Pilot's floating launcher.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS ITS OWN FILE
 * ---------------------------------------------------------------------------
 * It used to sit beside `CustomerFrame` in site-footer.tsx, which was fine
 * while everything in there was a server component. `AppHelpLauncher` is not:
 * it is a client component, and a client component reachable from a module is
 * reachable from every route that imports that module. Sharing a file with
 * `CustomerFrame` would have put the staff chat box's JavaScript into the
 * bundle for `/present` and `/m/[token]` — never rendered, but shipped to a
 * customer's phone, and one careless edit away from being rendered.
 *
 * Separate files, so the separation is structural rather than a matter of
 * nobody making that edit. The footer helpers stay where they are and are
 * imported from here.
 */
export function AppFrame({ children }: { children: ReactNode }) {
  return (
    <>
      <AccountBanner />
      {children}
      <PoweredBy />
      <AppHelpLauncher />
    </>
  )
}
