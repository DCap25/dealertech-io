import Link from 'next/link'
import { MarketingFooter } from './site-footer'
import { formatUpdated, type LegalDocument } from '@/lib/site/legal'

/**
 * The shell every trust and legal page renders inside.
 *
 * ---------------------------------------------------------------------------
 * WHY A SHELL RATHER THAN NINE PAGES THAT EACH BUILD THEIR OWN
 * ---------------------------------------------------------------------------
 * These nine pages are read in sequence by exactly one kind of visitor — a
 * fixed-ops director's IT contact working through a vendor questionnaire — and
 * the fastest way to fail that read is for the pages to look like they were
 * written by different people at different times. A shell makes drift
 * impossible: the header, the measure, the "last updated" line and the footer
 * are one file, so a page cannot quietly forget the footer or invent its own
 * type scale.
 *
 * It also means the disclaimer that these are drafts appears on every legal
 * document without nine chances to leave it off.
 *
 * ---------------------------------------------------------------------------
 * WHY `.mkt` AND A NARROW MEASURE
 * ---------------------------------------------------------------------------
 * `.mkt` in globals.css carries the marketing palette and its own dark-mode
 * block, so these pages theme with the rest of the public site rather than the
 * workspace. The homepage runs to `max-w-6xl` because it is a layout; this is
 * prose, and prose past about 70 characters a line stops being read.
 */

/* --------------------------------------------------------------- chrome */

function TrustHeader() {
  return (
    <header className="sticky top-0 z-50 border-b border-[var(--rule)] bg-[var(--paper)]/85 backdrop-blur-md">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-5 py-3.5 sm:px-6">
        <Link href="/" className="text-[15px] font-bold tracking-tight">
          DealerTech<span className="text-[var(--signal)]">.io</span>
        </Link>
        <nav className="flex items-center gap-4 text-sm">
          <Link
            href="/legal"
            className="hidden text-[var(--ink-soft)] transition hover:text-[var(--ink)] sm:block"
          >
            Legal
          </Link>
          <Link
            href="/security"
            className="hidden text-[var(--ink-soft)] transition hover:text-[var(--ink)] sm:block"
          >
            Security
          </Link>
          <Link
            href="/"
            className="text-[var(--ink-soft)] transition hover:text-[var(--ink)]"
          >
            ← Back to the site
          </Link>
        </nav>
      </div>
    </header>
  )
}

/* ------------------------------------------------------------ typography */

/** A section heading. Sized down from the homepage's — this is a document. */
export function H2({ id, children }: { id?: string; children: React.ReactNode }) {
  return (
    <h2
      id={id}
      className="mt-12 scroll-mt-20 border-t border-[var(--rule)] pt-8 text-xl font-bold tracking-tight sm:text-2xl"
    >
      {children}
    </h2>
  )
}

export function H3({ children }: { children: React.ReactNode }) {
  return <h3 className="mt-7 text-base font-bold">{children}</h3>
}

export function P({ children }: { children: React.ReactNode }) {
  return <p className="mt-4 leading-relaxed text-[var(--ink-soft)]">{children}</p>
}

export function UL({ children }: { children: React.ReactNode }) {
  return (
    <ul className="mt-4 space-y-2.5 pl-5 leading-relaxed text-[var(--ink-soft)] [&>li]:list-disc">
      {children}
    </ul>
  )
}

/** A term and what it means — the shape most of these documents want. */
export function Term({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mt-5 border-l-2 border-[var(--rule)] pl-4">
      <p className="text-sm font-bold text-[var(--ink)]">{label}</p>
      <p className="mt-1.5 text-sm leading-relaxed text-[var(--ink-soft)]">{children}</p>
    </div>
  )
}

/**
 * The plain-language box at the top of a document.
 *
 * Not a substitute for the text below it and it says so where it is used. It
 * exists because the alternative — a policy nobody finishes — protects nobody.
 */
export function Summary({ children }: { children: React.ReactNode }) {
  return (
    <div className="mt-8 rounded-2xl border border-[var(--rule)] bg-[var(--paper-tint)] p-5 sm:p-6">
      <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-[var(--signal)]">
        The short version
      </p>
      <div className="mt-3 space-y-3 text-sm leading-relaxed text-[var(--ink-soft)]">
        {children}
      </div>
    </div>
  )
}

/** Something we want a reader to notice, usually a limit on what we claim. */
export function Callout({ children }: { children: React.ReactNode }) {
  return (
    <div className="mt-6 rounded-xl border border-[var(--rule)] bg-[var(--paper-tint)] p-4 text-sm leading-relaxed text-[var(--ink-soft)]">
      {children}
    </div>
  )
}

/* ----------------------------------------------------------------- page */

export function TrustPage({
  eyebrow,
  title,
  lede,
  /**
   * Which document's date to print, when this page is one of the documents.
   * The non-legal pages (`/status`, `/press`, the `/legal` index) pass nothing
   * — a date on a page nobody is going to hold us to is noise.
   */
  updated,
  children,
}: {
  eyebrow: string
  title: string
  lede?: React.ReactNode
  updated?: LegalDocument
  children: React.ReactNode
}) {
  return (
    <div className="mkt flex min-h-full flex-col bg-[var(--paper)] text-[var(--ink)]">
      <TrustHeader />
      <main className="mx-auto w-full max-w-3xl px-5 py-12 sm:px-6 sm:py-16">
        <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-[var(--signal)]">
          {eyebrow}
        </p>
        <h1 className="mt-4 text-3xl font-bold leading-[1.12] tracking-tight sm:text-[2.5rem]">
          {title}
        </h1>
        {lede && (
          <p className="mt-4 text-base leading-relaxed text-[var(--ink-soft)] sm:text-lg">{lede}</p>
        )}
        {updated && (
          <p className="mt-6 font-mono text-xs uppercase tracking-widest text-[var(--ink-soft)]">
            Last updated {formatUpdated(updated)}
          </p>
        )}
        {children}
      </main>
      <MarketingFooter />
    </div>
  )
}

/**
 * The line every legal document ends on.
 *
 * These drafts were written by the people who wrote the code, from the code.
 * That makes them accurate about what the software does and no substitute for
 * a lawyer, and saying so is cheaper than being caught not having said it.
 */
export function DraftNotice() {
  return (
    <p className="mt-12 border-t border-[var(--rule)] pt-6 text-xs leading-relaxed text-[var(--ink-soft)] opacity-80">
      This document was written from the software it describes, and has not been reviewed by
      counsel. It is the honest starting text, not legal advice. If a term here matters to your
      dealership&rsquo;s decision, tell us and we will get it right rather than argue it later.
    </p>
  )
}
