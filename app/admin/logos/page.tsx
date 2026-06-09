'use client'

import { useState, useEffect, useCallback } from 'react'

interface Candidate {
  id:           number
  wikidata_qid: string
  label:        string | null
  description:  string | null
  instance_of:  string | null
  logo_url:     string | null
  score:        number
  is_suggested: boolean
}

interface QueueRow {
  entity_id:   string
  entity_name: string
  entity_type: string | null
  candidates:  Candidate[]
}

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
  danger:    '#c62828',
}

export default function LogosPage() {
  const [password, setPassword]   = useState('')
  const [authed, setAuthed]       = useState(false)
  const [authError, setAuthError] = useState('')

  const [queue, setQueue]         = useState<QueueRow[]>([])
  const [total, setTotal]         = useState(0)
  const [loading, setLoading]     = useState(false)
  const [busy, setBusy]           = useState<string | null>(null)   // entity_id mid-action
  const [status, setStatus]       = useState<{ msg: string; kind: 'info' | 'success' | 'error' } | null>(null)

  // Force the light admin background.
  useEffect(() => {
    const prevBg = document.body.style.background
    const prevColor = document.body.style.color
    document.body.style.background = colors.bg
    document.body.style.color = colors.text
    return () => { document.body.style.background = prevBg; document.body.style.color = prevColor }
  }, [])

  // Restore session.
  useEffect(() => {
    const saved = sessionStorage.getItem('admin_password')
    if (saved) {
      fetch('/api/admin/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: saved }),
      }).then(r => {
        if (r.ok) { setPassword(saved); setAuthed(true) }
        else sessionStorage.removeItem('admin_password')
      })
    }
  }, [])

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    setAuthError('')
    const res = await fetch('/api/admin/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    })
    if (res.ok) { setAuthed(true); sessionStorage.setItem('admin_password', password) }
    else setAuthError('Incorrect password')
  }

  const loadQueue = useCallback(async () => {
    if (!authed) return
    setLoading(true)
    try {
      const res = await fetch('/api/admin/logos?action=queue&limit=200', { headers: { 'x-admin-password': password } })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Request failed')
      setQueue(data.rows ?? [])
      setTotal(data.total ?? 0)
    } catch (err: any) {
      setStatus({ msg: 'Failed to load queue: ' + err.message, kind: 'error' })
    } finally {
      setLoading(false)
    }
  }, [authed, password])

  useEffect(() => { if (authed) loadQueue() }, [authed, loadQueue])

  async function approve(entityId: string, candidateId: number) {
    setBusy(entityId)
    try {
      const res = await fetch('/api/admin/logos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-admin-password': password },
        body: JSON.stringify({ action: 'approve', candidate_id: candidateId }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Request failed')
      setQueue(prev => prev.filter(r => r.entity_id !== entityId))
      setTotal(t => Math.max(0, t - 1))
      setStatus({ msg: `✓ Applied logo for ${entityId}`, kind: 'success' })
    } catch (err: any) {
      setStatus({ msg: 'Approve error: ' + err.message, kind: 'error' })
    } finally {
      setBusy(null)
    }
  }

  async function reject(entityId: string) {
    setBusy(entityId)
    try {
      const res = await fetch('/api/admin/logos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-admin-password': password },
        body: JSON.stringify({ action: 'reject', entity_id: entityId }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Request failed')
      setQueue(prev => prev.filter(r => r.entity_id !== entityId))
      setTotal(t => Math.max(0, t - 1))
      setStatus({ msg: `Dismissed ${entityId} (kept monogram)`, kind: 'info' })
    } catch (err: any) {
      setStatus({ msg: 'Reject error: ' + err.message, kind: 'error' })
    } finally {
      setBusy(null)
    }
  }

  const inputStyle = {
    background: colors.bg, color: colors.text, border: `1px solid ${colors.border}`,
    borderRadius: 4, outline: 'none', boxSizing: 'border-box' as const,
  }

  if (!authed) {
    return (
      <div style={{ minHeight: '100vh', background: colors.bg, color: colors.text, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'system-ui, sans-serif' }}>
        <div style={{ width: 360, padding: 24 }}>
          <h1 style={{ fontSize: 20, marginBottom: 16 }}>Admin Login</h1>
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
            <button type="submit" style={{ marginTop: 12, width: '100%', padding: '10px 12px', background: colors.accent, color: '#fff', border: 0, borderRadius: 4, fontSize: 14, cursor: 'pointer' }}>
              Sign in
            </button>
          </form>
        </div>
      </div>
    )
  }

  return (
    <div style={{ minHeight: '100vh', background: colors.bg, color: colors.text, fontFamily: 'system-ui, sans-serif' }}>
      <div style={{ maxWidth: 860, margin: '0 auto', padding: '48px 24px 80px' }}>

        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 28 }}>
          <div>
            <h1 style={{ fontSize: 22, margin: 0, marginBottom: 4 }}>Logo Review</h1>
            <div style={{ fontSize: 12, color: colors.textMuted }}>
              Approve the correct Wikidata logo for each entity, or dismiss to keep the monogram
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <a href="/admin" style={{ padding: '6px 12px', fontSize: 12, background: colors.bg, color: colors.textMuted, border: `1px solid ${colors.border}`, borderRadius: 4, textDecoration: 'none' }}>
              ← Admin
            </a>
            <button
              onClick={() => { sessionStorage.removeItem('admin_password'); setAuthed(false); setPassword('') }}
              style={{ padding: '6px 12px', fontSize: 12, background: colors.bg, color: colors.textMuted, border: `1px solid ${colors.border}`, borderRadius: 4, cursor: 'pointer' }}
            >
              Sign out
            </button>
          </div>
        </div>

        {/* Status */}
        {status && (
          <div style={{
            padding: '10px 14px', marginBottom: 16, borderRadius: 4, fontSize: 13,
            background: status.kind === 'error' ? '#fdeaea' : status.kind === 'success' ? '#e8f5e9' : '#e3f2fd',
            color: status.kind === 'error' ? colors.danger : status.kind === 'success' ? colors.success : colors.accent,
            border: `1px solid ${status.kind === 'error' ? '#f5c2c2' : status.kind === 'success' ? '#c8e6c9' : '#bbdefb'}`,
          }}>
            {status.msg}
          </div>
        )}

        {loading ? (
          <div style={{ padding: 40, textAlign: 'center', color: colors.textMuted }}>Loading…</div>
        ) : queue.length === 0 ? (
          <div style={{ padding: 40, textAlign: 'center', border: `1px solid ${colors.border}`, borderRadius: 4, background: colors.surface }}>
            <div style={{ fontSize: 32, marginBottom: 8 }}>✓</div>
            <div style={{ fontSize: 14 }}>Review queue is empty — run <code>node enrich-wikidata.mjs</code> to populate it.</div>
          </div>
        ) : (
          <div>
            <div style={{ marginBottom: 16, fontSize: 12, color: colors.textMuted }}>
              <strong style={{ color: colors.text }}>{queue.length}</strong> entit{queue.length === 1 ? 'y' : 'ies'} awaiting review
              {total > queue.length && <> · showing first {queue.length} of {total}</>}
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              {queue.map(row => (
                <div key={row.entity_id} style={{ padding: 20, border: `1px solid ${colors.border}`, borderRadius: 4, background: colors.bg, opacity: busy === row.entity_id ? 0.5 : 1 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14 }}>
                    <div>
                      <div style={{ fontSize: 18, fontWeight: 600 }}>{row.entity_name}</div>
                      <div style={{ fontSize: 11, color: colors.muted, fontFamily: 'monospace' }}>
                        {row.entity_id}{row.entity_type && <> · {row.entity_type}</>}
                      </div>
                    </div>
                    <button
                      onClick={() => reject(row.entity_id)}
                      disabled={busy === row.entity_id}
                      style={{ padding: '6px 12px', fontSize: 12, background: colors.bg, color: colors.textMuted, border: `1px solid ${colors.border}`, borderRadius: 4, cursor: 'pointer' }}
                    >
                      None of these
                    </button>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 12 }}>
                    {row.candidates.map(c => (
                      <div
                        key={c.id}
                        style={{
                          border: `1px solid ${c.is_suggested ? colors.accent : colors.border}`,
                          borderRadius: 4, padding: 12, background: c.is_suggested ? '#f0f7ff' : colors.surface,
                          display: 'flex', flexDirection: 'column', gap: 8,
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                          {c.logo_url
                            ? <img src={c.logo_url} alt="" style={{ width: 44, height: 44, objectFit: 'contain', background: '#fff', border: `1px solid ${colors.border}`, padding: 3, flexShrink: 0 }} />
                            : <div style={{ width: 44, height: 44, background: colors.surface2, border: `1px solid ${colors.border}`, flexShrink: 0 }} />}
                          <div style={{ minWidth: 0 }}>
                            <div style={{ fontSize: 13, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}>
                              {c.label ?? c.wikidata_qid}
                              {c.is_suggested && <span style={{ fontSize: 9, padding: '1px 6px', background: colors.accent, color: '#fff', borderRadius: 3, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Best</span>}
                            </div>
                            <a href={`https://www.wikidata.org/wiki/${c.wikidata_qid}`} target="_blank" rel="noopener noreferrer" style={{ fontSize: 10, color: colors.accent, fontFamily: 'monospace' }}>
                              {c.wikidata_qid} ↗
                            </a>
                          </div>
                        </div>
                        {c.description && <div style={{ fontSize: 11, color: colors.textMuted, lineHeight: 1.4 }}>{c.description}</div>}
                        {c.instance_of && <div style={{ fontSize: 10, color: colors.muted }}>{c.instance_of}</div>}
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 'auto' }}>
                          <span style={{ fontSize: 10, color: colors.muted }}>score {c.score.toFixed(2)}</span>
                          <button
                            onClick={() => approve(row.entity_id, c.id)}
                            disabled={busy === row.entity_id || !c.logo_url}
                            style={{ padding: '5px 14px', fontSize: 12, fontWeight: 500, background: colors.accent, color: '#fff', border: 0, borderRadius: 4, cursor: 'pointer' }}
                          >
                            Use this
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
