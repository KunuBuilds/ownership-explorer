import { Suspense } from 'react'
import { getGraphSnapshot, getAllCategories } from '@/lib/data'
import CategoriesClient from '@/components/CategoriesClient'

export const metadata = {
  title: 'Categories — Ownership Explorer',
  description: 'Browse brands and subsidiaries by sector, category, and subcategory.',
}

// Re-render at most hourly so newly-categorized entities surface without redeploying.
export const revalidate = 3600

export async function generateStaticParams() {
  const categories = await getAllCategories()
  return [
    { slug: [] },
    ...categories.map(c => ({ slug: [c.id] }))
  ]
}

export default async function CategoriesPage() {
  const snapshot = await getGraphSnapshot()
  return (
    <Suspense fallback={<div style={{ padding: 40, color: 'var(--muted)' }}>Loading...</div>}>
      <CategoriesClient snapshot={snapshot} />
    </Suspense>
  )
}