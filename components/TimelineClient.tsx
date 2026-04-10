'use client'
import { useState, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import type { GraphSnapshot } from '@/lib/data'
import {
  buildEntityMap, rootEntities, getOwnershipChains,
  buildTimelineEvents, type TimelineEvent
} from '@/lib/graph'
import styles from './TimelineClient.module.css'

const ROOT_COLORS: Record<string, string> = {
  'lvmh':           '#c8a96e',
  'kraft-heinz':    '#7eb8a4',
  'kimberly-clark': '#a07eb8',
  'berkshire':      '#c86e6e',
}
function rootColor(id: string) { return ROOT_COLORS[id] || '#6b6f7d' }

const COL_W = { decade: 80, year: 120 }

interface Props { snapshot: GraphSnapshot }

export default function TimelineClient({ snapshot }: Props) {
  const { entities, ownership, categories } = snapshot
  const entityMap = useMemo(() => buildEntityMap(entities), [entities])
  const roots     = useMemo(() => rootEntities(entities, ownership), [entities, ownership])

  const [scale,         setScale]         = useState<'decade' | 'year'>('decade')
  const [ownershipFilter, setOwnershipFilter] = useState<'all' | 'full' | 'partial'>('all')
  const [activeCompanies, setActiveCompanies] = useState<Set<string>>(new Set())
  const [tooltip,       setTooltip]       = useState<{ ev: TimelineEvent; x: number; y: number } | null>(null)
  const router = useRouter()

  // Pre-compute all chains once
  const allChains = useMemo(() => {
    const map = new Map<string, ReturnType<typeof getOwnershipChains>>()
    entities.forEach(e => {
      map.set(e.id, getOwnershipChains(e.id, ownership, entityMap))
    })
    return map
  }, [entities, ownership, entityMap])

  const allEvents = useMemo(
    () => buildTimelineEvents(ownership, entityMap, allChains),
    [ownership, entityMap, allChains]
  )

  const filteredEvents = useMemo(() => allEvents.filter(ev => {
    if (activeCompanies.size > 0 && !activeCompanies.has(ev.rootId)) return false
    if (ownershipFilter === 'full'    && ev.share < 100) return false
    if (ownershipFilter === 'partial' && ev.share >= 100) return false
    return true
  }), [allEvents, activeCompanies, ownershipFilter])

  function toggleCompany(id: string) {
    setActiveCompanies(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  const cw = COL_W[scale]
  const minYear   = filteredEvents.length ? Math.min(...filteredEvents.map(e => e.year)) : 1920
  const maxYear   = filteredEvents.length ? Math.max(...filteredEvents.map(e => e.year)) : 2025
  const startYear = Math.floor(minYear / 10) * 10
  const endYear   = maxYear + 2

  function xPos(year: number, month = 1) {
    return ((year - startYear) + (month - 1) / 12) * cw
  }

  // Group events by root
  const lanes = useMemo(() => {
    const map = new Map<string, TimelineEvent[]>()
    filteredEvents.forEach(ev => {
      if (!map.has(ev.rootId)) map.set(ev.rootId, [])
      map.get(ev.rootId)!.push(ev)
    })
    return map
  }, [filteredEvents])

  // Ruler ticks
  const ticks: number[] = []
  for (let y = startYear; y <= endYear; y++) {
    if (scale === 'decade' && y % 10 !== 0) continue
    ticks.push(y)
  }

  const totalW = xPos(endYear + 1)
  const LANE_LABEL_W = 180

  // Layout events in rows within each lane to avoid overlap
  function layoutLane(events: TimelineEvent[]) {
    const rows: number[] = []
    const cardW = 165
    const sorted = [...events].sort((a, b) => a.date.getTime() - b.date.getTime())

    return sorted.map(ev => {
      const x = xPos(ev.year, ev.date.getMonth() + 1)
      let row = 0
      for (let r = 0; r < rows.length; r++) {
        if (x > rows[r] + cardW + 10) { row = r; break }
        row = r + 1
      }
      if (rows[row] === undefined) rows.push(0)
      rows[row] = x + cardW
      return { ev, x, row }
    })
  }

  const rootIds = [...new Set(allEvents.map(e => e.rootId))]
  const partial = filteredEvents.filter(e => e.share < 100).length

  return (
    <div className={styles.layout}>
      {/* Sidebar */}
      <aside className={styles.sidebar}>
        <div className={styles.sidebarSection}>
          <div className="sidebar-label">Filter</div>

          <div className={styles.filterGroup}>
            <div className={styles.filterGroupLabel}>Parent Company</div>
            {rootIds.map(rid => {
              const active = activeCompanies.size === 0 || activeCompanies.has(rid)
              return (
                <label key={rid}
                  className={`${styles.checkRow} ${active ? styles.checked : ''}`}
                  onClick={() => toggleCompany(rid)}
                >
                  <div className={`${styles.checkBox} ${active ? styles.checkBoxActive : ''}`}>
                    {active ? '✓' : ''}
                  </div>
                  <div className={styles.swatch} style={{ background: rootColor(rid) }} />
                  <span>{entityMap.get(rid)?.name || rid}</span>
                </label>
              )
            })}
          </div>

          <div className={styles.filterGroup}>
            <div className={styles.filterGroupLabel}>Ownership</div>
            <div className={styles.filterRow}>
              {(['all', 'full', 'partial'] as const).map(f => (
                <button
                  key={f}
                  className={`filter-btn ${ownershipFilter === f ? 'active' : ''}`}
                  onClick={() => setOwnershipFilter(f)}
                >
                  {f === 'all' ? 'All' : f === 'full' ? '100%' : 'Partial'}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className={styles.sidebarSection}>
          <div className="sidebar-label">Scale</div>
          <div className={styles.filterRow}>
            <button className={`filter-btn ${scale === 'decade' ? 'active' : ''}`} onClick={() => setScale('decade')}>Decade</button>
            <button className={`filter-btn ${scale === 'year'   ? 'active' : ''}`} onClick={() => setScale('year')}>Year</button>
          </div>
        </div>

        <div className={styles.sidebarSection}>
          <div className="sidebar-label">Stats</div>
          <div className={styles.statRow}><span className={styles.statLabel}>Acquisitions</span><span className={styles.statVal}>{filteredEvents.length}</span></div>
          <div className={styles.statRow}><span className={styles.statLabel}>Earliest</span><span className={styles.statVal}>{filteredEvents.length ? filteredEvents[0].year : '—'}</span></div>
          <div className={styles.statRow}><span className={styles.statLabel}>Latest</span><span className={styles.statVal}>{filteredEvents.length ? filteredEvents[filteredEvents.length - 1].year : '—'}</span></div>
          <div className={styles.statRow}><span className={styles.statLabel}>Partial stake</span><span className={styles.statVal}>{partial}</span></div>
        </div>
      </aside>

      {/* Main canvas */}
      <div className={styles.main}>
        <div className={styles.toolbar}>
          <div className={styles.breadcrumb}>Acquisition <span>Timeline</span></div>
          <div className={styles.count}>{filteredEvents.length} acquisition{filteredEvents.length !== 1 ? 's' : ''}</div>
        </div>

        <div className={styles.canvas}>
          {filteredEvents.length === 0 ? (
            <div className="empty-state"><div className="icon">◈</div><p>No acquisitions match the current filters</p></div>
          ) : (
            <div style={{ minWidth: totalW + LANE_LABEL_W }}>
              {/* Ruler */}
              <div className={styles.ruler} style={{ minWidth: totalW + LANE_LABEL_W }}>
                <div style={{ width: LANE_LABEL_W, flexShrink: 0 }} />
                {ticks.map((y, i) => {
                  const nextTick = ticks[i + 1] ?? endYear + 1
                  const tickW = scale === 'decade' ? (nextTick - y) * cw : cw
                  return (
                    <div
                      key={y}
                      className={`${styles.rulerTick} ${y % 10 === 0 ? styles.decadeMark : ''}`}
                      style={{ width: tickW }}
                    >
                      {y}
                    </div>
                  )
                })}
              </div>

              {/* Swim lanes */}
              {[...lanes.entries()].map(([rootId, events]) => {
                const color    = rootColor(rootId)
                const rootName = entityMap.get(rootId)?.name || rootId
                const laid     = layoutLane(events)
                const rowCount = laid.length ? Math.max(...laid.map(l => l.row)) + 1 : 1
                const laneH    = Math.max(80, rowCount * 58 + 24)

                return (
                  <div key={rootId} className={styles.lane}>
                    <div className={styles.laneLabel}>
                      <div className={styles.laneName} style={{ color }}>{rootName}</div>
                      <div className={styles.laneCount}>{events.length} acquisition{events.length !== 1 ? 's' : ''}</div>
                    </div>
                    <div className={styles.laneEvents} style={{ height: laneH, minWidth: totalW }}>
                      {laid.map(({ ev, x, row }) => {
                        const isPartial = ev.share < 100
                        const top = 12 + row * 58
                        return (
                          <div
                            key={`${ev.childId}-${ev.parentId}`}
                            className={styles.event}
                            style={{ left: x, top }}
                            onClick={() => router.push(`/entity/${ev.childId}`)}
                            onMouseEnter={e => setTooltip({ ev, x: e.clientX, y: e.clientY })}
                            onMouseLeave={() => setTooltip(null)}
                          >
                            <div className={styles.eventDot} style={{ background: color }} />
                            <div className={styles.eventLine} style={{ color }} />
                            <div className={styles.eventCard} style={{ borderLeftColor: color }}>
                              <div className={styles.eventName} title={ev.childName}>{ev.childName}</div>
                              <div className={styles.eventDate}>
                                {ev.year}{ev.date.getMonth() !== 0 ? ` · ${ev.date.toLocaleString('default', { month: 'short' })}` : ''}
                              </div>
                              <div className={styles.eventBadges}>
                                <span className={`${styles.eventBadge} ${isPartial ? styles.badgePartial : styles.badgeFull}`}>
                                  {ev.share}%
                                </span>
                                {ev.region && <span className={styles.eventBadge}>{ev.region}</span>}
                              </div>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>

      {/* Tooltip */}
      {tooltip && (
        <div
          className={styles.tooltip}
          style={{
            left: Math.min(tooltip.x + 14, window.innerWidth - 300),
            top:  Math.min(tooltip.y + 14, window.innerHeight - 220),
          }}
        >
          <div className={styles.tooltipName}>{tooltip.ev.childName}</div>
          <div className={styles.tooltipRow}><span className={styles.tooltipLabel}>Acquired by</span><span className={styles.tooltipAccent}>{tooltip.ev.parentName}</span></div>
          {tooltip.ev.rootId !== tooltip.ev.parentId && (
            <div className={styles.tooltipRow}><span className={styles.tooltipLabel}>Root</span><span>{tooltip.ev.rootName}</span></div>
          )}
          <div className={styles.tooltipRow}><span className={styles.tooltipLabel}>Date</span><span>{tooltip.ev.date.toISOString().slice(0, 10)}</span></div>
          <div className={styles.tooltipRow}>
            <span className={styles.tooltipLabel}>Stake</span>
            <span className={tooltip.ev.share < 100 ? styles.tooltipRed : styles.tooltipGreen}>{tooltip.ev.share}%</span>
          </div>
          {tooltip.ev.region && (
            <div className={styles.tooltipRow}><span className={styles.tooltipLabel}>Region</span><span className={styles.tooltipGreen}>{tooltip.ev.region}</span></div>
          )}
          <div className={styles.tooltipHint}>Click to view entity profile →</div>
        </div>
      )}
    </div>
  )
}
