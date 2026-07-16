import { Suspense } from 'react'
import { getGraphSnapshot } from '@/lib/data'
import ExploreClient from '@/components/ExploreClient'

export const metadata = {
  title:       'Browse companies — Ownership Explorer',
  description: 'Browse parent companies and explore their full ownership trees.',
}

// Re-render at most hourly so newly-added entities surface in search/explore
// without redeploying. (Default static rendering would cache this forever.)
export const revalidate = 3600

export default async function BrowsePage() {
  const snapshot = await getGraphSnapshot()

  return (
    <Suspense fallback={<div style={{ padding: 40, color: 'var(--muted)' }}>Loading...</div>}>
      <ExploreClient snapshot={snapshot} />
    </Suspense>
  )
}
