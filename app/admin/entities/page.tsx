'use client'

import { useState, useEffect, useMemo } from 'react'

interface Entity {
  id: string
  name: string
  type: string
  child_count: number
}

interface ParentOption {
  id: string
  name: string
  type: string
}

// Force light theme for admin — distinct from public-facing dark UI
const colors = {
  bg:        '#ffffff',
  surface:   '#f7f7f8',
  surface2:  '#eef0f3',
  border:    '#d8dbe0',
  text:      '#1a1a1a',
  textMuted: '#555',
  muted:     '#888',
  accent:    '#0066cc',
  success:   '#0a7a0a',
  warning:   '#a86b0a',
  danger:    '#c62828',
  selected:  '#fff8dc',
}

export default function AdminPage() {
  // ── Auth state ─────────────────────────────────────────────────────────
  const [password, setPassword] = useState('')
  const [authed, setAuthed] = useState(false)
  const [authError, setAuthError] = useState('')

  // ── Data state ─────────────────────────────────────────────────────────
  const [conglomerates, setConglomerates] = useState<ParentOption[]>([])
  const [allEntities, setAllEntities] = useState<ParentOption[]>([])
  const [selectedConglomerateId, setSelectedConglomerateId] = useState<string>('')
  const [entities, setEntities] = useState<Entity[]>([])
  const [loading, setLoading] = useState(false)

  // ── UI state ───────────────────────────────────────────────────────────
  const [filter, setFilter] = useState('')
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [reparentTarget, setReparentTarget] = useState('')
  const [reparentNewType, setReparentNewType] = useState('product')
  const [status, setStatus] = useState<{ msg: string; kind: 'info' | 'success' | 'error' } | null>(null)

  // ── Force light theme on body while this page is mounted ───────────────
  useEffect(() => {
    const prevBg = document.body.style.background
    const prevColor = document.body.style.color
    document.body.style.background = colors.bg
    document.body.style.color = colors.text
    return () => {
      document.body.style.background = prevBg
      document.body.style.color = prevColor
    }
  }, [])

  // ── Auth handler ───────────────────────────────────────────────────────
  async function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    setAuthError('')
    const res = await fetch('/api/admin/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    })
    if (res.ok) {
      setAuthed(true)
      sessionStorage.setItem('admin_password', password)
    } else {
      setAuthError('Incorrect password')
    }
  }

  useEffect(() => {
    const saved = sessionStorage.getItem('admin_password')
    if (saved) {
      fetch('/api/admin/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: saved }),
      }).then(res => {
        if (res.ok) {
          setPassword(saved)
          setAuthed(true)
        } else {
          sessionStorage.removeItem('admin_password')
        }
      })
    }
  }, [])

  // ── Load conglomerates list on auth ────────────────────────────────────
  useEffect(() => {
    if (!authed) return
    fetch('/api/admin/entities?list=parents', {
      headers: { 'x-admin-password': password },
    })
      .then(r => r.json())
      .then(data => {
        setConglomerates(data.conglomerates || [])
        setAllEntities(data.allEntities || [])
        if (data.conglomerates?.length) {
          setSelectedConglomerateId(data.conglomerates[0].id)
        }
      })
  }, [authed, password])

  // ── Load entities for the selected conglomerate ────────────────────────
  useEffect(() => {
    if (!authed || !selectedConglomerateId) return
    loadEntities()
  }, [authed, selectedConglomerateId])

  async function loadEntities() {
    setLoading(true)
    setSelectedIds(new Set())
    try {
      const res = await fetch(`/api/admin/entities?parent=${encodeURIComponent(selectedConglomerateId)}`, {
        headers: { 'x-admin-password': password },
      })
      const data = await res.json()
      setEntities(data.entities || [])
    } catch (err: any) {
      setStatus({ msg: 'Failed to load entities: ' + err.message, kind: 'error' })
    } finally {
      setLoading(false)
    }
  }

  const filteredEntities = useMemo(() => {
    if (!filter) return entities
    const f = filter.toLowerCase()
    return entities.filter(
      e => e.name.toLowerCase().includes(f) || e.id.toLowerCase().includes(f)
    )
  }, [entities, filter])

  function toggleSelectAll() {
    if (selectedIds.size === filteredEntities.length) {
      setSelectedIds(new Set())
    } else {
      setSelectedIds(new Set(filteredEntities.map(e => e.id)))
    }
  }

  function toggleSelect(id: string) {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function handleReparent() {
    if (!selectedIds.size || !reparentTarget) return
    if (!confirm(`Move ${selectedIds.size} entit${selectedIds.size === 1 ? 'y' : 'ies'} under "${reparentTarget}" and change type to "${reparentNewType}"?`)) return

    setStatus({ msg: 'Reparenting...', kind: 'info' })
    try {
      const res = await fetch('/api/admin/actions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-admin-password': password },
        body: JSON.stringify({
          action: 'reparent',
          entity_ids: [...selectedIds],
          old_parent_id: selectedConglomerateId,
          new_parent_id: reparentTarget,
          new_type: reparentNewType,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Request failed')
      setStatus({ msg: `✓ Reparented ${data.updated} entit${data.updated === 1 ? 'y' : 'ies'} under "${reparentTarget}"`, kind: 'success' })
      await loadEntities()
      setReparentTarget('')
    } catch (err: any) {
      setStatus({ msg: 'Error: ' + err.message, kind: 'error' })
    }
  }

  async function handleDelete() {
    if (!selectedIds.size) return
    if (!confirm(`Delete ${selectedIds.size} entit${selectedIds.size === 1 ? 'y' : 'ies'} permanently? This also removes their ownership edges.`)) return

    setStatus({ msg: 'Deleting...', kind: 'info' })
    try {
      const res = await fetch('/api/admin/actions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-admin-password': password },
        body: JSON.stringify({
          action: 'delete',
          entity_ids: [...selectedIds],
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Request failed')
      setStatus({ msg: `✓ Deleted ${data.deleted} entit${data.deleted === 1 ? 'y' : 'ies'}`, kind: 'success' })
      await loadEntities()
    } catch (err: any) {
      setStatus({ msg: 'Error: ' + err.message, kind: 'error' })
    }
  }

  const inputStyle = {
    background: colors.bg,
    color: colors.text,
    border: `1px solid ${colors.border}`,
    borderRadius: 4,
    outline: 'none',
    boxSizing: 'border-box' as const,
  }

  // ── Render login screen ────────────────────────────────────────────────
  if (!authed) {
    return (
      <div style={{
        minHeight: '100vh',
        background: colors.bg,
        color: colors.text,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: 'system-ui, sans-serif',
      }}>
        <div style={{ width: 360, padding: 24 }}>
          <h1 style={{ fontSize: 20, marginBottom: 16, color: colors.text }}>Admin Login</h1>
          <form onSubmit={handleLogin}>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="Admin password"
              autoFocus
              style={{ ...inputStyle, width: '100%', padding: '10px 12px', fontSize: 14 }}
            />
            {authError && <div style={{ color: colors.danger, fontSize: 12, marginTop: 6 }}>{authError}</div>}
            <button
              type="submit"
              style={{
                marginTop: 12,
                width: '100%',
                padding: '10px 12px',
                background: colors.accent,
                color: '#fff',
                border: 0,
                borderRadius: 4,
                fontSize: 14,
                cursor: 'pointer',
                fontWeight: 500,
              }}
            >
              Sign in
            </button>
          </form>
        </div>
      </div>
    )
  }

  const allSelected = filteredEntities.length > 0 && filteredEntities.every(e => selectedIds.has(e.id))
  const currentConglomerate = conglomerates.find(c => c.id === selectedConglomerateId)

  return (
    <div style={{
      minHeight: '100vh',
      background: colors.bg,
      color: colors.text,
      fontFamily: 'system-ui, sans-serif',
    }}>
      <div style={{ maxWidth: 1100, margin: '0 auto', padding: 24 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <h1 style={{ fontSize: 22, margin: 0, color: colors.text }}>Entity Admin</h1>
          <button
            onClick={() => {
              sessionStorage.removeItem('admin_password')
              setAuthed(false)
              setPassword('')
            }}
            style={{
              padding: '6px 12px',
              fontSize: 12,
              background: colors.bg,
              color: colors.textMuted,
              border: `1px solid ${colors.border}`,
              borderRadius: 4,
              cursor: 'pointer',
            }}
          >
            Sign out
          </button>
        </div>

        {/* Conglomerate picker */}
        <div style={{ marginBottom: 20, padding: 16, background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: 4 }}>
          <label style={{ display: 'block', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.1em', color: colors.textMuted, marginBottom: 6, fontWeight: 600 }}>Conglomerate</label>
          <select
            value={selectedConglomerateId}
            onChange={e => setSelectedConglomerateId(e.target.value)}
            style={{ ...inputStyle, padding: '8px 10px', fontSize: 14, minWidth: 300 }}
          >
            {conglomerates.map(c => (
              <option key={c.id} value={c.id}>
                {c.name} ({c.id})
              </option>
            ))}
          </select>
          {currentConglomerate && (
            <span style={{ marginLeft: 12, fontSize: 13, color: colors.textMuted }}>
              {entities.length} direct children
            </span>
          )}
        </div>

        {/* Filter */}
        <div style={{ marginBottom: 16 }}>
          <input
            type="text"
            value={filter}
            onChange={e => setFilter(e.target.value)}
            placeholder="Filter by name or slug (e.g. 'cadbury', 'purina')"
            style={{ ...inputStyle, width: '100%', padding: '10px 12px', fontSize: 14, marginBottom: 8 }}
          />
          <div style={{ fontSize: 12, color: colors.textMuted }}>
            Showing {filteredEntities.length} of {entities.length}
            {selectedIds.size > 0 && <> — <strong style={{ color: colors.accent }}>{selectedIds.size} selected</strong></>}
          </div>
        </div>

        {/* Bulk action bar */}
        {selectedIds.size > 0 && (
          <div style={{
            padding: 16,
            background: '#fffbea',
            border: `1px solid ${colors.warning}`,
            borderRadius: 4,
            marginBottom: 16,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              <strong style={{ color: colors.warning }}>{selectedIds.size} selected:</strong>
              <input
                type="text"
                list="parent-options"
                value={reparentTarget}
                onChange={e => setReparentTarget(e.target.value)}
                placeholder="Move under... (type to search, e.g. 'cadbury')"
                style={{ ...inputStyle, flex: 1, minWidth: 200, padding: '6px 10px', fontSize: 13 }}
              />
              <datalist id="parent-options">
                {allEntities.map(e => (
                  <option key={e.id} value={e.id}>{e.name} ({e.type})</option>
                ))}
              </datalist>
              <select
                value={reparentNewType}
                onChange={e => setReparentNewType(e.target.value)}
                style={{ ...inputStyle, padding: '6px 10px', fontSize: 13 }}
              >
                <option value="product">Change type to: product</option>
                <option value="brand">Change type to: brand</option>
                <option value="subsidiary">Change type to: subsidiary</option>
                <option value="__keep__">Keep existing type</option>
              </select>
              <button
                onClick={handleReparent}
                disabled={!reparentTarget}
                style={{
                  padding: '6px 14px',
                  background: colors.accent,
                  color: '#fff',
                  border: 0,
                  borderRadius: 4,
                  fontSize: 13,
                  cursor: reparentTarget ? 'pointer' : 'not-allowed',
                  opacity: reparentTarget ? 1 : 0.4,
                  fontWeight: 500,
                }}
              >
                Reparent selected
              </button>
              <button
                onClick={handleDelete}
                style={{
                  padding: '6px 14px',
                  background: colors.danger,
                  color: '#fff',
                  border: 0,
                  borderRadius: 4,
                  fontSize: 13,
                  cursor: 'pointer',
                  fontWeight: 500,
                }}
              >
                Delete selected
              </button>
              <button
                onClick={() => setSelectedIds(new Set())}
                style={{
                  padding: '6px 14px',
                  background: colors.bg,
                  color: colors.textMuted,
                  border: `1px solid ${colors.border}`,
                  borderRadius: 4,
                  fontSize: 13,
                  cursor: 'pointer',
                }}
              >
                Clear
              </button>
            </div>
          </div>
        )}

        {/* Status message */}
        {status && (
          <div
            style={{
              padding: 10,
              marginBottom: 16,
              borderRadius: 4,
              fontSize: 13,
              background:
                status.kind === 'error' ? '#fdeaea' :
                status.kind === 'success' ? '#e8f5e9' :
                '#e3f2fd',
              color:
                status.kind === 'error' ? colors.danger :
                status.kind === 'success' ? colors.success :
                colors.accent,
              border: `1px solid ${
                status.kind === 'error' ? '#f5c2c2' :
                status.kind === 'success' ? '#c8e6c9' :
                '#bbdefb'
              }`,
            }}
          >
            {status.msg}
          </div>
        )}

        {/* Entity table */}
        {loading ? (
          <div style={{ padding: 40, textAlign: 'center', color: colors.textMuted }}>Loading...</div>
        ) : (
          <table style={{
            width: '100%',
            borderCollapse: 'collapse',
            fontSize: 13,
            background: colors.bg,
            border: `1px solid ${colors.border}`,
            borderRadius: 4,
            overflow: 'hidden',
          }}>
            <thead>
              <tr style={{ background: colors.surface, borderBottom: `1px solid ${colors.border}` }}>
                <th style={{ padding: '10px 12px', textAlign: 'left', width: 36 }}>
                  <input
                    type="checkbox"
                    checked={allSelected}
                    onChange={toggleSelectAll}
                    ref={el => {
                      if (el) el.indeterminate = !allSelected && selectedIds.size > 0 && filteredEntities.some(e => selectedIds.has(e.id))
                    }}
                  />
                </th>
                <th style={{ padding: '10px 12px', textAlign: 'left', color: colors.textMuted, fontWeight: 600, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Name</th>
                <th style={{ padding: '10px 12px', textAlign: 'left', color: colors.textMuted, fontWeight: 600, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Slug</th>
                <th style={{ padding: '10px 12px', textAlign: 'left', width: 110, color: colors.textMuted, fontWeight: 600, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Type</th>
                <th style={{ padding: '10px 12px', textAlign: 'right', width: 80, color: colors.textMuted, fontWeight: 600, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Children</th>
              </tr>
            </thead>
            <tbody>
              {filteredEntities.map(e => (
                <tr
                  key={e.id}
                  onClick={() => toggleSelect(e.id)}
                  style={{
                    borderBottom: `1px solid ${colors.border}`,
                    background: selectedIds.has(e.id) ? colors.selected : 'transparent',
                    cursor: 'pointer',
                  }}
                >
                  <td style={{ padding: '8px 12px' }} onClick={e2 => e2.stopPropagation()}>
                    <input
                      type="checkbox"
                      checked={selectedIds.has(e.id)}
                      onChange={() => toggleSelect(e.id)}
                    />
                  </td>
                  <td style={{ padding: '8px 12px', color: colors.text }}>{e.name}</td>
                  <td style={{ padding: '8px 12px', fontFamily: 'monospace', color: colors.textMuted, fontSize: 12 }}>{e.id}</td>
                  <td style={{ padding: '8px 12px' }}>
                    <span style={{
                      display: 'inline-block',
                      padding: '2px 8px',
                      fontSize: 10,
                      fontWeight: 600,
                      color:
                        e.type === 'brand' ? '#6a3fa0' :
                        e.type === 'product' ? '#3f6aa0' :
                        e.type === 'legal-entity' ? '#666' :
                        e.type === 'conglomerate' ? '#a86b0a' :
                        '#0a7a5a',
                      background:
                        e.type === 'brand' ? '#f3ebff' :
                        e.type === 'product' ? '#ebf2ff' :
                        e.type === 'legal-entity' ? '#f0f0f0' :
                        e.type === 'conglomerate' ? '#fff4e0' :
                        '#e0f5ec',
                      borderRadius: 3,
                      textTransform: 'uppercase',
                      letterSpacing: '0.05em',
                    }}>{e.type}</span>
                  </td>
                  <td style={{ padding: '8px 12px', textAlign: 'right', color: colors.textMuted }}>{e.child_count}</td>
                </tr>
              ))}
              {filteredEntities.length === 0 && (
                <tr>
                  <td colSpan={5} style={{ padding: 40, textAlign: 'center', color: colors.textMuted }}>
                    {entities.length === 0 ? 'No direct children' : 'No matches for your filter'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
