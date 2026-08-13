import { DemoForm } from './demo-form'

export const metadata = {
  title: 'Coverage Engine',
  description: 'Paste a VIN and a concern. See who pays before you write the RO.',
}

export default function DemoPage() {
  return (
    <main className="mx-auto max-w-7xl px-6 py-10">
      <header className="mb-8 max-w-3xl">
        <p className="text-xs font-bold uppercase tracking-widest text-neutral-500">
          DealerTech.io · Coverage Arbitration Engine
        </p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight sm:text-4xl">
          Know who pays before you write the RO.
        </h1>
        <p className="mt-3 text-neutral-600 dark:text-neutral-400">
          A VIN and a customer concern are enough. The engine checks open recalls, prepaid
          maintenance, tire &amp; wheel, every factory warranty term, and any service contract on
          file — in that order — then tells you who pays, what the customer owes, and what you
          must do before starting work.
        </p>
      </header>

      <DemoForm />

      <footer className="mt-12 border-t border-neutral-200 pt-6 text-xs text-neutral-500 dark:border-neutral-800">
        <p>
          VIN decoding uses the free NHTSA vPIC service. Recall data comes from NHTSA by
          make/model/year — <strong>not by VIN</strong>, and without remedy status, so campaigns are
          shown as candidates to verify in the OEM portal rather than as confirmed open recalls.
        </p>
        <p className="mt-2">
          Factory warranty terms are reference data and vary by model and model year. DealerTech
          advises; the administrator or manufacturer adjudicates.
        </p>
      </footer>
    </main>
  )
}
