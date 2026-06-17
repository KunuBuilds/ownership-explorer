'use client'

import { useState } from 'react'
import Link from 'next/link'
import styles from './EntityPage.module.css'

export type HoldingItem = {
  id: string
  name: string
  type: string
  category: string | null
  share_pct: number | null
  region: string | null
  acquired_year: string | null
  via: { id: string; name: string } | null
  logo_url: string | null
}

export default function HoldingsGroup({
  label, items, cap,
}: { label: string; items: HoldingItem[]; cap?: number }) {
  const [expanded, setExpanded] = useState(false)
  const showAll = !cap || expanded || items.length <= cap
  const visible = showAll ? items : items.slice(0, cap)
  const hidden = items.length - visible.length

  return (
    <div className={styles.hGroup}>
      <div className={styles.hGroupLabel}>
        <span>{label}</span>
        <span className={styles.hGroupCount}>{items.length}</span>
      </div>
      <div className={styles.hGrid}>
        {visible.map(it => {
          const partial = (it.share_pct ?? 100) < 100
          return (
            <Link
              key={it.id}
              href={`/entity/${it.id}`}
              className={`${styles.hCard} ${styles['hType-' + it.type] ?? ''}`}
            >
              <div className={styles.hCardHead}>
                {it.logo_url
                  ? <img className={styles.hLogo} src={it.logo_url} alt="" loading="lazy" />
                  : <span className={styles.hLogoFallback} aria-hidden="true">{it.name.charAt(0).toUpperCase()}</span>}
                <div className={styles.hName}>{it.name}</div>
              </div>
              <div className={styles.hMeta}>
                {partial && (
                  <span className={`${styles.hBadge} ${styles.hBadgePartial}`}>{it.share_pct ?? 100}%</span>
                )}
                {it.category && <span className={styles.hBadge}>{it.category}</span>}
                {it.via && <span className={`${styles.hBadge} ${styles.hVia}`}>via {it.via.name}</span>}
                {it.region && <span className={styles.hBadge}>{it.region}</span>}
                {it.acquired_year && <span className={styles.hBadge}>{it.acquired_year}</span>}
              </div>
            </Link>
          )
        })}
      </div>
      {hidden > 0 && (
        <button className={styles.hShowMore} onClick={() => setExpanded(true)}>
          Show {hidden} more
        </button>
      )}
    </div>
  )
}
