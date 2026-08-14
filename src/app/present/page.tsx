import { Tablet } from './tablet'

export const dynamic = 'force-dynamic'

export const metadata = {
  title: 'Service menu',
  // A device in a customer's hands is not something a search engine should
  // ever have a URL for.
  robots: { index: false, follow: false },
}

/**
 * The customer tablet.
 *
 * Open this on the device once and leave it. It enrols itself, shows a pairing
 * code for an advisor to claim, and from then on displays whatever is pushed
 * to it — and nothing when nothing is.
 */
export default function PresentPage() {
  return <Tablet />
}
