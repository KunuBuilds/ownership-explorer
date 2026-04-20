import { getAllEntityIds, getEntityPageData, getAllOwnership, getAllEntities } from '@/lib/data'
import { getOwnershipChains, countDescendants, buildEntityMap, childrenOf } from '@/lib/graph'
import Link from 'next/link'
import type { Metadata } from 'next'
import styles from './EntityPage.module.css'
import SubmissionForm from '@/components/SubmissionForm'

// Tell Next.js which entity pages to generate at build time
export async function generateStaticParams() {
  const ids = await getAllEntityIds();
  return ids
    .filter(id => id && id.length > 1)  // skip empty/bogus slugs
    .map(id => ({ id }));
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
  brand:        '#a07eb8',
  product:      '#7e8eb8',
}

export default async function EntityPage({ params }: { params: { id: string } }) {
  const data = await getEntityPageData(params.id)

  if (!data) {
    return (
      <div className="empty-state">
        <div className="icon">◈</div>
        <p>Entity not found: {params.id}</p>
        <Link href="/" style={{ color: 'var(--accent)', marginTop: 8, fontSize: 11 }}>← Browse all</Link>
      </div>
    )
  }

  const { entity, children, parents, sources, categories, alternatives } = data

  // Build graph context for chain traversal
  const allEntities  = await getAllEntities()
  const allOwnership = await getAllOwnership()
  const entityMap    = buildEntityMap(allEntities)

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

  return (
    <article className={styles.page}>
      <Link href={`/?company=${rootId}`} className={styles.back}>← Browse all</Link>
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
          <h1 className={styles.title}>{entity.name}</h1>
          <div className={styles.metaRow}>
            {entity.category && <span className={styles.tag}>{entity.category}</span>}
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
          <div className="section-label">Direct Holdings ({children.length})</div>
          <div className={styles.holdingsGrid}>
            {children.map(({ entity: child, share_pct, region, acquired_date }) => (
              <Link key={child.id} href={`/entity/${child.id}`} className={`${styles.holdingCard} ${styles['type-' + child.type]}`}>
                <div className={styles.holdingName}>{child.name}</div>
                <div className={styles.holdingMeta}>
                  <span className={`${styles.badge} ${(share_pct ?? 100) < 100 ? styles.badgePartial : styles.badgeFull}`}>
                    {share_pct ?? 100}%
                  </span>
                  {child.type !== 'product' && <span className={styles.badge}>{child.type}</span>}
                  {child.category && <span className={styles.badge}>{child.category}</span>}
                  {region && <span className={styles.badge}>{region}</span>}
                  {acquired_date && <span className={styles.badge}>{acquired_date.slice(0, 4)}</span>}
                </div>
              </Link>
            ))}
          </div>
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
