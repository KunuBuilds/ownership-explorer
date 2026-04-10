import { Suspense } from 'react'
import { getGraphSnapshot } from '@/lib/data'
import ExploreClient from '@/components/ExploreClient'

export default async function HomePage() {
  const snapshot = await getGraphSnapshot()
  return (
    <Suspense fallback={<div style={{ padding: 40, color: 'var(--muted)' }}>Loading...</div>}>
      <ExploreClient snapshot={snapshot} />
    </Suspense>
  )
}