import { getGraphSnapshot } from '@/lib/data'
import TimelineClient from '@/components/TimelineClient'

export const metadata = {
  title: 'Acquisition Timeline — Ownership Explorer',
  description: 'A chronological view of corporate acquisitions across all tracked conglomerates.',
}

export default async function TimelinePage() {
  const snapshot = await getGraphSnapshot()
  return <TimelineClient snapshot={snapshot} />
}
