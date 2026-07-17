'use client'

import { useState, useEffect, useCallback, useRef, useMemo } from 'react'

interface EntityOption {
  id: string
  name: string
  type: string
}

interface AlternativeRow {
  id: number
  direction: 'forward' | 'reverse'
  other: EntityOption
  reason: string | null
  directional: boolean
}

const REASON_PRESETS = ['independent', 'small', 'local', 'cooperative', 'ethical', 'B Corp']

const c = {
  bg:            '#ffffff',
  surface:       '#f7f7f8',
  surface2:      '#eef0f3',
  border:        '#d8dbe0',
  text:          '#1a1a1a',
  textMuted:     '#555',
  muted:         '#888',
  accent:        '#0066cc',
  success:       '#0a7a0a',
  successBg:     '#f0faf0',
  successBorder: '#b7dfb7',
  warning:       '#a86b0a',
  danger:        '#c62828',
  dangerBg:      '#fff5f5',
  dangerBorder:  '#f5c6c6',
  selected:      '#fff8dc',
}

const inputBase: React.CSSProperties = {
  width: '100%', padding: '8px 10px', fontSize: 14, boxSizing: 'border-box',
  border: `1px solid ${c.border}`, borderRadius: 4,
  background: c.bg, color: c.text, outline: 'none',
}

// ── Entity autocomplete picker (used by the manual tab) ──────────────────────

function EntityPicker({
  label, placeholder, value, onChange, password, exclude = [],
}: {
  label: string
  placeholder: string
  value: EntityOption | null
  onChange: (e: EntityOption | null) => void
  password: string
  exclude?: string[]
}) {
  const [q, setQ] = useState('')
  const [results, setResults] = useState<EntityOption[]>([])
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  async function search(query: string) {
    if (!query.trim()) { setResults([]); setOpen(false); return }
    setLoading(true)
    try {
      const res = await fetch(
        `/api/admin/alternatives?action=search&q=${encodeURIComponent(query)}&limit=10`,
        { headers: { 'x-admin-password': password } }
      )
      const data = await res.json()
      const filtered = (data.results ?? []).filter((r: EntityOption) => !exclude.includes(r.id))
      setResults(filtered)
      setOpen(filtered.length > 0)
    } finally { setLoading(false) }
  }

  function handleChange(val: string) {
    setQ(val)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => search(val), 220)
  }

  function pick(e: EntityOption) {
    onChange(e)
    setQ(''); setResults([]); setOpen(false)
  }

  function clear() { onChange(null); setQ('') }

  if (value) {
    return (
      <div>
        <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: c.textMuted, marginBottom: 4 }}>{label}</label>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', border: `1px solid ${c.accent}`, borderRadius: 4, background: c.bg }}>
          <span style={{ fontSize: 10, color: c.muted, textTransform: 'uppercase', minWidth: 80 }}>{value.type}</span>
          <span style={{ flex: 1, fontSize: 14, fontWeight: 500 }}>{value.name}</span>
          <button onClick={clear} style={{ background: 'none', border: 'none', cursor: 'pointer', color: c.muted, fontSize: 18, lineHeight: 1, padding: '0 2px' }}>×</button>
        </div>
      </div>
    )
  }

  return (
    <div>
      <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: c.textMuted, marginBottom: 4 }}>{label}</label>
      <div style={{ position: 'relative' }}>
        <input
          value={q}
          onChange={e => handleChange(e.target.value)}
          onFocus={() => q && setOpen(results.length > 0)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          placeholder={placeholder}
          style={inputBase}
        />
        {loading && <span style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', fontSize: 11, color: c.muted }}>...</span>}
        {open && results.length > 0 && (
          <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 50, background: c.bg, border: `1px solid ${c.border}`, borderRadius: 4, boxShadow: '0 4px 12px rgba(0,0,0,0.1)', maxHeight: 220, overflowY: 'auto' }}>
            {results.map(r => (
              <div key={r.id} onMouseDown={() => pick(r)}
                style={{ padding: '8px 12px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8 }}
                onMouseEnter={e => (e.currentTarget.style.background = c.surface)}
                onMouseLeave={e => (e.currentTarget.style.background = '')}>
                <span style={{ fontSize: 10, color: c.muted, textTransform: 'uppercase', minWidth: 80 }}>{r.type}</span>
                <span style={{ fontSize: 14 }}>{r.name}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════════════
// Shell: auth + light-theme override + tab toggle
// ══════════════════════════════════════════════════════════════════════════════

type Tab = 'review' | 'manual'

export default function AlternativesAdminPage() {
  const [password, setPassword] = useState('')
  const [authed, setAuthed]     = useState(false)
  const [authError, setAuthError] = useState('')
  const [tab, setTab] = useState<Tab>('review')

  useEffect(() => {
    document.body.style.background = c.bg
    document.body.style.color = c.text
  }, [])

  useEffect(() => {
    const saved = sessionStorage.getItem('admin_password')
    if (!saved) return
    fetch('/api/admin/auth', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: saved }) })
      .then(res => { if (res.ok) { setPassword(saved); setAuthed(true) } else sessionStorage.removeItem('admin_password') })
  }, [])

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault(); setAuthError('')
    const res = await fetch('/api/admin/auth', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password }) })
    if (res.ok) { setAuthed(true); sessionStorage.setItem('admin_password', password) }
    else setAuthError('Incorrect password')
  }

  if (!authed) {
    return (
      <div style={{ minHeight: '100vh', background: c.bg, color: c.text, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'system-ui, sans-serif' }}>
        <div style={{ width: 360, padding: 24 }}>
          <h1 style={{ fontSize: 20, marginBottom: 16 }}>Admin Login</h1>
          <form onSubmit={handleLogin}>
            <input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="Admin password" autoFocus style={{ ...inputBase, marginBottom: 8 }} />
            {authError && <div style={{ color: c.danger, fontSize: 12, marginBottom: 8 }}>{authError}</div>}
            <button type="submit" style={{ width: '100%', padding: '10px 12px', background: c.accent, color: '#fff', border: 0, borderRadius: 4, fontSize: 14, cursor: 'pointer' }}>Sign in</button>
          </form>
        </div>
      </div>
    )
  }

  return (
    <div style={{ minHeight: '100vh', background: c.bg, color: c.text, fontFamily: 'system-ui, sans-serif' }}>
      <div style={{ maxWidth: tab === 'review' ? 1120 : 720, margin: '0 auto', padding: '28px 24px' }}>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
          <div>
            <h1 style={{ fontSize: 22, margin: 0 }}>Alternatives</h1>
            <div style={{ fontSize: 13, color: c.muted, marginTop: 2 }}>
              {tab === 'review' ? 'Review staged candidate alternatives' : 'Link entities as alternatives to one another'}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <a href="/admin" style={{ fontSize: 13, color: c.accent, textDecoration: 'none' }}>← Admin</a>
            <button onClick={() => { sessionStorage.removeItem('admin_password'); setAuthed(false); setPassword('') }}
              style={{ padding: '5px 10px', fontSize: 12, background: c.bg, color: c.textMuted, border: `1px solid ${c.border}`, borderRadius: 4, cursor: 'pointer' }}>
              Sign out
            </button>
          </div>
        </div>

        {/* Tab toggle */}
        <div style={{ display: 'flex', marginBottom: 24, border: `1px solid ${c.border}`, borderRadius: 4, overflow: 'hidden', width: 'fit-content' }}>
          {(['review', 'manual'] as Tab[]).map(t => (
            <button key={t} onClick={() => setTab(t)}
              style={{
                padding: '8px 20px', fontSize: 13, fontWeight: 500,
                background: tab === t ? c.accent : c.bg,
                color: tab === t ? '#fff' : c.textMuted,
                border: 0, cursor: 'pointer',
              }}>
              {t === 'review' ? 'Review queue' : 'Manual edit'}
            </button>
          ))}
        </div>

        {tab === 'review'
          ? <ReviewQueueTab password={password} />
          : <ManualEditTab password={password} />}
      </div>
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════════════
// Review queue — staged candidate approval
// ══════════════════════════════════════════════════════════════════════════════

interface QueueRow {
  id: number
  entity_id: string
  alternative_id: string
  score: number | null
  generated_reason: string | null
  llm_reason: string | null
  llm_verdict: 'keep' | 'reject' | null
  brand: EntityOption | null
  alt: EntityOption | null
}
interface CategoryOpt { id: string; name: string; level: number; sort_order: number }
interface Stats {
  by_status: { approved: number; pending: number; rejected: number }
  pending_by_verdict: { keep: number; not_enriched: number }
}

const key = (r: { entity_id: string; alternative_id: string }) => `${r.entity_id}|${r.alternative_id}`
const PAGE_SIZE = 100

function ReviewQueueTab({ password }: { password: string }) {
  const [categories, setCategories] = useState<CategoryOpt[]>([])
  const [stats, setStats] = useState<Stats | null>(null)
  const [category, setCategory] = useState('')
  const [verdict, setVerdict] = useState<'all' | 'keep' | 'null'>('all')
  const [page, setPage] = useState(1)

  const [rows, setRows] = useState<QueueRow[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [status, setStatus] = useState<{ msg: string; kind: 'success' | 'error' | 'info' } | null>(null)

  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [focusIndex, setFocusIndex] = useState(0)
  const [editBuf, setEditBuf] = useState<Record<string, string>>({})

  const authHeaders = useMemo(() => ({ 'x-admin-password': password }), [password])

  const loadStats = useCallback(async () => {
    const res = await fetch('/api/admin/alternatives?action=stats', { headers: authHeaders })
    if (res.ok) setStats(await res.json())
  }, [authHeaders])

  const loadQueue = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({ action: 'queue', verdict, page: String(page) })
      if (category) params.set('category', category)
      const res = await fetch(`/api/admin/alternatives?${params}`, { headers: authHeaders })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to load queue')
      setRows(data.rows ?? [])
      setTotal(data.total ?? 0)
      setFocusIndex(0)
    } catch (err: any) {
      setStatus({ msg: err.message, kind: 'error' })
    } finally {
      setLoading(false)
    }
  }, [authHeaders, category, verdict, page])

  // Category list — same source /admin/categorize uses (coverage endpoint).
  useEffect(() => {
    fetch('/api/admin/categorize?action=coverage', { headers: authHeaders })
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d?.coverage) setCategories(d.coverage) })
      .catch(() => {})
  }, [authHeaders])

  useEffect(() => { loadStats() }, [loadStats])
  useEffect(() => { loadQueue() }, [loadQueue])

  // Reset page to 1 when filters change.
  useEffect(() => { setPage(1) }, [category, verdict])

  const categoryOptions = useMemo(() =>
    [...categories].sort((a, b) =>
      (a.level ?? 99) - (b.level ?? 99)
      || (a.sort_order ?? 999) - (b.sort_order ?? 999)
      || (a.name ?? '').localeCompare(b.name ?? '')
    ), [categories])

  // Group rows by brand for display; flat list drives keyboard focus.
  const groups = useMemo(() => {
    const m = new Map<string, QueueRow[]>()
    for (const r of rows) { const a = m.get(r.entity_id) ?? []; a.push(r); m.set(r.entity_id, a) }
    return [...m.entries()]
  }, [rows])
  const flat = useMemo(() => groups.flatMap(([, rs]) => rs), [groups])

  const allVisibleSelected = flat.length > 0 && flat.every(r => selected.has(key(r)))

  function toggle(k: string) {
    setSelected(prev => { const n = new Set(prev); n.has(k) ? n.delete(k) : n.add(k); return n })
  }
  function toggleAllVisible() {
    setSelected(prev => {
      if (flat.every(r => prev.has(key(r)))) return new Set()
      return new Set(flat.map(key))
    })
  }
  function toggleGroup(rs: QueueRow[]) {
    setSelected(prev => {
      const n = new Set(prev)
      const allIn = rs.every(r => n.has(key(r)))
      for (const r of rs) allIn ? n.delete(key(r)) : n.add(key(r))
      return n
    })
  }

  async function mutate(action: 'approve' | 'reject', pairs: { entity_id: string; alternative_id: string }[]) {
    if (pairs.length === 0) return
    if (pairs.length > 25 && !confirm(`${action === 'approve' ? 'Approve' : 'Reject'} ${pairs.length} pairs?`)) return
    setStatus({ msg: `${action === 'approve' ? 'Approving' : 'Rejecting'} ${pairs.length}…`, kind: 'info' })
    try {
      const res = await fetch('/api/admin/alternatives', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: JSON.stringify({ action, pairs }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Request failed')
      setStatus({ msg: `${action === 'approve' ? 'Approved' : 'Rejected'} ${data.changed} of ${data.requested}.`, kind: 'success' })
      setSelected(new Set())
      await Promise.all([loadQueue(), loadStats()])
    } catch (err: any) {
      setStatus({ msg: err.message, kind: 'error' })
    }
  }

  const pairsFor = (keys: string[]) => keys.map(k => { const [entity_id, alternative_id] = k.split('|'); return { entity_id, alternative_id } })

  async function saveReason(r: QueueRow) {
    const next = editBuf[key(r)]
    if (next === undefined || next === (r.llm_reason ?? '')) return
    try {
      const res = await fetch('/api/admin/alternatives', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: JSON.stringify({ action: 'edit_reason', entity_id: r.entity_id, alternative_id: r.alternative_id, reason: next.trim() || null }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Request failed')
      setRows(prev => prev.map(x => x.id === r.id ? { ...x, llm_reason: next.trim() || null } : x))
      setStatus({ msg: 'Reason saved.', kind: 'success' })
    } catch (err: any) {
      setStatus({ msg: err.message, kind: 'error' })
    } finally {
      setEditBuf(prev => { const n = { ...prev }; delete n[key(r)]; return n })
    }
  }

  // Keyboard: j/k move focus, a approve focused, r reject focused.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const t = e.target as HTMLElement
      if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT') return
      if (flat.length === 0) return
      if (e.key === 'j' || e.key === 'ArrowDown') { e.preventDefault(); setFocusIndex(i => Math.min(flat.length - 1, i + 1)) }
      else if (e.key === 'k' || e.key === 'ArrowUp') { e.preventDefault(); setFocusIndex(i => Math.max(0, i - 1)) }
      else if (e.key === 'a') { e.preventDefault(); const r = flat[focusIndex]; if (r) mutate('approve', [{ entity_id: r.entity_id, alternative_id: r.alternative_id }]) }
      else if (e.key === 'r') { e.preventDefault(); const r = flat[focusIndex]; if (r) mutate('reject', [{ entity_id: r.entity_id, alternative_id: r.alternative_id }]) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [flat, focusIndex]) // eslint-disable-line react-hooks/exhaustive-deps

  const nameOf = useMemo(() => new Map(categories.map(c => [c.id, c.name])), [categories])
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  let flatCursor = -1

  return (
    <div>
      {/* Stats bar */}
      {stats && (
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 16 }}>
          <Stat label="Pending" value={stats.by_status.pending} accent={c.warning} />
          <Stat label="· kept by Sonnet" value={stats.pending_by_verdict.keep} accent={c.success} />
          <Stat label="· not yet enriched" value={stats.pending_by_verdict.not_enriched} accent={c.muted} />
          <Stat label="Approved" value={stats.by_status.approved} accent={c.accent} />
          <Stat label="Rejected" value={stats.by_status.rejected} accent={c.danger} />
        </div>
      )}

      {/* Filters */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <div style={{ minWidth: 240 }}>
          <label style={filterLabel}>Category</label>
          <select value={category} onChange={e => setCategory(e.target.value)} style={{ ...inputBase, width: '100%' }}>
            <option value="">All categories</option>
            {categoryOptions.map(cat => (
              <option key={cat.id} value={cat.id}>{' '.repeat(((cat.level ?? 1) - 1) * 2)}{cat.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label style={filterLabel}>Verdict</label>
          <select value={verdict} onChange={e => setVerdict(e.target.value as any)} style={{ ...inputBase, width: 'auto' }}>
            <option value="all">All pending</option>
            <option value="keep">Kept by Sonnet</option>
            <option value="null">Not yet enriched</option>
          </select>
        </div>
      </div>

      {/* Status line */}
      {status && (
        <div style={{
          padding: '10px 14px', marginBottom: 14, borderRadius: 6, fontSize: 13,
          background: status.kind === 'error' ? c.dangerBg : status.kind === 'success' ? c.successBg : '#e3f2fd',
          color: status.kind === 'error' ? c.danger : status.kind === 'success' ? c.success : c.accent,
          border: `1px solid ${status.kind === 'error' ? c.dangerBorder : status.kind === 'success' ? c.successBorder : '#bbdefb'}`,
        }}>{status.msg}</div>
      )}

      {loading ? (
        <div style={{ padding: 40, textAlign: 'center', color: c.muted }}>Loading…</div>
      ) : flat.length === 0 ? (
        <div style={{ padding: 32, border: `1px solid ${c.border}`, borderRadius: 8, background: c.surface, fontSize: 14, color: c.textMuted }}>
          <div style={{ fontWeight: 600, color: c.text, marginBottom: 6 }}>No pending candidates{(category || verdict !== 'all') ? ' for this filter' : ''}.</div>
          <div style={{ fontSize: 13 }}>
            Generate more with the <code>generate_alternative_candidates()</code> SQL function, then enrich them with{' '}
            <code>scripts/enrich-alternatives.mjs</code> before they show up here.
          </div>
        </div>
      ) : (
        <>
          {/* Select-all-visible header */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', marginBottom: 8, fontSize: 12, color: c.textMuted }}>
            <input type="checkbox" checked={allVisibleSelected} onChange={toggleAllVisible} />
            <span>Select all {flat.length} on this page</span>
            <span style={{ marginLeft: 'auto', fontFamily: 'monospace', fontSize: 11 }}>j/k focus · a approve · r reject</span>
          </div>

          {/* Grouped rows */}
          {groups.map(([entityId, rs]) => {
            const brandName = rs[0].brand?.name ?? entityId
            const groupAll = rs.every(r => selected.has(key(r)))
            return (
              <div key={entityId} style={{ marginBottom: 14, border: `1px solid ${c.border}`, borderRadius: 8, overflow: 'hidden' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', background: c.surface, borderBottom: `1px solid ${c.border}` }}>
                  <input type="checkbox" checked={groupAll} onChange={() => toggleGroup(rs)} />
                  <a href={`/entity/${entityId}`} target="_blank" rel="noreferrer" style={{ fontSize: 14, fontWeight: 600, color: c.text, textDecoration: 'none' }}>{brandName}</a>
                  <span style={{ fontSize: 11, color: c.muted }}>{rs.length} alternative{rs.length === 1 ? '' : 's'}</span>
                </div>
                {rs.map(r => {
                  flatCursor++
                  const k = key(r)
                  const focused = flatCursor === focusIndex
                  const notEnriched = r.llm_verdict == null
                  const buf = editBuf[k] ?? (r.llm_reason ?? '')
                  return (
                    <div key={r.id} style={{
                      display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px',
                      borderTop: `1px solid ${c.surface2}`,
                      background: selected.has(k) ? c.selected : focused ? '#eef5ff' : notEnriched ? '#fcfbf7' : c.bg,
                    }}>
                      <input type="checkbox" checked={selected.has(k)} onChange={() => toggle(k)} />
                      <a href={`/entity/${r.alternative_id}`} target="_blank" rel="noreferrer" style={{ minWidth: 170, fontSize: 14, color: c.text, textDecoration: 'none', fontWeight: 500 }}>
                        {r.alt?.name ?? r.alternative_id}
                        <span style={{ fontSize: 10, color: c.muted, textTransform: 'uppercase', marginLeft: 6 }}>{r.alt?.type}</span>
                      </a>
                      <span title="score" style={{ fontSize: 12, fontFamily: 'monospace', color: c.textMuted, minWidth: 30 }}>{r.score ?? '—'}</span>
                      {r.generated_reason && (
                        <span title="generated_reason" style={{ fontSize: 11, padding: '2px 8px', background: c.surface2, borderRadius: 3, color: c.textMuted, whiteSpace: 'nowrap' }}>
                          {r.generated_reason}
                        </span>
                      )}
                      <input
                        value={buf}
                        placeholder="llm_reason (editable)…"
                        onChange={e => setEditBuf(prev => ({ ...prev, [k]: e.target.value }))}
                        onBlur={() => saveReason(r)}
                        onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
                        style={{ ...inputBase, flex: 1, minWidth: 160, padding: '5px 8px', fontSize: 12 }}
                      />
                      {notEnriched
                        ? <span style={{ fontSize: 10, padding: '2px 8px', background: '#f2efe6', borderRadius: 3, color: c.warning, whiteSpace: 'nowrap' }}>not enriched</span>
                        : <span style={{ fontSize: 10, padding: '2px 8px', background: c.successBg, border: `1px solid ${c.successBorder}`, borderRadius: 3, color: c.success }}>keep</span>}
                      <button onClick={() => mutate('approve', [{ entity_id: r.entity_id, alternative_id: r.alternative_id }])}
                        style={{ padding: '4px 10px', fontSize: 12, background: c.accent, color: '#fff', border: 0, borderRadius: 4, cursor: 'pointer' }}>Approve</button>
                      <button onClick={() => mutate('reject', [{ entity_id: r.entity_id, alternative_id: r.alternative_id }])}
                        style={{ padding: '4px 10px', fontSize: 12, background: 'none', color: c.danger, border: `1px solid ${c.dangerBorder}`, borderRadius: 4, cursor: 'pointer' }}>Reject</button>
                    </div>
                  )
                })}
              </div>
            )
          })}

          {/* Pagination */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 12, fontSize: 13, color: c.textMuted }}>
            <button disabled={page <= 1} onClick={() => setPage(p => Math.max(1, p - 1))}
              style={{ padding: '6px 12px', fontSize: 13, background: c.bg, color: page <= 1 ? c.muted : c.text, border: `1px solid ${c.border}`, borderRadius: 4, cursor: page <= 1 ? 'not-allowed' : 'pointer' }}>← Prev</button>
            <span>Page {page} of {totalPages} · {total} pending{category ? ` in ${nameOf.get(category) ?? category}` : ''}</span>
            <button disabled={page >= totalPages} onClick={() => setPage(p => Math.min(totalPages, p + 1))}
              style={{ padding: '6px 12px', fontSize: 13, background: c.bg, color: page >= totalPages ? c.muted : c.text, border: `1px solid ${c.border}`, borderRadius: 4, cursor: page >= totalPages ? 'not-allowed' : 'pointer' }}>Next →</button>
          </div>
        </>
      )}

      {/* Sticky action bar */}
      {selected.size > 0 && (
        <div style={{
          position: 'sticky', bottom: 0, marginTop: 16, padding: '12px 16px',
          display: 'flex', alignItems: 'center', gap: 12,
          background: c.text, color: '#fff', borderRadius: 8, boxShadow: '0 -2px 12px rgba(0,0,0,0.15)',
        }}>
          <span style={{ fontSize: 14, fontWeight: 500 }}>{selected.size} selected</span>
          <button onClick={() => mutate('approve', pairsFor([...selected]))}
            style={{ marginLeft: 'auto', padding: '8px 18px', fontSize: 14, fontWeight: 600, background: c.accent, color: '#fff', border: 0, borderRadius: 4, cursor: 'pointer' }}>
            Approve selected ({selected.size})
          </button>
          <button onClick={() => mutate('reject', pairsFor([...selected]))}
            style={{ padding: '8px 18px', fontSize: 14, fontWeight: 600, background: c.danger, color: '#fff', border: 0, borderRadius: 4, cursor: 'pointer' }}>
            Reject selected ({selected.size})
          </button>
          <button onClick={() => setSelected(new Set())}
            style={{ padding: '8px 12px', fontSize: 13, background: 'transparent', color: 'rgba(255,255,255,0.7)', border: '1px solid rgba(255,255,255,0.3)', borderRadius: 4, cursor: 'pointer' }}>
            Clear
          </button>
        </div>
      )}
    </div>
  )
}

function Stat({ label, value, accent }: { label: string; value: number; accent: string }) {
  return (
    <div style={{ padding: '8px 14px', border: `1px solid ${c.border}`, borderRadius: 6, background: c.surface, minWidth: 90 }}>
      <div style={{ fontSize: 20, fontWeight: 600, color: accent }}>{value.toLocaleString()}</div>
      <div style={{ fontSize: 11, color: c.textMuted }}>{label}</div>
    </div>
  )
}

const filterLabel: React.CSSProperties = {
  display: 'block', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.1em',
  color: c.textMuted, marginBottom: 6, fontWeight: 600,
}

// ══════════════════════════════════════════════════════════════════════════════
// Manual edit — the original per-entity add/remove tool (unchanged behavior)
// ══════════════════════════════════════════════════════════════════════════════

function ManualEditTab({ password }: { password: string }) {
  const [subject, setSubject]   = useState<EntityOption | null>(null)
  const [rows, setRows]         = useState<AlternativeRow[]>([])
  const [loadingRows, setLoadingRows] = useState(false)
  const [chain, setChain] = useState<EntityOption[]>([])
  const [suggestions, setSuggestions]           = useState<EntityOption[]>([])
  const [loadingSuggestions, setLoadingSuggestions] = useState(false)
  const [altEntity, setAltEntity]     = useState<EntityOption | null>(null)
  const [reason, setReason]           = useState('')
  const [directional, setDirectional] = useState(false)
  const [submitting, setSubmitting]   = useState(false)
  const [status, setStatus]           = useState<{ msg: string; kind: 'success' | 'error' } | null>(null)

  const loadRows = useCallback(async (entityId: string) => {
    setLoadingRows(true)
    try {
      const res = await fetch(`/api/admin/alternatives?action=list&entity_id=${entityId}`, {
        headers: { 'x-admin-password': password },
      })
      const data = await res.json()
      setRows(data.rows ?? [])
    } finally { setLoadingRows(false) }
  }, [password])

  const loadSuggestions = useCallback(async (entityId: string, excludeIds: string[]) => {
    setLoadingSuggestions(true)
    try {
      const exclude = excludeIds.join(',')
      const res = await fetch(
        `/api/admin/alternatives?action=suggestions&entity_id=${entityId}&exclude=${encodeURIComponent(exclude)}`,
        { headers: { 'x-admin-password': password } }
      )
      const data = await res.json()
      setSuggestions(data.suggestions ?? [])
    } finally { setLoadingSuggestions(false) }
  }, [password])

  useEffect(() => {
    if (subject) {
      loadRows(subject.id)
      setSuggestions([])
      setChain([])
      fetch(`/api/admin/alternatives?action=chain&entity_id=${subject.id}`, {
        headers: { 'x-admin-password': password },
      }).then(r => r.json()).then(d => setChain(d.chain ?? []))
    } else {
      setRows([])
      setSuggestions([])
      setChain([])
    }
  }, [subject, loadRows, password])

  useEffect(() => {
    if (!subject) return
    const excludeIds = [subject.id, ...rows.map(r => r.other.id)]
    loadSuggestions(subject.id, excludeIds)
  }, [subject, rows, loadSuggestions])

  async function addAlternative(altId: string, altName: string, altReason: string, isDirectional: boolean) {
    if (!subject) return
    setStatus(null)
    try {
      const res = await fetch('/api/admin/alternatives', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-admin-password': password },
        body: JSON.stringify({
          action: 'add',
          entity_id: subject.id,
          alternative_id: altId,
          reason: altReason.trim() || null,
          directional: isDirectional,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Request failed')
      setStatus({ msg: `Added ${altName} as an alternative`, kind: 'success' })
      loadRows(subject.id)
    } catch (err: any) {
      setStatus({ msg: err.message, kind: 'error' })
    }
  }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault()
    if (!subject || !altEntity || submitting) return
    setSubmitting(true)
    await addAlternative(altEntity.id, altEntity.name, reason, directional)
    setAltEntity(null); setReason(''); setDirectional(false)
    setSubmitting(false)
  }

  async function handleRemove(id: number) {
    setStatus(null)
    try {
      const res = await fetch('/api/admin/alternatives', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-admin-password': password },
        body: JSON.stringify({ action: 'remove', id }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Request failed')
      setRows(prev => prev.filter(r => r.id !== id))
      setStatus({ msg: 'Removed', kind: 'success' })
    } catch (err: any) {
      setStatus({ msg: err.message, kind: 'error' })
    }
  }

  const excludeIds = subject ? [subject.id, ...rows.map(r => r.other.id)] : []

  return (
    <>
      {/* Subject picker */}
      <div style={{ background: c.surface, border: `1px solid ${c.border}`, borderRadius: 8, padding: 20, marginBottom: chain.length > 1 ? 0 : 20, borderBottomLeftRadius: chain.length > 1 ? 0 : 8, borderBottomRightRadius: chain.length > 1 ? 0 : 8 }}>
        <EntityPicker
          label="Entity"
          placeholder="Search for an entity..."
          value={subject}
          onChange={e => { setSubject(e); setAltEntity(null); setStatus(null) }}
          password={password}
        />
      </div>

      {/* Ownership breadcrumbs */}
      {chain.length > 1 && (
        <div style={{
          display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 4,
          padding: '8px 16px', marginBottom: 20,
          background: c.surface2, border: `1px solid ${c.border}`,
          borderTop: 'none', borderBottomLeftRadius: 8, borderBottomRightRadius: 8,
          fontSize: 12, color: c.muted,
        }}>
          {chain.map((node, i) => {
            const isCurrent = i === chain.length - 1
            return (
              <span key={node.id} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                {i > 0 && <span style={{ color: c.border, fontSize: 14 }}>›</span>}
                <a href={`/entity/${node.id}`} target="_blank" rel="noreferrer"
                  style={{ color: isCurrent ? c.text : c.textMuted, fontWeight: isCurrent ? 600 : 400, textDecoration: 'none' }}>
                  {node.name}
                </a>
              </span>
            )
          })}
        </div>
      )}

      {subject && (
        <>
          {status && (
            <div style={{
              padding: '10px 14px', marginBottom: 16, borderRadius: 6, fontSize: 13,
              background: status.kind === 'success' ? c.successBg : c.dangerBg,
              color: status.kind === 'success' ? c.success : c.danger,
              border: `1px solid ${status.kind === 'success' ? c.successBorder : c.dangerBorder}`,
            }}>
              {status.msg}
            </div>
          )}

          {(loadingSuggestions || suggestions.length > 0) && (
            <div style={{ background: '#fffbea', border: '1px solid #f0d070', borderRadius: 8, padding: 20, marginBottom: 20 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: '#7a6010', marginBottom: 12 }}>
                Suggested from same category
                {!loadingSuggestions && <span style={{ fontWeight: 400, color: '#a08030', marginLeft: 6 }}>({suggestions.length})</span>}
              </div>
              {loadingSuggestions ? (
                <div style={{ fontSize: 13, color: c.muted }}>Loading...</div>
              ) : (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {suggestions.map(s => (
                    <button key={s.id} onClick={() => setAltEntity(s)}
                      style={{
                        padding: '5px 12px', fontSize: 13, cursor: 'pointer',
                        background: altEntity?.id === s.id ? c.accent : c.bg,
                        color: altEntity?.id === s.id ? '#fff' : c.text,
                        border: `1px solid ${altEntity?.id === s.id ? c.accent : c.border}`,
                        borderRadius: 4,
                      }}>
                      <span style={{ fontSize: 10, color: altEntity?.id === s.id ? 'rgba(255,255,255,0.7)' : c.muted, textTransform: 'uppercase', marginRight: 6 }}>{s.type}</span>
                      {s.name}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          <div style={{ background: c.surface, border: `1px solid ${c.border}`, borderRadius: 8, padding: 20, marginBottom: 20 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: c.textMuted, marginBottom: 14 }}>
              Current alternatives for <strong style={{ color: c.text }}>{subject.name}</strong>
              {rows.length > 0 && <span style={{ fontWeight: 400, color: c.muted, marginLeft: 6 }}>({rows.length})</span>}
            </div>

            {loadingRows ? (
              <div style={{ fontSize: 13, color: c.muted, padding: '12px 0' }}>Loading...</div>
            ) : rows.length === 0 ? (
              <div style={{ fontSize: 13, color: c.muted, padding: '12px 0' }}>No alternatives yet.</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {rows.map(row => (
                  <div key={row.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', background: c.bg, border: `1px solid ${c.border}`, borderRadius: 6 }}>
                    <span style={{ fontSize: 10, color: c.muted, textTransform: 'uppercase', minWidth: 80 }}>{row.other.type}</span>
                    <a href={`/entity/${row.other.id}`} target="_blank" rel="noreferrer"
                      style={{ flex: 1, fontSize: 14, color: c.text, textDecoration: 'none', fontWeight: 500 }}>
                      {row.other.name}
                    </a>
                    {row.reason && (
                      <span style={{ fontSize: 11, padding: '2px 8px', background: c.surface2, borderRadius: 3, color: c.textMuted }}>{row.reason}</span>
                    )}
                    {row.directional && (
                      <span style={{ fontSize: 11, padding: '2px 8px', background: '#fff4e0', borderRadius: 3, color: '#a86b0a' }}>one-way</span>
                    )}
                    {row.direction === 'reverse' && (
                      <span style={{ fontSize: 11, padding: '2px 8px', background: c.surface2, borderRadius: 3, color: c.muted }}>via reverse</span>
                    )}
                    {row.direction === 'forward' && (
                      <button onClick={() => handleRemove(row.id)}
                        style={{ padding: '3px 10px', fontSize: 12, background: 'none', color: c.danger, border: `1px solid ${c.dangerBorder}`, borderRadius: 4, cursor: 'pointer' }}>
                        Remove
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          <div style={{ background: c.surface, border: `1px solid ${c.border}`, borderRadius: 8, padding: 20 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: c.textMuted, marginBottom: 14 }}>Add alternative</div>
            <form onSubmit={handleAdd} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <EntityPicker
                label="Alternative entity *"
                placeholder="Search, or click a suggestion above..."
                value={altEntity}
                onChange={setAltEntity}
                password={password}
                exclude={excludeIds}
              />

              <div>
                <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: c.textMuted, marginBottom: 4 }}>
                  Reason <span style={{ fontWeight: 400, color: c.muted }}>(optional label shown on the entity page)</span>
                </label>
                <input value={reason} onChange={e => setReason(e.target.value)}
                  placeholder="e.g. independent, local, cooperative..." style={inputBase} list="reason-presets" />
                <datalist id="reason-presets">
                  {REASON_PRESETS.map(r => <option key={r} value={r} />)}
                </datalist>
              </div>

              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer', color: c.textMuted }}>
                <input type="checkbox" checked={directional} onChange={e => setDirectional(e.target.checked)} />
                <span>One-way <span style={{ color: c.muted }}>(show on {subject.name}'s page only, not the reverse)</span></span>
              </label>

              <div style={{ paddingTop: 4, borderTop: `1px solid ${c.border}` }}>
                <button type="submit" disabled={!altEntity || submitting}
                  style={{
                    padding: '9px 20px',
                    background: altEntity ? c.accent : c.surface2,
                    color: altEntity ? '#fff' : c.muted,
                    border: 0, borderRadius: 4, fontSize: 14,
                    cursor: altEntity ? 'pointer' : 'not-allowed', fontWeight: 500,
                  }}>
                  {submitting ? 'Adding...' : 'Add alternative'}
                </button>
              </div>
            </form>
          </div>
        </>
      )}
    </>
  )
}
