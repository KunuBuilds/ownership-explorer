import { getGraphSnapshot } from '@/lib/data'
import ExploreClient from '@/components/ExploreClient'

// This page fetches data at build time and passes it to the interactive client component
export default async function HomePage() {
  const snapshot = await getGraphSnapshot()
  return <ExploreClient snapshot={snapshot} />
}
