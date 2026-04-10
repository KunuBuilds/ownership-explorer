import { getGraphSnapshot, getAllCategories } from '@/lib/data'
import CategoriesClient from '@/components/CategoriesClient'

export const metadata = {
  title: 'Categories — Ownership Explorer',
  description: 'Browse brands and subsidiaries by sector, category, and subcategory.',
}

// Required for static export — tells Next.js which slug combinations to pre-render
export async function generateStaticParams() {
  const categories = await getAllCategories()
  
  // Generate a page for each category ID, plus the base /categories route
  return [
    { slug: [] },  // /categories
    ...categories.map(c => ({ slug: [c.id] }))  // /categories/food, /categories/food-meat, etc.
  ]
}

export default async function CategoriesPage() {
  const snapshot = await getGraphSnapshot()
  return <CategoriesClient snapshot={snapshot} />
}