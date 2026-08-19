'use client'

import { useState } from 'react'
import { usePathname } from 'next/navigation'
import { showsHelpLauncher } from '@/lib/copilot/mode'
import { CopilotPanel } from './copilot-panel'

/**
 * The Co-Pilot, reachable from anywhere in the workspace.
 *
 * ---------------------------------------------------------------------------
 * WHY IT IS MOUNTED IN A LAYOUT AND NOT ON THE PAGES
 * ---------------------------------------------------------------------------
 * It lives in `AppFrame` (`components/ui/app-frame.tsx`) for exactly the
 * reason the footer and the account banner do: "every page in the workspace"
 * has to survive the next page somebody adds, and a component pasted into
 * twenty files will be missing from the twenty-first. A layer per section
 * covers every route beneath it, including the ones that do not exist yet.
 *
 * It also gets the hard rule for free. `AppFrame` wraps the workspace;
 * `CustomerFrame` (in site-footer.tsx, a separate module for this reason)
 * wraps `/present` and `/m/[token]`. A customer holding a tablet or opening a
 * menu link never renders this component and never receives its JavaScript —
 * the same separation that keeps the dealership's billing state off their
 * screen.
 *
 * ---------------------------------------------------------------------------
 * WHERE IT STANDS DOWN
 * ---------------------------------------------------------------------------
 * `showsHelpLauncher` decides, and it is pure and tested. The prep sheet is the
 * interesting case: that screen mounts its own Co-Pilot launcher above its
 * sticky action bar, and two floating buttons in one corner is worse than
 * either. The visit panel there answers app-help questions too, so nothing is
 * lost by yielding the corner on that one path.
 */
export function AppHelpLauncher() {
  const pathname = usePathname()
  const [open, setOpen] = useState(false)

  if (!showsHelpLauncher(pathname ?? '')) return null

  return (
    <>
      {!open && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Ask the Co-Pilot how DealerTech works"
          /*
            Same treatment as the prep sheet's launcher, one notch quieter and
            one notch lower — this one sits in the corner of every page, and a
            button that shouts on a screen somebody is reading all day stops
            being helpful. Established classes only: see the note in
            PROJECT_OVERVIEW about `bg-{colour}-800` and stale stylesheets.
          */
          className="fixed bottom-4 right-4 z-30 flex h-12 items-center gap-2 rounded-full bg-neutral-900 px-4 text-sm font-bold text-white shadow-lg transition active:scale-95 hover:bg-neutral-700 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-200 print:hidden"
        >
          <span aria-hidden>✦</span>
          Help
          <kbd className="hidden rounded bg-white/20 px-1.5 py-0.5 text-[10px] font-medium sm:inline dark:bg-black/10">
            ⌘K
          </kbd>
        </button>
      )}
      {/* No appointment id — the panel answers from the product guide and the
          signed-in role, and is given no customer to be wrong about. */}
      <CopilotPanel open={open} onOpenChange={setOpen} />
    </>
  )
}
