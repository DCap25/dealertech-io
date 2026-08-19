import Link from 'next/link'
import { notFound } from 'next/navigation'
import { and, eq } from 'drizzle-orm'
import { schema } from '@/db/client'
import { withCurrentUserScope } from '@/db/scoped'
import { requireUser } from '@/lib/auth/session'
import { fenceSales } from '@/lib/auth/sales'
import { UploadForm } from './upload-form'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Upload a service agreement' }

export default async function ContractUploadPage({
  params,
}: {
  params: Promise<{ vehicleId: string }>
}) {
  const user = await requireUser()
  // A salesperson has one page and this is not it (DRIVE_PLAN §9 Q2).
  fenceSales(user.role)
  const { vehicleId } = await params

  const [vehicle] = await withCurrentUserScope((db) => db
    .select({
      id: schema.vehicles.id,
      vin: schema.vehicles.vin,
      make: schema.vehicles.make,
      model: schema.vehicles.model,
      modelYear: schema.vehicles.modelYear,
    })
    .from(schema.vehicles)
    .where(and(eq(schema.vehicles.id, vehicleId), eq(schema.vehicles.storeId, user.storeId)))
    .limit(1))

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
        <h1 className="text-3xl font-bold tracking-tight">Upload a service agreement</h1>
        <p className="mt-1.5 leading-relaxed text-neutral-600 dark:text-neutral-400">
          Upload the customer&rsquo;s contract — a PDF or a photo of one — and the details are read
          off it for you to check. Once confirmed it sits on the prep sheet for every future visit,
          so nobody has to ask them again.
        </p>
      </header>

      <div className="mt-6">
        <UploadForm vehicleId={vehicle.id} vehicleLabel={label} vin={vehicle.vin} />
      </div>
    </main>
  )
}
