'use client'

import { useMemo } from 'react'
import { money } from '@/components/present/service-menu'
import { buildDeviceSnapshot } from '@/lib/pairing/snapshot'
import type { MenuSelection } from '@/lib/menu/selection'
import type { PrepSheet } from '@/lib/prep-sheet'

/**
 * The menu, on paper.
 *
 * It exists because a drive with one broken tablet still has customers on it,
 * and "our system is down" is not a thing anyone wants to say while holding
 * someone's keys.
 *
 * ---------------------------------------------------------------------------
 * SAME DATA, DIFFERENT MARKUP
 * ---------------------------------------------------------------------------
 * This builds its rows from `buildDeviceSnapshot` — the same function that
 * feeds the tablet and the link — rather than from the sheet. Paper legitimately
 * needs different markup: a table with tick boxes and a signature line is not a
 * list of buttons. It does not need different *data*, and when it had its own
 * derivation it drifted: the screen learned to say "price to be confirmed"
 * before the printout did, so for a while the same visit could be quoted two
 * different ways depending on which one the customer walked out with.
 *
 * The only things taken from the sheet are the document's own metadata — VIN,
 * advisor, date — which are not part of what is being recommended.
 *
 * Hidden on screen entirely and revealed by `@media print`, which is also why
 * it is safe to render inside an overlay: nothing here competes for space.
 *
 * The customer marks a box by hand. That is the same commitment a tap on the
 * tablet makes — an indication of what they want, which the advisor then
 * confirms and authorises the way they always have.
 */
export function PrintableMenu({
  sheet,
  selection,
  printedAt,
}: {
  sheet: PrepSheet
  /** What the advisor chose to show. The same selection the tablet renders. */
  selection: MenuSelection
  printedAt: Date
}) {
  const snapshot = useMemo(() => buildDeviceSnapshot(sheet, selection), [sheet, selection])

  return (
    <div className="print-sheet hidden print:block">
      <header className="border-b-2 border-black pb-3">
        <div className="flex items-start justify-between gap-6">
          <div>
            <p className="text-[10pt] font-bold uppercase tracking-widest">Recommended service</p>
            <p className="mt-1 text-[16pt] font-bold leading-tight">{snapshot.vehicleLabel}</p>
            <p className="text-[10pt]">
              {snapshot.customerName} · {snapshot.mileage.toLocaleString()} miles
            </p>
          </div>
          <div className="text-right text-[9pt] leading-snug">
            <p>
              {printedAt.toLocaleDateString('en-US', {
                weekday: 'short',
                month: 'short',
                day: 'numeric',
                year: 'numeric',
              })}
            </p>
            {sheet.appointment?.advisorName && <p>Advisor: {sheet.appointment.advisorName}</p>}
            <p className="font-mono">VIN {sheet.vehicle.vin}</p>
          </div>
        </div>
      </header>

      {snapshot.coveredTotal > 0 && (
        <p className="mt-3 border border-black px-3 py-2 text-[11pt]">
          <strong>{money(snapshot.coveredTotal)}</strong> of the work below is paid for by coverage
          you already own.
        </p>
      )}

      {snapshot.tiers.map((group) => (
        <section key={group.tier} className="mt-5 break-inside-avoid">
          <h2 className="text-[12pt] font-bold">{group.title}</h2>
          <p className="text-[9pt] italic">{group.blurb}</p>

          <table className="mt-2 w-full border-collapse text-[10pt]">
            <thead>
              <tr className="border-b border-black">
                <th className="w-[46px] py-1 text-left font-bold">Yes</th>
                <th className="w-[46px] py-1 text-left font-bold">No</th>
                <th className="py-1 text-left font-bold">Service</th>
                <th className="w-[90px] py-1 text-right font-bold">Your cost</th>
              </tr>
            </thead>
            <tbody>
              {group.items.map((item) => {
                const savings = Math.max(0, item.fullAmount - item.customerOutOfPocket)
                return (
                  <tr key={item.id} className="break-inside-avoid border-b border-neutral-400">
                    {/* Marked by hand. Same weight as a tap on the tablet. */}
                    <td className="py-2 align-top">
                      <span className="inline-block h-4 w-4 border border-black" />
                    </td>
                    <td className="py-2 align-top">
                      <span className="inline-block h-4 w-4 border border-black" />
                    </td>
                    <td className="py-2 pr-3 align-top">
                      <p className="font-bold">{item.title}</p>
                      <p className="text-[9pt] leading-snug">{item.detail}</p>
                    </td>
                    {/*
                      A printed price is the hardest to walk back — the
                      customer keeps the paper. Where the dealership has no
                      price on file, it says so rather than printing ours.
                    */}
                    <td className="py-2 text-right align-top tabular-nums">
                      {item.priceConfirmed === false ? (
                        <p className="font-bold">Price to be confirmed</p>
                      ) : (
                        <>
                          <p className="font-bold">
                            {item.customerOutOfPocket === 0
                              ? 'No charge'
                              : money(item.customerOutOfPocket)}
                          </p>
                          {savings > 0 && (
                            <p className="text-[9pt]">
                              <span className="line-through">{money(item.fullAmount)}</span> before
                              coverage
                            </p>
                          )}
                        </>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </section>
      ))}

      <div className="mt-5 break-inside-avoid border-t-2 border-black pt-3">
        <div className="flex items-baseline justify-between text-[12pt]">
          <span className="font-bold">Everything recommended</span>
          <span className="font-bold tabular-nums">{money(snapshot.customerTotal)}</span>
        </div>
      </div>

      <p className="mt-4 text-[8.5pt] leading-relaxed">
        Ticking a box tells your advisor what you would like done. They will confirm the work and
        the final price with you before anything starts. Coverage shown is based on the products on
        file for this vehicle and is confirmed with the administrator or manufacturer before work
        begins. Prices are estimates until parts are confirmed.
      </p>

      <div className="mt-8 flex gap-10 break-inside-avoid">
        <div className="flex-1 border-t border-black pt-1 text-[9pt]">Customer</div>
        <div className="w-[160px] border-t border-black pt-1 text-[9pt]">Date</div>
      </div>
    </div>
  )
}
