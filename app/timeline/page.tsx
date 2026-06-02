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
