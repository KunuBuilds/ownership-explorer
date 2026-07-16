import { getAllEntityIds, getEntityPageData, getAllOwnership, getAllEntities, getAllCategories, getEffectivePrimaryCategoryBatch, getSourceCountsByOwnership } from '@/lib/data'
import { getOwnershipChains, countDescendants, buildEntityMap, childrenOf, rollUpToCategoryLevel } from '@/lib/graph'
import type { Ownership } from '@/lib/supabase'
import Link from 'next/link'
import type { Metadata } from 'next'
import styles from './EntityPage.module.css'
import SubmissionForm from '@/components/SubmissionForm'
import HoldingsGroup, { HoldingItem } from './HoldingsGroup'

// Tell Next.js which entity pages to generate at build time
export const dynamicParams = true

// Without this, an entity page is rendered once and cached in the Full Route
// Cache indefinitely — newly-added holdings (e.g. coca-cola's brands) never
// appear until the next deploy. Re-render at most once per hour so admin edits
// surface without re-fetching the whole graph on every request.
export const revalidate = 3600

export async function generateStaticParams() {
  return [
    { id: 'kraft-heinz' },
    { id: 'mondelez' },
    { id: 'berkshire' },
    { id: 'lvmh' },
    { id: 'comcast-corp' },
    { id: 'warner-bros-discovery-inc' },
    { id: 'procter-gamble-co' },
    { id: 'colgate-palmolive-co' },
    { id: 'general-motors-co' },
    { id: 'marriott-international-inc-md' },
  ]
}

// Generate unique <title> and meta description per entity
export async function generateMetadata({ params }: { params: { id: string } }): Promise<Metadata> {
  const data = await getEntityPageData(params.id)
  if (!data) return { title: 'Entity Not Found' }
  const { entity, parents } = data
  const owner = parents[0]?.entity?.name
  return {
    title:       `${entity.name} — Ownership Explorer`,
    description: owner
      ? `${entity.name} is owned by ${owner}. Explore its ownership chain, holdings, and acquisition history.`
      : `Explore ${entity.name}'s corporate structure, subsidiaries, and brands.`,
  }
}

const TYPE_COLORS: Record<string, string> = {
  conglomerate: 'var(--accent)',
  subsidiary:   'var(--accent2)',
  brand:        'var(--type-brand)',
  product:      'var(--type-product)',
}

export default async function EntityPage({ params }: { params: { id: string } }) {
  const data = await getEntityPageData(params.id)

  if (!data) {
    return (
      <div className="empty-state">
        <div className="icon">◈</div>
        <p>Entity not found: {params.id}</p>
        <Link href="/browse" style={{ color: 'var(--accent)', marginTop: 8, fontSize: 13 }}>← Browse all</Link>
      </div>
    )
  }

  const { entity, children, parents, sources, categories, categoryMeta, alternatives } = data

  // Build graph context for chain traversal
  const allEntities  = await getAllEntities()
  const allOwnership = await getAllOwnership()
  const entityMap    = buildEntityMap(allEntities)

  // Effective-category metadata carries only IDs; resolve display names.
  const allCategories = await getAllCategories()
  const catNameById   = new Map(allCategories.map(c => [c.id, c.name]))

  const chains    = getOwnershipChains(entity.id, allOwnership, entityMap)
  const chain     = chains[0] ?? []
  const directEdge = parents[0]
  const isPartial  = directEdge && (directEdge.share_pct ?? 100) < 100
  const total      = countDescendants(entity.id, allOwnership)

  // Siblings = other children of same parent
  const siblings = directEdge
    ? childrenOf(directEdge.parent_id, allOwnership, entityMap)
        .filter(c => c.child_id !== entity.id)
    : []

  // Build page-scoped citation index
  const seenSources = new Map<string, number>()
  sources.forEach(({ source }) => {
    if (!seenSources.has(source.id)) seenSources.set(source.id, seenSources.size + 1)
  })
  const rootId = chain.length > 0 ? chain[0].entity.id : entity.id
  
  // Entity's leaf category (first one if multiple)
  const entityCatId = categories.length > 0 ? categories[0] : null


  // Group sources by ownership_id for inline citation lookup
  const sourcesByOwnershipId = new Map<number, typeof sources>()
  sources.forEach(s => {
    const arr = sourcesByOwnershipId.get(s.ownershipId) ?? []
    arr.push(s)
    sourcesByOwnershipId.set(s.ownershipId, arr)
  })

  const SOURCE_TYPE_LABELS: Record<string, string> = {
    primary: 'Primary', secondary: 'Secondary', filing: 'Filing'
  }

  // ── Grouped holdings (Brands first, with brand roll-up) ──
  // Index children by parent once to avoid O(E) re-scans during traversal.
  const childrenByParent = new Map<string, ReturnType<typeof childrenOf>>()
  for (const o of allOwnership) {
    const ent = entityMap.get(o.child_id)
    if (!ent) continue
    const arr = childrenByParent.get(o.parent_id) ?? []
    arr.push({ ...o, entity: ent })
    childrenByParent.set(o.parent_id, arr)
  }

  type RawBrand = { entity: typeof entity; edge: Ownership; via: { id: string; name: string } | null }
  function collectBrandHoldings(rootId: string): RawBrand[] {
    const out: RawBrand[] = []
    const seenBrands = new Set<string>()
    const walked = new Set<string>()
    function walk(parentId: string) {
      if (walked.has(parentId)) return
      walked.add(parentId)
      for (const edge of childrenByParent.get(parentId) ?? []) {
        const child = edge.entity!
        if (child.type === 'brand') {
          if (!seenBrands.has(child.id)) {
            seenBrands.add(child.id)
            out.push({
              entity: child, edge,
              via: parentId === rootId ? null : { id: parentId, name: entityMap.get(parentId)?.name ?? parentId },
            })
          }
        } else {
          walk(child.id)
        }
      }
    }
    walk(rootId)
    return out
  }

  const rawBrands       = collectBrandHoldings(entity.id)
  const companyChildren = children.filter(c => ['subsidiary', 'conglomerate'].includes(c.entity.type))
  const productChildren = children.filter(c => c.entity.type === 'product')
  const legalChildren   = children.filter(c => c.entity.type === 'legal-entity')
  const knownTypes      = new Set(['brand', 'subsidiary', 'conglomerate', 'product', 'legal-entity'])
  const otherChildren   = children.filter(c => !knownTypes.has(c.entity.type))

  const holdingIds = [
    ...rawBrands.map(h => h.entity.id),
    ...companyChildren.map(c => c.entity.id),
    ...productChildren.map(c => c.entity.id),
    ...legalChildren.map(c => c.entity.id),
    ...otherChildren.map(c => c.entity.id),
  ]
  const primaryCat = await getEffectivePrimaryCategoryBatch(holdingIds)
  const catById    = new Map(allCategories.map(c => [c.id, c]))

  // Holdings group by the level-2 "product category" ("Paper Products"); the
  // level-3 leaf ("Facial Tissue") stays on the row as its subtitle. Entities
  // with no taxonomy assignment fall back to the legacy entities.category
  // string, which isn't in the tree and so can't be rolled up.
  const holdingCats = (id: string, fallback: string | null) => {
    const pick = primaryCat.get(id)
    if (!pick) return { category: fallback ?? null, subcategory: null }
    const group = rollUpToCategoryLevel(pick.id, catById)
    if (!group || group.id === pick.id) return { category: pick.name, subcategory: null }
    return { category: group.name, subcategory: pick.name }
  }

  // Citation counts keyed by ownership edge, for the per-holding "N sources" pill.
  const sourceCounts = await getSourceCountsByOwnership()

  // Group label first (uncategorised last), then leaf, then name — so equal
  // categories land adjacent for HoldingsGroup's single-pass bucketing.
  const byCategory = (a: HoldingItem, b: HoldingItem) => {
    const ca = a.category, cb = b.category
    if (ca && cb) { const d = ca.localeCompare(cb); if (d) return d }
    else if (ca && !cb) return -1
    else if (!ca && cb) return 1
    const d2 = (a.subcategory ?? '').localeCompare(b.subcategory ?? '')
    if (d2) return d2
    return a.name.localeCompare(b.name)
  }

  const brandItems: HoldingItem[] = rawBrands.map(h => ({
    id: h.entity.id, name: h.entity.name, type: h.entity.type,
    ...holdingCats(h.entity.id, h.entity.category),
    share_pct: h.edge.share_pct ?? null,
    region: h.edge.region ?? null,
    acquired_year: h.edge.acquired_date ? h.edge.acquired_date.slice(0, 4) : null,
    via: h.via,
    source_count: sourceCounts.get(h.edge.id) ?? 0,
  })).sort(byCategory)

  const mapChild = (c: typeof children[number]): HoldingItem => ({
    id: c.entity.id, name: c.entity.name, type: c.entity.type,
    ...holdingCats(c.entity.id, c.entity.category),
    share_pct: c.share_pct ?? null,
    region: c.region ?? null,
    acquired_year: c.acquired_date ? c.acquired_date.slice(0, 4) : null,
    via: null,
    source_count: sourceCounts.get(c.id) ?? 0,
  })

  const companyItems = companyChildren.map(mapChild).sort(byCategory)
  const productItems = productChildren.map(mapChild).sort(byCategory)
  const legalItems   = legalChildren.map(mapChild).sort(byCategory)
  const otherItems   = otherChildren.map(mapChild).sort(byCategory)

  return (
    <article className={styles.page}>
      <Link href={`/browse?company=${rootId}`} className={styles.back}>← Browse all</Link>
	  {entityCatId && (
      <Link href={`/categories?cat=${entityCatId}`} className={styles.back} style={{ marginLeft: 16 }}>
		← Categories
	  </Link>
)}

      {/* ── Hero ── */}
      <div className={styles.hero}>
        <div className={styles.heroLeft}>
          <div className={styles.eyebrow}>
            <div className={styles.typeDot} style={{ background: TYPE_COLORS[entity.type] }} />
            {entity.type}{entity.hq_country ? ` · ${entity.hq_country}` : ''}
          </div>
          <div className={styles.titleRow}>
            <h1 className={styles.title}>{entity.name}</h1>
          </div>
          {entity.description && (
            <p className={styles.description}>{entity.description}</p>
          )}
          {categoryMeta.length > 0 && (
            <div className={styles.categoryRow}>
              {categoryMeta.map(cat => (
                <Link key={cat.category_id} href={`/categories?cat=${cat.category_id}`} className={`${styles.categoryTag} ${cat.is_primary ? styles.categoryTagPrimary : ''}`}>
                  {catNameById.get(cat.category_id) ?? cat.category_id}
                  {cat.source === 'inherited' && (
                    <span style={{ opacity: 0.55, marginLeft: 4, fontSize: '0.85em' }} title="Inherited from parent">↑</span>
                  )}
                </Link>
              ))}
            </div>
          )}
          <div className={styles.metaRow}>
            {categoryMeta.length === 0 && entity.category && <span className={styles.tag}>{entity.category}</span>}
            {directEdge
              ? <span className={`${styles.tag} ${isPartial ? styles.tagRed : styles.tagGreen}`}>
                  {directEdge.share_pct ?? 100}% owned
                </span>
              : <span className={`${styles.tag} ${styles.tagAccent}`}>Independent / Root</span>
            }
            {directEdge?.region && <span className={`${styles.tag} ${styles.tagGreen}`}>{directEdge.region}</span>}
            {directEdge?.acquired_date && <span className={styles.tag}>Acquired {directEdge.acquired_date.slice(0, 4)}</span>}
          </div>
		  {entity.flags?.includes('private-equity') && (
		  <div className={styles.peCallout}>
			<span className={styles.peIcon}>◈</span>
			Private Equity Owned
			<span className={styles.peDesc}>
			  This entity is owned or controlled by a private equity firm.
			  Operational decisions, brand direction, and long-term investment
			  may reflect fund return timelines rather than strategic corporate goals.
			</span>
		  </div>
			)}
		  
          {directEdge && (
            <div className={styles.shareBarWrap}>
              <div className={styles.shareBarLabel}>Ownership Stake</div>
              <div className={styles.shareBar}>
                <div
                  className={`${styles.shareBarFill} ${isPartial ? styles.partial : ''}`}
                  style={{ width: `${directEdge.share_pct ?? 100}%` }}
                />
              </div>
            </div>
          )}
        </div>
        {total > 0 && (
          <div className={styles.statBlock}>
            <div className={styles.statValue}>{total}</div>
            <div className={styles.statLabel}>Total Holdings</div>
          </div>
        )}
      </div>

      {/* ── Alternatives strip ── */}
      {alternatives.length > 0 && (
        <div className={styles.altStrip}>
          <span className={styles.altStripLabel}>Try instead</span>
          {alternatives.map(({ alternative, reason }) => (
            <Link key={alternative.id} href={`/entity/${alternative.id}`} className={styles.altChip}>
              {alternative.name}
              {reason && <span className={styles.altChipReason}>{reason}</span>}
            </Link>
          ))}
        </div>
      )}

      {/* ── Ownership chain ── */}
      {chain.length > 1 && (
        <section className={styles.section}>
          <div className="section-label">Ownership Chain</div>
          <div className={styles.chain}>
            {chain.map((node, i) => {
              const isCurrent = node.entity.id === entity.id
              const edgeToNext = i < chain.length - 1
                ? allOwnership.find(o => o.parent_id === node.entity.id && o.child_id === chain[i + 1]?.entity.id)
                : null
              return (
                <div key={node.entity.id} className={styles.chainItem}>
                  <Link
                    href={isCurrent ? '#' : `/entity/${node.entity.id}`}
                    className={`${styles.chainCard} ${isCurrent ? styles.chainCurrent : ''}`}
                  >
                    <div className={styles.chainName}>{node.entity.name}</div>
                    <div className={styles.chainType}>{node.entity.type}</div>
                  </Link>
                  {edgeToNext && (
                    <div className={styles.chainEdge}>
                      <div className={styles.chainLine} />
                      <div className={styles.chainArrow}>›</div>
                      <div className={styles.chainLabel}>{edgeToNext.share_pct ?? 100}%</div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </section>
      )}

      {/* ── Stats ── */}
      <div className={styles.statsRow}>
        {[
          { value: children.length, label: 'Direct Holdings' },
          { value: total,           label: 'Total Descendants' },
          { value: chain.length > 1 ? chain.length - 1 : 0, label: 'Levels Deep' },
          { value: siblings.length, label: 'Siblings' },
        ].map(s => (
          <div key={s.label} className={styles.statCell}>
            <div className={styles.statCellValue}>{s.value}</div>
            <div className={styles.statCellLabel}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* ── Holdings ── */}
      {children.length > 0 && (
        <section className={styles.section}>
          <div className={`section-label ${styles.holdingsLabel}`}>
            <span>Holdings</span>
            <span className={styles.holdingsHint}>grouped by category</span>
          </div>
          {brandItems.length   > 0 && <HoldingsGroup label="Brands"                   items={brandItems} />}
          {companyItems.length > 0 && <HoldingsGroup label="Companies & Subsidiaries" items={companyItems} />}
          {productItems.length > 0 && <HoldingsGroup label="Products"                 items={productItems} />}
          {legalItems.length   > 0 && <HoldingsGroup label="Legal Entities"           items={legalItems} cap={24} />}
          {otherItems.length   > 0 && <HoldingsGroup label="Other Holdings"           items={otherItems} />}
        </section>
      )}

      {/* ── Siblings ── */}
      {siblings.length > 0 && directEdge && (
        <section className={styles.section}>
          <div className="section-label">
            Siblings — also owned by {entityMap.get(directEdge.parent_id)?.name}
          </div>
          <div className={styles.siblingsList}>
            {siblings.map(sib => (
              <Link key={sib.child_id} href={`/entity/${sib.child_id}`} className={styles.siblingRow}>
                <div>
                  <div className={styles.siblingName}>{entityMap.get(sib.child_id)?.name}</div>
                  <div className={styles.siblingType}>{entityMap.get(sib.child_id)?.type}</div>
                </div>
                <span className={`${styles.badge} ${(sib.share_pct ?? 100) < 100 ? styles.badgePartial : styles.badgeFull}`}>
                  {sib.share_pct ?? 100}%
                </span>
              </Link>
            ))}
          </div>
        </section>
      )}

	  {/* ── Alternatives ── */}
	  {alternatives.length > 0 && (
	  <section className={styles.section}>
		<div className="section-label">Alternatives ({alternatives.length})</div>
		<div className={styles.alternativesGrid}>
		  {alternatives.map(({ alternative, reason }) => {
			const altChains = getOwnershipChains(alternative.id, allOwnership, entityMap)
			const altChain  = altChains[0] ?? []
			const altEdge   = allOwnership.find(o => o.child_id === alternative.id)
			const isIndependent = altChain.length <= 1
			const isSmall = altChain.length > 1 &&
			  altChain[0]?.entity.type === 'conglomerate' &&
			  allEntities.filter(e => allOwnership.some(o => o.parent_id === altChain[0].entity.id)).length < 5

			return (
			  <Link
				key={alternative.id}
				href={`/entity/${alternative.id}`}
				className={styles.altCard}
			  >
				<div className={styles.altHeader}>
				  <div className={styles.altName}>{alternative.name}</div>
				  {reason && (
					<span className={`${styles.altReason} ${isIndependent ? styles.altIndependent : isSmall ? styles.altSmall : styles.altOther}`}>
					  {reason}
					</span>
				  )}
				</div>
				<div className={styles.altChain}>
				  {altChain.length <= 1
					? <span className={styles.altIndependentLabel}>Independent</span>
					: altChain.map((node, i) => (
						<span key={node.entity.id} className={styles.altChainWrap}>
						  {i > 0 && <span className={styles.altChainArrow}>›</span>}
						  <span className={`${styles.altChainNode} ${i === 0 ? styles.altChainRoot : ''} ${i === altChain.length - 1 ? styles.altChainTarget : ''}`}>
							{node.entity.name}
						  </span>
						</span>
					  ))
				  }
				</div>
				{altEdge && (
				  <div className={styles.altMeta}>
					<span className={`${styles.altMetaTag} ${(altEdge.share_pct ?? 100) < 100 ? styles.badgePartial : ''}`}>
					  {altEdge.share_pct ?? 100}% owned
					</span>
					{alternative.category && <span className={styles.altMetaTag}>{alternative.category}</span>}
				  </div>
				)}
			  </Link>
			)
		  })}
		</div>
	  </section>
	  )}

      {/* ── References ── */}
      {sources.length > 0 && (
        <section className={styles.references}>
          <div className="section-label">References ({sources.length})</div>
          <div className={styles.refList}>
            {sources.map(({ source }, i) => (
              <div key={source.id} className={styles.refRow} id={`ref-${source.id}`}>
                <div className={styles.refNum}>{i + 1}</div>
                <div className={styles.refBody}>
                  <div className={styles.refTitle}>
                    {source.url
                      ? <a href={source.url} target="_blank" rel="noopener noreferrer">{source.title}</a>
                      : source.title
                    }
                  </div>
                  <div className={styles.refMeta}>
                    {source.source_type && (
                      <span className={`${styles.refBadge} ${styles[source.source_type]}`}>
                        {SOURCE_TYPE_LABELS[source.source_type]}
                      </span>
                    )}
                    {source.publisher && <span>{source.publisher}</span>}
                    {source.published_date && <><span>·</span><span>{source.published_date}</span></>}
                  </div>
                </div>
                {source.url && (
                  <a className={styles.refLink} href={source.url} target="_blank" rel="noopener noreferrer">↗</a>
                )}
              </div>
            ))}
          </div>
          <p className={styles.citationNote}>
            Sources are categorised as <strong>Primary</strong> (official company statements),{' '}
            <strong>Secondary</strong> (independent news reporting), or{' '}
            <strong>Filing</strong> (regulatory submissions to SEC, AMF, or equivalent).
          </p>
        </section>
      )}
	  
	  {/* ── Submission Form ── */}
	  <section className={styles.section} style={{ marginTop: 48 }}>
		  <div className={styles.correctionToggle}>
			<div className="section-label" style={{ margin: 0, border: 'none', padding: 0 }}>
			  Suggest a Correction
			</div>
			<p className={styles.correctionDesc}>
			  Spotted something wrong? Help us keep this data accurate.
			</p>
		  </div>
		  <SubmissionForm
			type="correction"
			entityId={entity.id}
			entityName={entity.name}
		  />
	  </section>
	  
	  
    </article>
  )
}
