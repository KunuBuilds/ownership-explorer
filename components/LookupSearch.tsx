'use client'
import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import type { Entity, Ownership } from '@/lib/supabase'
import { getOwnershipChains, buildEntityMap } from '@/lib/graph'
import styles from './LookupSearch.module.css'
import { getAllEntities, getAllOwnership } from '@/lib/data'

export default function LookupSearch() {
  const [query,    setQuery]   = useState('')
  const [results,  setResults] = useState<any[]>([])
  const [open,     setOpen]    = useState(false)
  const [entities, setEntities] = useState<Entity[]>([])
  const [ownership, setOwnership] = useState<Ownership[]>([])
  const wrapRef = useRef<HTMLDivElement>(null)
  const router  = useRouter()

  // Load graph data once on mount
  useEffect(() => {
    getAllEntities().then(setEntities)
    getAllOwnership().then(setOwnership)
  }, [])

  // Search on query change
  useEffect(() => {
	  if (!query || !entities.length) { setResults([]); setOpen(false); return }
	  const q = query.toLowerCase()
	  const entityMap = buildEntityMap(entities)

	  // Score each match — lower is better
	  function score(e: Entity): number {
		const name = e.name.toLowerCase()
		let s = 0

		// Position in name: exact > starts-with > contains
		if (name === q)             s += 0
		else if (name.startsWith(q)) s += 100
		else                          s += 200 + name.indexOf(q)

		// Type weighting: surface conglomerates and brands above legal entities
		const typeRank: Record<string, number> = {
		  conglomerate:   0,
		  brand:         10,
		  subsidiary:    20,
		  product:       30,
		  'legal-entity': 50,
		}
		s += typeRank[e.type] ?? 40

		// Shorter names tend to be more recognizable ("Campbell" beats "Campbell Soup Supply Co LLC")
		s += name.length * 0.1

		return s
	  }

	  const matches = entities
		.filter(e => e.name.toLowerCase().includes(q))
		.sort((a, b) => score(a) - score(b))
		.slice(0, 12)

	  const mapped = matches.flatMap(entity => {
		const chains = getOwnershipChains(entity.id, ownership, entityMap)
		if (chains.length === 0) {
		  // Conglomerates have no chains — still surface them as a single result
		  const edge = ownership.find(o => o.child_id === entity.id)
		  return [{ entity, chain: [{ entity, edge: null }], edge }]
		}
		return chains.map(chain => {
		  const edge = ownership.find(o => o.child_id === entity.id)
		  return { entity, chain, edge }
		})
	  })

	  setResults(mapped.slice(0, 12))
	  setOpen(mapped.length > 0)
	}, [query, entities, ownership])

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  function go(entityId: string) {
    setOpen(false)
    setQuery('')
    router.push(`/entity/${entityId}`)
  }

  function highlight(name: string) {
    if (!query) return name
    const idx = name.toLowerCase().indexOf(query.toLowerCase())
    if (idx === -1) return name
    return (
      name.slice(0, idx) +
      `<mark>${name.slice(idx, idx + query.length)}</mark>` +
      name.slice(idx + query.length)
    )
  }

  return (
    <div className={styles.wrap} ref={wrapRef}>
      <input
        className={styles.input}
        type="text"
        placeholder="Who owns… BVLGARI, Kleenex…"
        value={query}
        onChange={e => setQuery(e.target.value)}
        onFocus={() => results.length && setOpen(true)}
        autoComplete="off"
      />
      <div className={styles.icon}>⌕</div>

      {open && (
        <div className={styles.dropdown}>
          <div className={styles.dropdownLabel}>{results.length} result{results.length !== 1 ? 's' : ''}</div>
          {results.map(({ entity, chain, edge }, i) => (
            <div key={i} className={styles.result} onClick={() => go(entity.id)}>
              <div className={styles.resultName}>
                <span dangerouslySetInnerHTML={{ __html: highlight(entity.name) }} />
                <span className={styles.resultType}>{entity.type}</span>
              </div>
              <div className={styles.chain}>
                {chain.map((node: any, j: number) => (
                  <span key={j} className={styles.chainWrap}>
                    {j > 0 && <span className={styles.arrow}>›</span>}
                    <span className={`${styles.chainNode} ${j === 0 ? styles.root : ''} ${j === chain.length - 1 ? styles.target : ''}`}>
                      {node.entity.name}
                    </span>
                  </span>
                ))}
              </div>
              {edge && (
                <div className={styles.meta}>
                  <span className={`${styles.tag} ${edge.share_pct && edge.share_pct < 100 ? styles.partial : styles.full}`}>
                    {edge.share_pct ?? 100}% stake
                  </span>
                  {edge.region && <span className={styles.tag}>{edge.region}</span>}
                  {edge.acquired_date && <span className={styles.tag}>{edge.acquired_date.slice(0, 4)}</span>}
                  {entity.category && <span className={styles.tag}>{entity.category}</span>}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
