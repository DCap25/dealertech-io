import Link from 'next/link'
import { notFound } from 'next/navigation'
import { and, eq } from 'drizzle-orm'
import { getDb, schema } from '@/db/client'
import { requireUser } from '@/lib/auth/session'
import { CaptureForm } from './capture-form'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Add coverage from a photo' }

export default async function ContractCapturePage({
  params,
}: {
  params: Promise<{ vehicleId: string }>
}) {
  const user = await requireUser()
  const { vehicleId } = await params

  const [vehicle] = await getDb()
    .select({
      id: schema.vehicles.id,
      vin: schema.vehicles.vin,
      make: schema.vehicles.make,
      model: schema.vehicles.model,
      modelYear: schema.vehicles.modelYear,
    })
    .from(schema.vehicles)
    .where(and(eq(schema.vehicles.id, vehicleId), eq(schema.vehicles.storeId, user.storeId)))
    .limit(1)

  if (!vehicle) notFound()

  const label = `${vehicle.modelYear} ${vehicle.make} ${vehicle.model ?? ''}`.trim()

  return (
    <main className="mx-auto max-w-2xl px-5 py-6 sm:px-6 sm:py-8">
      <Link
        href={`/vehicles/${vehicleId}`}
        className="touch-target inline-flex items-center text-sm text-neutral-500 hover:underline"
      >
        ← {label}
      </Link>

      <header className="mt-2 border-b border-[var(--border)] pb-5">
        <h1 className="text-3xl font-bold tracking-tight">Add coverage from a photo</h1>
        <p className="mt-1.5 leading-relaxed text-neutral-600 dark:text-neutral-400">
          Photograph a customer&rsquo;s service contract and the details are read off it for you to
          check. Once confirmed it sits on the prep sheet for every future visit, so nobody has to
          ask them again.
        </p>
      </header>

      <div className="mt-6">
        <CaptureForm vehicleId={vehicle.id} vehicleLabel={label} vin={vehicle.vin} />
      </div>
    </main>
  )
}
