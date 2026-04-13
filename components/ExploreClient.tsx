'use client'
import { useState, useMemo, useEffect } from 'react'
import Link from 'next/link'
import type { GraphSnapshot } from '@/lib/data'
import { buildEntityMap, rootEntities, childrenOf, getOwnershipChains } from '@/lib/graph'
import styles from './ExploreClient.module.css'
import { useSearchParams } from 'next/navigation'

const TYPE_ICONS: Record<string, string> = {
  conglomerate: '◈', subsidiary: '◇', brand: '○', product: '·',
}

export default function ExploreClient({ snapshot }: { snapshot: GraphSnapshot }) {
  const { entities, ownership } = snapshot
  const entityMap   = useMemo(() => buildEntityMap(entities), [entities])
  const roots       = useMemo(() => rootEntities(entities, ownership), [entities, ownership])

  const [activeCompany,  setActiveCompany]  = useState<string | null>(null)
  const [expandedNodes,  setExpandedNodes]  = useState<Set<string>>(new Set())
  const [searchQuery,    setSearchQuery]    = useState('')
  const [activeFilter,   setActiveFilter]   = useState('all')
  const [peOnly, setPeOnly] = useState(false)
  
  const searchParams = useSearchParams()   // ← add this line

  useEffect(() => {                        // ← add this block
    const company = searchParams.get('company')
    if (company && entityMap.has(company)) {
      selectCompany(company)
    }
  }, [searchParams])
  
  const GROUPING_IDS = new Set(['independent', 'cooperative', 'family-owned', 'b-corp'])

  const realRoots     = filteredRoots.filter(c => !GROUPING_IDS.has(c.id))
  const groupingRoots = filteredRoots.filter(c =>  GROUPING_IDS.has(c.id))
  
  const filteredRoots = roots.filter(c => {
    const matchSearch = !searchQuery || c.name.toLowerCase().includes(searchQuery.toLowerCase())
    const matchType   = activeFilter === 'all' || c.type === activeFilter
    const matchPE     = !peOnly || c.flags?.includes('private-equity')
	return matchSearch && matchType && matchPE
  })

  function toggleNode(key: string) {
    setExpandedNodes(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  function selectCompany(id: string) {
    setActiveCompany(id)
    setExpandedNodes(new Set([id]))
  }

  function setExpansion(expand: boolean) {
    if (!activeCompany) return
    const keys = new Set<string>()
    function collect(parentId: string, depth = 0) {
      childrenOf(parentId, ownership, entityMap).forEach(({ child_id }) => {
        const key = depth === 0 ? parentId : `${parentId}__${child_id}`
        if (expand) keys.add(key)
        collect(child_id, depth + 1)
      })
    }
    if (expand) { keys.add(activeCompany); collect(activeCompany) }
    setExpandedNodes(keys)
  }

  function renderTree(parentId: string, depth = 0): React.ReactNode {
    return childrenOf(parentId, ownership, entityMap).map(edge => {
      const entity     = entityMap.get(edge.child_id)
      if (!entity) return null
      const hasChildren = childrenOf(entity.id, ownership, entityMap).length > 0
      const nodeKey     = depth === 0 ? parentId : `${parentId}__${entity.id}`
      const isExpanded  = expandedNodes.has(nodeKey)
      const isPartial   = (edge.share_pct ?? 100) < 100

      return (
        <li key={entity.id} className={styles.treeNode}>
          <div className={styles.nodeRow}>
            <Link href={`/entity/${entity.id}`} className={`${styles.nodeCard} ${styles['type-' + entity.type]}`}>
              <div className={styles.nodeIcon}>{TYPE_ICONS[entity.type] ?? '○'}</div>
              <div className={styles.nodeInfo}>
                <div className={styles.nodeName}>{entity.name}</div>
                <div className={styles.nodeType}>{entity.type}{entity.category ? ` · ${entity.category}` : ''}</div>
              </div>
              <div className={styles.nodeBadges}>
                {entity.flags?.includes('private-equity') && (
					<span className={styles.badgePE}>PE</span>
				)}
				<span className={`${styles.badge} ${isPartial ? styles.badgePartial : styles.badgeShare}`}>
                  {edge.share_pct ?? 100}%
                </span>
                {edge.region && <span className={`${styles.badge} ${styles.badgeRegion}`}>{edge.region}</span>}
                {edge.acquired_date && <span className={styles.badgeDate}>{edge.acquired_date.slice(0, 4)}</span>}
              </div>
            </Link>
            {hasChildren && (
              <button className={styles.toggleBtn} onClick={() => toggleNode(nodeKey)}>
                {isExpanded ? '−' : '+'}
              </button>
            )}
          </div>
          {hasChildren && isExpanded && (
            <div className={styles.childrenWrap}>
              <ul className={styles.treeRoot}>{renderTree(entity.id, depth + 1)}</ul>
            </div>
          )}
        </li>
      )
    })
  }

  function renderRootNode(companyId: string) {
    const entity      = entityMap.get(companyId)
    if (!entity) return null
    const hasChildren = childrenOf(entity.id, ownership, entityMap).length > 0
    const isExpanded  = expandedNodes.has(companyId)

    return (
      <ul className={styles.treeRoot}>
        <li className={styles.treeNode}>
          <div className={styles.nodeRow}>
            <Link href={`/entity/${entity.id}`} className={`${styles.nodeCard} ${styles['type-' + entity.type]}`}>
              <div className={styles.nodeIcon}>{TYPE_ICONS[entity.type]}</div>
              <div className={styles.nodeInfo}>
                <div className={styles.nodeName}>{entity.name}</div>
                <div className={styles.nodeType}>{entity.type}{entity.hq_country ? ` · ${entity.hq_country}` : ''}</div>
              </div>
              <div className={styles.nodeBadges}>
                <span className={styles.badgeRoot}>ROOT</span>
              </div>
            </Link>
            {hasChildren && (
              <button className={styles.toggleBtn} onClick={() => toggleNode(companyId)}>
                {isExpanded ? '−' : '+'}
              </button>
            )}
          </div>
          {hasChildren && isExpanded && (
            <div className={styles.childrenWrap}>
              <ul className={styles.treeRoot}>{renderTree(entity.id)}</ul>
            </div>
          )}
        </li>
      </ul>
    )
  }

  return (
    <div className={styles.layout}>
      {/* Sidebar */}
      <aside className={styles.sidebar}>
        <div className={styles.sidebarSection}>
          <div className="sidebar-label">Filter Companies</div>
          <input
            className="search-box"
            type="text"
            placeholder="Search..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
          />
          <div className={styles.filterRow}>
		  {['all','conglomerate','subsidiary','brand','product'].map(t => (
			<button
			  key={t}
			  className={`filter-btn ${activeFilter === t ? 'active' : ''}`}
			  onClick={() => setActiveFilter(t)}
			>
			  {t === 'all' ? 'All' : t}
			</button>
		  ))}
		  <button
			className={`filter-btn ${peOnly ? 'active' : ''}`}
			onClick={() => setPeOnly(p => !p)}
		  >
			PE Only
		  </button>
		</div>
        </div>
        <div className={styles.sidebarListLabel}>Parent Companies</div>
       <div className={styles.companyList}>
		  {realRoots.map(c => (
			<div
			  key={c.id}
			  className={`${styles.companyItem} ${activeCompany === c.id ? styles.companyActive : ''}`}
			  onClick={() => selectCompany(c.id)}
			>
			  <div className={styles.companyDot} style={{ background: 'var(--accent)' }} />
			  <div className={styles.companyName}>{c.name}</div>
			  <div className={styles.companyMeta}>{c.hq_country ?? ''}</div>
			</div>
		  ))}

		  {groupingRoots.length > 0 && (
			<>
			  <div className={styles.groupingDivider}>
				<span>Ownership Type</span>
			  </div>
			  {groupingRoots.map(c => (
				<div
				  key={c.id}
				  className={`${styles.companyItem} ${styles.groupingItem} ${activeCompany === c.id ? styles.companyActive : ''}`}
				  onClick={() => selectCompany(c.id)}
				>
				  <div className={styles.groupingDot} />
				  <div className={styles.companyName}>{c.name}</div>
				  <div className={styles.companyMeta}>
					{childrenOf(c.id, ownership, entityMap).length}
				  </div>
				</div>
			  ))}
			</>
		  )}
		</div>
      </aside>

      {/* Main */}
      <div className={styles.main}>
        <div className={styles.toolbar}>
          <div className={styles.breadcrumb}>
            {activeCompany
              ? <><span>{entityMap.get(activeCompany)?.name}</span> — ownership tree</>
              : <><span>Select a company</span> to explore its tree</>
            }
          </div>
          <div className={styles.viewToggle}>
            <button className={`filter-btn ${!activeCompany ? '' : 'active'}`} onClick={() => setExpansion(true)}>Expand All</button>
            <button className="filter-btn" onClick={() => setExpansion(false)}>Collapse</button>
          </div>
        </div>

        <div className={styles.treeContainer}>
          {activeCompany
            ? renderRootNode(activeCompany)
            : (
              <div className="empty-state">
                <div className="icon">◈</div>
                <p>Select a parent company from the sidebar</p>
              </div>
            )
          }
        </div>

        <div className={styles.legend}>
          {[
            { color: 'var(--accent)',  label: 'Conglomerate' },
            { color: 'var(--accent2)', label: 'Subsidiary' },
            { color: '#a07eb8',        label: 'Brand' },
            { color: '#7e8eb8',        label: 'Product' },
            { color: 'var(--danger)',  label: 'Partial Ownership' },
          ].map(item => (
            <div key={item.label} className={styles.legendItem}>
              <div className={styles.legendDot} style={{ background: item.color }} />
              {item.label}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
