'use client'

import { useState, useEffect, useCallback, useRef } from 'react'

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
  danger:        '#c62828',
  dangerBg:      '#fff5f5',
  dangerBorder:  '#f5c6c6',
}

const inputBase: React.CSSProperties = {
  width: '100%', padding: '8px 10px', fontSize: 14, boxSizing: 'border-box',
  border: `1px solid ${c.border}`, borderRadius: 4,
  background: c.bg, color: c.text, outline: 'none',
}

// ── Entity autocomplete picker ───────────────────────────────────────────────

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

// ── Main page ────────────────────────────────────────────────────────────────

export default function AlternativesAdminPage() {
  const [password, setPassword] = useState('')
  const [authed, setAuthed]     = useState(false)
  const [authError, setAuthError] = useState('')

  const [subject, setSubject]   = useState<EntityOption | null>(null)
  const [rows, setRows]         = useState<AlternativeRow[]>([])
  const [loadingRows, setLoadingRows] = useState(false)

  // Ownership chain breadcrumbs
  const [chain, setChain] = useState<EntityOption[]>([])

  // Suggestions from same category
  const [suggestions, setSuggestions]           = useState<EntityOption[]>([])
  const [loadingSuggestions, setLoadingSuggestions] = useState(false)

  // Add form state
  const [altEntity, setAltEntity]     = useState<EntityOption | null>(null)
  const [reason, setReason]           = useState('')
  const [directional, setDirectional] = useState(false)
  const [submitting, setSubmitting]   = useState(false)
  const [status, setStatus]           = useState<{ msg: string; kind: 'success' | 'error' } | null>(null)

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
    if (subject && authed) {
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
  }, [subject, authed, loadRows, password])

  // Reload suggestions whenever rows change (so newly-added alternatives are excluded)
  useEffect(() => {
    if (!subject || !authed) return
    const excludeIds = [subject.id, ...rows.map(r => r.other.id)]
    loadSuggestions(subject.id, excludeIds)
  }, [subject, authed, rows, loadSuggestions])

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

  const excludeIds = subject ? [subject.id, ...rows.map(r => r.other.id)] : []

  return (
    <div style={{ minHeight: '100vh', background: c.bg, color: c.text, fontFamily: 'system-ui, sans-serif' }}>
      <div style={{ maxWidth: 720, margin: '0 auto', padding: '28px 24px' }}>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 28 }}>
          <div>
            <h1 style={{ fontSize: 22, margin: 0 }}>Alternatives</h1>
            <div style={{ fontSize: 13, color: c.muted, marginTop: 2 }}>Link entities as alternatives to one another</div>
          </div>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <a href="/admin" style={{ fontSize: 13, color: c.accent, textDecoration: 'none' }}>← Admin</a>
            <button onClick={() => { sessionStorage.removeItem('admin_password'); setAuthed(false); setPassword('') }}
              style={{ padding: '5px 10px', fontSize: 12, background: c.bg, color: c.textMuted, border: `1px solid ${c.border}`, borderRadius: 4, cursor: 'pointer' }}>
              Sign out
            </button>
          </div>
        </div>

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
                  <a
                    href={`/entity/${node.id}`}
                    target="_blank"
                    rel="noreferrer"
                    style={{
                      color: isCurrent ? c.text : c.textMuted,
                      fontWeight: isCurrent ? 600 : 400,
                      textDecoration: 'none',
                    }}
                  >
                    {node.name}
                  </a>
                </span>
              )
            })}
          </div>
        )}

        {subject && (
          <>
            {/* Status */}
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

            {/* Suggestions from same category */}
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
                      <button
                        key={s.id}
                        onClick={() => setAltEntity(s)}
                        style={{
                          padding: '5px 12px', fontSize: 13, cursor: 'pointer',
                          background: altEntity?.id === s.id ? c.accent : c.bg,
                          color: altEntity?.id === s.id ? '#fff' : c.text,
                          border: `1px solid ${altEntity?.id === s.id ? c.accent : c.border}`,
                          borderRadius: 4,
                        }}
                      >
                        <span style={{ fontSize: 10, color: altEntity?.id === s.id ? 'rgba(255,255,255,0.7)' : c.muted, textTransform: 'uppercase', marginRight: 6 }}>{s.type}</span>
                        {s.name}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Current alternatives */}
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

            {/* Add alternative */}
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
                  <input
                    value={reason}
                    onChange={e => setReason(e.target.value)}
                    placeholder="e.g. independent, local, cooperative..."
                    style={inputBase}
                    list="reason-presets"
                  />
                  <datalist id="reason-presets">
                    {REASON_PRESETS.map(r => <option key={r} value={r} />)}
                  </datalist>
                </div>

                <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer', color: c.textMuted }}>
                  <input type="checkbox" checked={directional} onChange={e => setDirectional(e.target.checked)} />
                  <span>
                    One-way <span style={{ color: c.muted }}>(show on {subject.name}'s page only, not the reverse)</span>
                  </span>
                </label>

                <div style={{ paddingTop: 4, borderTop: `1px solid ${c.border}` }}>
                  <button
                    type="submit"
                    disabled={!altEntity || submitting}
                    style={{
                      padding: '9px 20px',
                      background: altEntity ? c.accent : c.surface2,
                      color: altEntity ? '#fff' : c.muted,
                      border: 0, borderRadius: 4, fontSize: 14,
                      cursor: altEntity ? 'pointer' : 'not-allowed',
                      fontWeight: 500,
                    }}>
                    {submitting ? 'Adding...' : 'Add alternative'}
                  </button>
                </div>
              </form>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
