import { redirect } from 'next/navigation'

/**
 * The BDC worklist and the advisor follow-up list were the same list with two
 * names. This keeps existing links working and sends everyone to the one
 * surface, which now filters by owner instead.
 */
export default async function BdcPage({
  searchParams,
}: {
  searchParams: Promise<{ trigger?: string }>
}) {
  const { trigger } = await searchParams
  redirect(trigger ? `/follow-up?owner=BDC&trigger=${trigger}` : '/follow-up?owner=BDC')
}
