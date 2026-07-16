'use client'
import { useState, useMemo, useRef, useEffect } from 'react'
import Link from 'next/link'
import type { GraphSnapshot } from '@/lib/data'
import type { Entity } from '@/lib/supabase'
import { buildEntityMap, childrenOf, parentsOf } from '@/lib/graph'
import styles from './LookupHero.module.css'

// Brands the comp used as prompts. Filtered against real data at render time so
// we never advertise an entity that isn't in the DB.
const SUGGESTED = ['bvlgari', 'lunchables', 'geico', 'kleenex', 'coca-cola', 'huggies']

function initial(name: string) {
  return name.trim().charAt(0).toUpperCase()
}

export default function LookupHero({ snapshot }: { snapshot: GraphSnapshot }) {
  const { entities, ownership } = snapshot
  const entityMap = useMemo(() => buildEntityMap(entities), [entities])

  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<Entity | null>(null)
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)

  // Same ranking as the nav lookup: exact > starts-with > contains, with
  // recognisable types (conglomerates, brands) above legal-entity plumbing.
  const results = useMemo(() => {
    if (!query.trim()) return []
    const q = query.toLowerCase()
    const typeRank: Record<string, number> = {
      conglomerate: 0, brand: 10, subsidiary: 20, product: 30, 'legal-entity': 50,
    }
    const score = (e: Entity) => {
      const name = e.name.toLowerCase()
      let s = name === q ? 0 : name.startsWith(q) ? 100 : 200 + name.indexOf(q)
      s += typeRank[e.type] ?? 40
      return s + name.length * 0.1
    }
    return entities
      .filter(e => e.name.toLowerCase().includes(q))
      .sort((a, b) => score(a) - score(b))
      .slice(0, 8)
  }, [query, entities])

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const suggestions = useMemo(
    () => SUGGESTED.map(id => entityMap.get(id)).filter((e): e is Entity => Boolean(e)).slice(0, 4),
    [entityMap],
  )

  function pick(e: Entity) {
    setSelected(e)
    setQuery(e.name)
    setOpen(false)
  }

  // ── Resolve the answer for the selected entity ──
  const answer = useMemo(() => {
    if (!selected) return null
    const parentEdges = parentsOf(selected.id, ownership, entityMap)
    const edge = parentEdges[0]
    if (!edge) return { parent: null, edge: null, family: [], total: 0 }
    const parent = entityMap.get(edge.parent_id) ?? null
    const family = childrenOf(edge.parent_id, ownership, entityMap)
      .filter(c => c.child_id !== selected.id)
    return { parent, edge, family, total: family.length + 1 }
  }, [selected, ownership, entityMap])

  return (
    <div className={styles.wrap}>
      <div className={styles.inner}>
        <h1 className={styles.headline}>
          Who owns{' '}
          <span className={styles.fieldWrap} ref={wrapRef}>
            {/* Mirror span sizes the wrapper to the text so the "?" sits right
                after it; the input is overlaid on top. A `size` attribute can't
                do this — it measures in ch, which is wrong for a proportional
                italic serif. */}
            <span className={styles.sizer} aria-hidden="true">{query || 'Kleenex'}</span>
            <input
              className={styles.field}
              value={query}
              onChange={e => { setQuery(e.target.value); setOpen(true); setSelected(null) }}
              onFocus={() => setOpen(true)}
              placeholder="Kleenex"
              aria-label="Search for a brand or company"
              autoComplete="off"
            />
            {open && results.length > 0 && (
              <div className={styles.dropdown}>
                {results.map(e => (
                  <button key={e.id} className={styles.option} onClick={() => pick(e)}>
                    <span className={styles.optionName}>{e.name}</span>
                    <span className={styles.optionType}>{e.type}</span>
                  </button>
                ))}
              </div>
            )}
          </span>
          <span className={styles.qmark}>?</span>
        </h1>

        {answer && selected && (
          <div className={styles.card}>
            <div className={styles.cardHead}>The answer</div>

            {answer.parent && answer.edge ? (
              <>
                <div className={styles.cardBody}>
                  <Link href={`/entity/${answer.parent.id}`} className={styles.side}>
                    <div className={styles.sideName}>{answer.parent.name}</div>
                    <div className={styles.sideMeta}>
                      {answer.parent.type}
                      {answer.parent.hq_country ? ` · ${answer.parent.hq_country}` : ''}
                    </div>
                  </Link>

                  <div className={styles.rel}>
                    <div className={styles.relLabel}>owns {answer.edge.share_pct ?? 100}%</div>
                    <div className={styles.relLine} />
                    {answer.edge.acquired_date && (
                      <div className={styles.relSince}>since {answer.edge.acquired_date.slice(0, 4)}</div>
                    )}
                  </div>

                  <div className={`${styles.side} ${styles.sideRight}`}>
                    <div className={styles.sideName}>{selected.name}</div>
                    <div className={styles.sideMeta}>
                      {selected.type}
                      {selected.category ? ` · ${selected.category}` : ''}
                    </div>
                  </div>
                </div>

                {answer.family.length > 0 && (
                  <div className={styles.family}>
                    <div className={styles.familyLabel}>
                      Also in the {answer.parent.name} family
                    </div>
                    <div className={styles.familyRow}>
                      {answer.family.slice(0, 2).map(f => {
                        const ent = entityMap.get(f.child_id)
                        if (!ent) return null
                        return (
                          <Link key={ent.id} href={`/entity/${ent.id}`} className={styles.chip}>
                            <span className={styles.chipAvatar} aria-hidden="true">{initial(ent.name)}</span>
                            <span className={styles.chipName}>{ent.name}</span>
                            {ent.category && <span className={styles.chipMeta}>{ent.category}</span>}
                          </Link>
                        )
                      })}
                      <Link href={`/entity/${answer.parent.id}`} className={styles.seeAll}>
                        See all {answer.total} they own →
                      </Link>
                    </div>
                  </div>
                )}
              </>
            ) : (
              <div className={styles.cardBody}>
                <div className={styles.side}>
                  <div className={styles.sideName}>Nobody — {selected.name} is independent</div>
                  <div className={styles.sideMeta}>
                    No parent company recorded.{' '}
                    <Link href={`/entity/${selected.id}`} className={styles.inlineLink}>
                      See what it owns →
                    </Link>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {!selected && suggestions.length > 0 && (
          <div className={styles.tryRow}>
            <span className={styles.tryLabel}>Try:</span>
            {suggestions.map(e => (
              <button key={e.id} className={styles.tryChip} onClick={() => pick(e)}>
                {e.name}
              </button>
            ))}
          </div>
        )}
      </div>

      <footer className={styles.footer}>
        <span><b>{entities.length.toLocaleString()}</b> entities</span>
        <span><b>{ownership.length.toLocaleString()}</b> ownership links</span>
        <span>Every link cited to SEC filings, annual reports &amp; press releases</span>
      </footer>
    </div>
  )
}
