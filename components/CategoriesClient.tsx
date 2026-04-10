'use client'
import { useState, useMemo, useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import type { GraphSnapshot } from '@/lib/data'
import { buildEntityMap, buildCategoryTree, descendantCategoryIds, type CategoryTree } from '@/lib/graph'
import type { Entity, Ownership } from '@/lib/supabase'
import styles from './CategoriesClient.module.css'

interface Props { snapshot: GraphSnapshot }

// entity_categories isn't in GraphSnapshot — we'd fetch it separately in a real app.
// For now we include it inline as a prop-compatible structure by extending the snapshot type.
// In production: add `entityCategories: Record<string, string[]>` to GraphSnapshot.

// Hardcoded category assignments matching the seed data
// In production this comes from the entity_categories table via getGraphSnapshot()
const ENTITY_CATEGORIES: Record<string, string[]> = {
  'lunchables':    ['food-kids-lunch'],
  'oscar-mayer':   ['food-meat-deli'],
  'bologna':       ['food-meat-deli'],
  'heinz':         ['food-condiments-ketchup'],
  'heinz-ketchup': ['food-condiments-ketchup'],
  'coca-cola':     ['food-bev-soda'],
  'coke-zero':     ['food-bev-soda'],
  'tag-heuer':     ['luxury-watches-swiss'],
  'carrera':       ['luxury-watches-lines'],
  'bvlgari':       ['luxury-watches-italian'],
  'bvlgari-octo':  ['luxury-watches-lines'],
  'dior':          ['luxury-fashion-couture'],
  'dior-beauty':   ['luxury-fashion-beauty'],
  'hermes':        ['luxury-leather-heritage'],
  'cottonelle':    ['pc-tissue-toilet'],
  'kleenex':       ['pc-tissue-facial'],
  'huggies':       ['pc-baby-nappies'],
  'geico':         ['ins-auto-personal'],
}

export default function CategoriesClient({ snapshot }: Props) {
  const { entities, ownership, categories } = snapshot
  const entityMap  = useMemo(() => buildEntityMap(entities), [entities])
  const catTree    = useMemo(() => buildCategoryTree(categories), [categories])

  const [activeL1,  setActiveL1]  = useState<string | null>(null)
  const [activeL2,  setActiveL2]  = useState<string | null>(null)
  const [activeL3,  setActiveL3]  = useState<string | null>(null)
  const [catSearch, setCatSearch] = useState('')
  const router = useRouter()

  const catMap = useMemo(() =>
    new Map(categories.map(c => [c.id, c])),
    [categories]
  )
	const searchParams = useSearchParams()

	useEffect(() => {
	  const cat = searchParams.get('cat')
	  if (!cat || !catMap.size) return
	  const found = catMap.get(cat)
	  if (!found) return
	  if (found.level === 1) { setActiveL1(cat); setActiveL2(null); setActiveL3(null) }
	  else if (found.level === 2) {
		setActiveL1(found.parent_id)
		setActiveL2(cat)
		setActiveL3(null)
	  } else {
		const l2 = catMap.get(found.parent_id ?? '')
		setActiveL1(l2?.parent_id ?? null)
		setActiveL2(found.parent_id ?? null)
		setActiveL3(cat)
	  }
	}, [searchParams, catMap])



  function entitiesInCat(catId: string): Entity[] {
    const descIds = descendantCategoryIds(catId, categories)
    return entities.filter(e =>
      ENTITY_CATEGORIES[e.id]?.some(cid => descIds.includes(cid))
    )
  }

  function selectCat(l1: string | null, l2: string | null, l3: string | null) {
    if (l1 !== null) { setActiveL1(prev => prev === l1 && !l2 && !l3 ? null : l1); setActiveL2(null); setActiveL3(null) }
    if (l2 !== null) { setActiveL2(prev => prev === l2 && !l3 ? null : l2); setActiveL3(null) }
    if (l3 !== null) { setActiveL3(prev => prev === l3 ? null : l3) }
  }

  const activeCatId = activeL3 || activeL2 || activeL1
  const activeCat   = activeCatId ? catMap.get(activeCatId) : null
  const brandList   = activeCatId ? entitiesInCat(activeCatId) : []

  // Breadcrumb chain
  function breadcrumb() {
    const parts: { id: string; name: string }[] = []
    if (activeL1) { const c = catMap.get(activeL1); if (c) parts.push({ id: c.id, name: c.name }) }
    if (activeL2) { const c = catMap.get(activeL2); if (c) parts.push({ id: c.id, name: c.name }) }
    if (activeL3) { const c = catMap.get(activeL3); if (c) parts.push({ id: c.id, name: c.name }) }
    return parts
  }

  // Subcategory pills for current level
  function subPills() {
    if (!activeCatId) return []
    const cat = catMap.get(activeCatId)
    if (!cat) return []
    if (cat.level === 3) return []
    return categories.filter(c => c.parent_id === activeCatId)
  }

  const pills = subPills()

  return (
    <div className={styles.layout}>
      {/* Sidebar */}
      <aside className={styles.sidebar}>
        <div className={styles.sidebarHeader}>
          <div className="sidebar-label">Browse by Category</div>
          <input
            className="search-box"
            type="text"
            placeholder="Filter categories..."
            value={catSearch}
            onChange={e => setCatSearch(e.target.value)}
          />
        </div>

        <div className={styles.catTree}>
          {catTree.map(l1node => {
            const l1 = l1node.category
            if (catSearch && !l1.name.toLowerCase().includes(catSearch.toLowerCase()) &&
                !l1node.children.some(l2 =>
                  l2.category.name.toLowerCase().includes(catSearch.toLowerCase()) ||
                  l2.children.some(l3 => l3.category.name.toLowerCase().includes(catSearch.toLowerCase()))
                )) return null

            const isOpenL1 = activeL1 === l1.id
            const l1count  = entitiesInCat(l1.id).length

            return (
              <div key={l1.id} className={styles.l1}>
                <div
                  className={`${styles.l1Header} ${isOpenL1 ? styles.l1Active : ''}`}
                  onClick={() => selectCat(l1.id, null, null)}
                >
                  <div className={styles.l1Icon}>{l1.icon || '◈'}</div>
                  <div className={styles.l1Name}>{l1.name}</div>
                  <div className={styles.l1Count}>{l1count}</div>
                  <div className={`${styles.chevron} ${isOpenL1 ? styles.chevronOpen : ''}`}>›</div>
                </div>

                {isOpenL1 && (
                  <div>
                    {l1node.children.map(l2node => {
                      const l2 = l2node.category
                      const isOpenL2 = activeL2 === l2.id
                      const l2count  = entitiesInCat(l2.id).length

                      return (
                        <div key={l2.id}>
                          <div
                            className={`${styles.l2Header} ${isOpenL2 ? styles.l2Active : ''}`}
                            onClick={() => selectCat(null, l2.id, null)}
                          >
                            <div className={styles.l2Name}>{l2.name}</div>
                            <div className={styles.l2Count}>{l2count}</div>
                            {l2node.children.length > 0 && (
                              <div className={`${styles.chevron} ${styles.chevronSm} ${isOpenL2 ? styles.chevronOpen : ''}`}>›</div>
                            )}
                          </div>

                          {isOpenL2 && l2node.children.map(l3node => {
                            const l3 = l3node.category
                            const l3count = entitiesInCat(l3.id).length
                            return (
                              <div
                                key={l3.id}
                                className={`${styles.l3Row} ${activeL3 === l3.id ? styles.l3Active : ''}`}
                                onClick={() => selectCat(null, null, l3.id)}
                              >
                                <div className={styles.l3Dot} />
                                <div className={styles.l3Name}>{l3.name}</div>
                                <div className={styles.l3Count}>{l3count}</div>
                              </div>
                            )
                          })}
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </aside>

      {/* Main panel */}
      <div className={styles.main}>
        {!activeCat ? (
          <div className="empty-state">
            <div className="icon">◈</div>
            <p>Select a category to browse brands</p>
          </div>
        ) : (
          <>
            <div className={styles.mainHeader}>
              <div className={styles.breadcrumb}>
                {breadcrumb().map((b, i) => (
                  <span key={b.id} className={styles.breadcrumbWrap}>
                    {i > 0 && <span className={styles.breadcrumbSep}>›</span>}
                    <span
                      className={`${styles.breadcrumbItem} ${i === breadcrumb().length - 1 ? styles.breadcrumbCurrent : ''}`}
                      onClick={() => {
                        if (i === 0) selectCat(b.id, null, null)
                        else if (i === 1) selectCat(null, b.id, null)
                      }}
                    >
                      {b.name}
                    </span>
                  </span>
                ))}
              </div>

              <div className={styles.mainTitle}>
                {activeL1 && catMap.get(activeL1)?.icon && (
                  <span className={styles.mainIcon}>{catMap.get(activeL1)?.icon}</span>
                )}
                {activeCat.name}
              </div>

              {activeCat.description && (
                <div className={styles.mainDesc}>{activeCat.description}</div>
              )}
            </div>

            {/* Sub-pills */}
            {pills.length > 0 && (
              <div className={styles.pills}>
                {pills.map(p => (
                  <div
                    key={p.id}
                    className={`${styles.pill} ${(activeL2 === p.id || activeL3 === p.id) ? styles.pillActive : ''}`}
                    onClick={() => {
                      if (p.level === 2) selectCat(null, p.id, null)
                      else selectCat(null, null, p.id)
                    }}
                  >
                    {p.name} <span className={styles.pillCount}>({entitiesInCat(p.id).length})</span>
                  </div>
                ))}
              </div>
            )}

            {/* Brand cards */}
            <div className={styles.brandsHeader}>
              <div className={styles.brandsTitle}>Brands</div>
              <div className={styles.brandsCount}>{brandList.length} result{brandList.length !== 1 ? 's' : ''}</div>
            </div>

            <div className={styles.brandsGrid}>
              {brandList.length === 0
                ? <div className={styles.noResults}>No brands in this subcategory yet</div>
                : brandList.map(entity => {
                    const edge   = ownership.find(o => o.child_id === entity.id)
                    const owner  = edge ? entityMap.get(edge.parent_id) : null
                    const catIds = ENTITY_CATEGORIES[entity.id] ?? []
                    const leafCat = catIds.length ? catMap.get(catIds[0]) : null
                    const l2cat  = leafCat?.parent_id ? catMap.get(leafCat.parent_id) : null

                    return (
                      <div
                        key={entity.id}
                        className={styles.brandCard}
                        onClick={() => router.push(`/entity/${entity.id}`)}
                      >
                        <div>
                          <div className={styles.brandName}>{entity.name}</div>
                          <div className={styles.brandSub}>
                            {l2cat?.name}{leafCat && l2cat ? ` › ${leafCat.name}` : leafCat?.name}
                          </div>
                        </div>
                        <div className={styles.brandTags}>
                          <span className={styles.brandTag}>{entity.type}</span>
                          {edge && (
                            <span className={`${styles.brandTag} ${(edge.share_pct ?? 100) < 100 ? styles.tagPartial : styles.tagFull}`}>
                              {edge.share_pct ?? 100}%
                            </span>
                          )}
                          {edge?.region && <span className={styles.brandTag}>{edge.region}</span>}
                          {edge?.acquired_date && <span className={styles.brandTag}>{edge.acquired_date.slice(0, 4)}</span>}
                        </div>
                        <div className={styles.brandOwner}>
                          <span>Owned by</span>
                          <span className={styles.brandOwnerName}>{owner?.name || '—'}</span>
                        </div>
                      </div>
                    )
                  })
              }
            </div>
          </>
        )}
      </div>
    </div>
  )
}
