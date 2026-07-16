'use client'

import { useState } from 'react'
import Link from 'next/link'
import styles from './EntityPage.module.css'

export type HoldingItem = {
  id: string
  name: string
  type: string
  /** Level-2 "product category" — the heading holdings are grouped under. */
  category: string | null
  /** Level-3 leaf, shown on the row. Null when it equals the group heading. */
  subcategory: string | null
  share_pct: number | null
  region: string | null
  acquired_year: string | null
  via: { id: string; name: string } | null
  source_count: number
}

const UNCATEGORISED = 'Uncategorised'

export default function HoldingsGroup({
  label, items, cap,
}: { label: string; items: HoldingItem[]; cap?: number }) {
  const [expanded, setExpanded] = useState(false)
  const showAll = !cap || expanded || items.length <= cap
  const visible = showAll ? items : items.slice(0, cap)
  const hidden = items.length - visible.length

  // Callers sort by category (nulls last), so equal categories are already
  // adjacent — a single pass is enough to bucket them.
  const catGroups: { category: string | null; items: HoldingItem[] }[] = []
  for (const it of visible) {
    const last = catGroups[catGroups.length - 1]
    if (last && last.category === it.category) last.items.push(it)
    else catGroups.push({ category: it.category, items: [it] })
  }

  // Heading counts come from the full set, not the capped slice — otherwise a
  // capped section reads "Legal Entities 242" above "Consumer Products 24".
  const totalByCat = new Map<string, number>()
  for (const it of items) {
    const k = it.category ?? UNCATEGORISED
    totalByCat.set(k, (totalByCat.get(k) ?? 0) + 1)
  }

  // Headings earn their space only when they actually divide something. A lone
  // bucket of uncategorised holdings gets no "Uncategorised" label.
  const showCatLabels = catGroups.length > 1 || Boolean(catGroups[0]?.category)

  return (
    <div className={styles.hGroup}>
      <div className={styles.hGroupLabel}>
        <span>{label}</span>
        <span className={styles.hGroupCount}>{items.length}</span>
      </div>
      {catGroups.map(g => (
        <div className={styles.hCatGroup} key={g.category ?? UNCATEGORISED}>
          {showCatLabels && (
            <div className={styles.hCatLabel}>
              <span>{g.category ?? UNCATEGORISED}</span>
              <span className={styles.hCatCount}>
                {totalByCat.get(g.category ?? UNCATEGORISED) ?? g.items.length}
              </span>
            </div>
          )}
          <div className={styles.hGrid}>
            {g.items.map(it => (
              <Link
                key={it.id}
                href={`/entity/${it.id}`}
                className={`${styles.hCard} ${styles['hType-' + it.type] ?? ''}`}
              >
                <span className={styles.hAvatar} aria-hidden="true">
                  {it.name.trim().charAt(0).toUpperCase()}
                </span>

                <div className={styles.hMain}>
                  <div className={styles.hName}>{it.name}</div>
                  <div className={styles.hSub}>
                    {/* Prefer the leaf ("Facial Tissue") since the heading above
                        already gives the group ("Paper Products"); fall back to
                        the group only when no heading is shown. */}
                    {[it.subcategory ?? (showCatLabels ? null : it.category),
                      it.type,
                      it.region && `${it.region} region`]
                      .filter(Boolean)
                      .join(' · ')}
                  </div>
                </div>

                <div className={styles.hMeta}>
                  {it.via && <span className={`${styles.hBadge} ${styles.hVia}`}>via {it.via.name}</span>}
                  <span className={`${styles.hShare} ${(it.share_pct ?? 100) < 100 ? styles.hSharePartial : ''}`}>
                    {it.share_pct ?? 100}%
                  </span>
                  {it.acquired_year && <span className={styles.hSince}>since {it.acquired_year}</span>}
                  {it.source_count > 0 && (
                    <span className={styles.hSources}>
                      {it.source_count} source{it.source_count !== 1 ? 's' : ''}
                    </span>
                  )}
                </div>
              </Link>
            ))}
          </div>
        </div>
      ))}
      {hidden > 0 && (
        <button className={styles.hShowMore} onClick={() => setExpanded(true)}>
          Show {hidden} more
        </button>
      )}
    </div>
  )
}
