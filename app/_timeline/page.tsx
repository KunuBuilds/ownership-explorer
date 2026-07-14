// Parked, not deleted: the underscore prefix excludes this folder from routing.
// To bring the timeline back, rename to app/timeline and re-add the Nav link.
import { getGraphSnapshot } from '@/lib/data'
import TimelineClient from '@/components/TimelineClient'

export const metadata = {
  title: 'Acquisition Timeline — Ownership Explorer',
  description: 'A chronological view of corporate acquisitions across all tracked conglomerates.',
}

// Re-render at most hourly so new acquisitions surface without redeploying.
export const revalidate = 3600

export default async function TimelinePage() {
  const snapshot = await getGraphSnapshot()
  return <TimelineClient snapshot={snapshot} />
}
