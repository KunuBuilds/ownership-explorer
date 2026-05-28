'use client'

import { useState, useEffect, useCallback, useRef } from 'react'

interface QueueEntity {
  id:            string
  name:          string
  type:          string
  parent_name:   string | null
  ownership_id:  number | null
  acquired_date: string | null
  category:      string | null
}

type SourceType = 'primary' | 'filing' | 'secondary'

interface SourceDraft {
  title:          string
  publisher:      string
  url:            string
  published_date: string
  source_type:    SourceType
}

const EMPTY_SOURCE: SourceDraft = { title: '', publisher: '', url: '', published_date: '', source_type: 'secondary' }

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
}

export default function DescriptionsPage() {
  const [password, setPassword]   = useState('')
  const [authed, setAuthed]       = useState(false)
  const [authError, setAuthError] = useState('')

  const [queue, setQueue]           = useState<QueueEntity[]>([])
  const [queueTotal, setQueueTotal] = useState(0)
  const [queueLoading, setQueueLoading] = useState(false)
  const [cursorIndex, setCursorIndex]   = useState(0)

  const [typeFilter, setTypeFilter] = useState('brand,conglomerate')
  const [search, setSearch]         = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')

  const [description, setDescription] = useState('')
  const [acquiredDate, setAcquiredDate] = useState('')
  const [source, setSource]             = useState<SourceDraft>(EMPTY_SOURCE)
  const [aiLoading, setAiLoading]     = useState(false)
  const [saveLoading, setSaveLoading] = useState(false)
  const [status, setStatus] = useState<{ msg: string; kind: 'info' | 'success' | 'error' } | null>(null)

  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 250)
    return () => clearTimeout(t)
  }, [search])

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
    if (res.ok) {
      setAuthed(true)
      sessionStorage.setItem('admin_password', password)
    } else {
      setAuthError('Incorrect password')
    }
  }

  const loadQueue = useCallback(async () => {
    if (!authed) return
    setQueueLoading(true)
    try {
      const params = new URLSearchParams({ action: 'queue', types: typeFilter, limit: '100' })
      if (debouncedSearch) params.set('search', debouncedSearch)
      const res = await fetch(`/api/admin/entity-description?${params}`, {
        headers: { 'x-admin-password': password },
      })
      const data = await res.json()
      setQueue(data.rows ?? [])
      setQueueTotal(data.total ?? 0)
      setCursorIndex(0)
    } catch (err: any) {
      setStatus({ msg: 'Failed to load queue: ' + err.message, kind: 'error' })
    } finally {
      setQueueLoading(false)
    }
  }, [authed, password, typeFilter, debouncedSearch])

  useEffect(() => { if (authed) loadQueue() }, [authed, loadQueue])

  // Clear textarea + date/source fields when entity changes
  const current = queue[cursorIndex]
  const prevId = useRef<string | null>(null)
  useEffect(() => {
    if (current?.id !== prevId.current) {
      setDescription('')
      setAcquiredDate('')
      setSource(EMPTY_SOURCE)
      prevId.current = current?.id ?? null
    }
  }, [current?.id])

  // Whether we should ask the AI for / let the admin edit an acquisition date.
  const acquisitionEditable = Boolean(current?.ownership_id) && !current?.acquired_date

  async function handleGenerate() {
    if (!current) return
    setAiLoading(true)
    try {
      const res = await fetch('/api/admin/entity-description/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-admin-password': password },
        body: JSON.stringify({
          action:                  'generate',
          entity_name:             current.name,
          entity_type:             current.type,
          parent_name:             current.parent_name,
          category:                current.category,
          existing_acquired_date:  current.acquired_date,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Request failed')
      setDescription(data.description ?? '')
      if (acquisitionEditable) {
        setAcquiredDate(data.acquired_date ?? '')
        if (data.source) {
          setSource({
            title:          data.source.title ?? '',
            publisher:      data.source.publisher ?? '',
            url:            data.source.url ?? '',
            published_date: data.source.published_date ?? '',
            source_type:    data.source.source_type ?? 'secondary',
          })
        } else {
          setSource(EMPTY_SOURCE)
        }
        if (!data.acquired_date || !data.source) {
          setStatus({ msg: 'AI could not verify the acquisition date — enter it manually or skip.', kind: 'info' })
        }
      }
      setTimeout(() => textareaRef.current?.focus(), 10)
    } catch (err: any) {
      setStatus({ msg: 'AI error: ' + err.message, kind: 'error' })
    } finally {
      setAiLoading(false)
    }
  }

  async function handleSave() {
    if (!current || !description.trim()) return

    // Only submit date/source when the slot is editable, a date was entered,
    // and (if a source is provided) at minimum URL + title are filled.
    const dateOk = acquisitionEditable && /^\d{4}-\d{2}-\d{2}$/.test(acquiredDate)
    const sourceOk = dateOk && source.url.trim() && source.title.trim()
    if (acquisitionEditable && acquiredDate && !sourceOk) {
      setStatus({ msg: 'A date needs a source (URL + title) to save. Clear the date or fill in the source.', kind: 'error' })
      return
    }

    setSaveLoading(true)
    try {
      const res = await fetch('/api/admin/entity-description/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-admin-password': password },
        body: JSON.stringify({
          action:        'save',
          entity_id:     current.id,
          description:   description.trim(),
          ownership_id:  sourceOk ? current.ownership_id : null,
          acquired_date: sourceOk ? acquiredDate : null,
          source:        sourceOk ? {
            title:          source.title.trim(),
            publisher:      source.publisher.trim() || null,
            url:            source.url.trim(),
            published_date: /^\d{4}-\d{2}-\d{2}$/.test(source.published_date) ? source.published_date : null,
            source_type:    source.source_type,
          } : null,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Request failed')
      const extras = [data.wrote_date && 'acquisition date', data.wrote_source && 'source'].filter(Boolean).join(' + ')
      setStatus({
        msg:  extras ? `✓ Saved ${current.name} (description + ${extras})` : `✓ Saved description for ${current.name}`,
        kind: 'success',
      })
      setQueue(prev => prev.filter((_, i) => i !== cursorIndex))
      setQueueTotal(t => Math.max(0, t - 1))
      setDescription('')
      setAcquiredDate('')
      setSource(EMPTY_SOURCE)
    } catch (err: any) {
      setStatus({ msg: 'Save error: ' + err.message, kind: 'error' })
    } finally {
      setSaveLoading(false)
    }
  }

  function handleSkip() {
    setQueue(prev => prev.filter((_, i) => i !== cursorIndex))
    setDescription('')
    setAcquiredDate('')
    setSource(EMPTY_SOURCE)
  }

  const inputStyle = {
    background: colors.bg,
    color: colors.text,
    border: `1px solid ${colors.border}`,
    borderRadius: 4,
    outline: 'none',
    boxSizing: 'border-box' as const,
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
      <div style={{ maxWidth: 760, margin: '0 auto', padding: '48px 24px 80px' }}>

        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 28 }}>
          <div>
            <h1 style={{ fontSize: 22, margin: 0, marginBottom: 4 }}>Entity Descriptions</h1>
            <div style={{ fontSize: 12, color: colors.textMuted }}>
              Generate and save AI descriptions for entities
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

        {/* Filters */}
        <div style={{ display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 200 }}>
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Filter by name…"
              style={{ ...inputStyle, width: '100%', padding: '8px 10px', fontSize: 14 }}
            />
          </div>
          <select
            value={typeFilter}
            onChange={e => setTypeFilter(e.target.value)}
            style={{ ...inputStyle, padding: '8px 10px', fontSize: 14 }}
          >
            <option value="brand,conglomerate">Brands + Conglomerates</option>
            <option value="brand">Brands only</option>
            <option value="conglomerate">Conglomerates only</option>
            <option value="subsidiary">Subsidiaries</option>
            <option value="brand,conglomerate,subsidiary">All (exc. products)</option>
          </select>
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

        {queueLoading ? (
          <div style={{ padding: 40, textAlign: 'center', color: colors.textMuted }}>Loading…</div>
        ) : queue.length === 0 ? (
          <div style={{ padding: 40, textAlign: 'center', border: `1px solid ${colors.border}`, borderRadius: 4, background: colors.surface }}>
            <div style={{ fontSize: 32, marginBottom: 8 }}>✓</div>
            <div style={{ fontSize: 14, color: colors.text }}>All done — no entities missing descriptions.</div>
          </div>
        ) : (
          <div>
            {/* Progress */}
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16, fontSize: 12, color: colors.textMuted }}>
              <span>
                <strong style={{ color: colors.text }}>{cursorIndex + 1}</strong> of {queue.length} loaded
                {queueTotal > queue.length && <> · {queueTotal - queue.length} more in batch</>}
              </span>
            </div>

            {/* Current entity card */}
            <div style={{ padding: 24, border: `2px solid ${colors.accent}`, borderRadius: 4, background: colors.bg, marginBottom: 16 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
                <div>
                  <div style={{ fontSize: 22, fontWeight: 600, marginBottom: 4 }}>{current.name}</div>
                  <div style={{ fontSize: 12, color: colors.textMuted, fontFamily: 'monospace' }}>
                    {current.id}
                    {current.parent_name && <> · under {current.parent_name}</>}
                    {current.category && <> · {current.category}</>}
                  </div>
                </div>
                <span style={{
                  display: 'inline-block', padding: '2px 8px', fontSize: 10, fontWeight: 600,
                  color: current.type === 'brand' ? '#6a3fa0' : current.type === 'conglomerate' ? '#a86b0a' : '#555',
                  background: current.type === 'brand' ? '#f3ebff' : current.type === 'conglomerate' ? '#fff4e0' : '#f0f0f0',
                  borderRadius: 3, textTransform: 'uppercase', letterSpacing: '0.05em',
                }}>{current.type}</span>
              </div>

              {/* Textarea */}
              <div style={{ marginBottom: 12 }}>
                <label style={{ display: 'block', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.1em', color: colors.textMuted, marginBottom: 6, fontWeight: 600 }}>
                  Description
                </label>
                <textarea
                  ref={textareaRef}
                  value={description}
                  onChange={e => setDescription(e.target.value)}
                  placeholder="Click ✦ AI Generate or type a description…"
                  rows={4}
                  style={{ ...inputStyle, width: '100%', padding: '10px 12px', fontSize: 14, resize: 'vertical', lineHeight: 1.6 }}
                />
                <div style={{ fontSize: 11, color: colors.muted, marginTop: 4, textAlign: 'right' }}>
                  {description.length} chars
                </div>
              </div>

              {/* Acquisition date + source */}
              {current.parent_name && (
                <div style={{ marginBottom: 12, padding: 12, background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: 4 }}>
                  <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.1em', color: colors.textMuted, marginBottom: 8, fontWeight: 600 }}>
                    Acquisition by {current.parent_name}
                  </div>

                  {!acquisitionEditable ? (
                    <div style={{ fontSize: 12, color: colors.textMuted }}>
                      {current.acquired_date
                        ? <>Already recorded: <strong style={{ color: colors.text }}>{current.acquired_date}</strong> · not editable here.</>
                        : <>No live ownership edge linked — can&apos;t attach a date.</>}
                    </div>
                  ) : (
                    <>
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
                        <label style={{ fontSize: 12, color: colors.textMuted, minWidth: 110 }}>Acquired date</label>
                        <input
                          type="date"
                          value={acquiredDate}
                          onChange={e => setAcquiredDate(e.target.value)}
                          placeholder="YYYY-MM-DD"
                          style={{ ...inputStyle, padding: '6px 8px', fontSize: 13, width: 160 }}
                        />
                        {acquiredDate && (
                          <button
                            onClick={() => { setAcquiredDate(''); setSource(EMPTY_SOURCE) }}
                            style={{ fontSize: 11, color: colors.textMuted, background: 'transparent', border: 0, cursor: 'pointer', textDecoration: 'underline' }}
                          >
                            clear
                          </button>
                        )}
                      </div>

                      <div style={{ display: 'grid', gridTemplateColumns: '110px 1fr', gap: 8, alignItems: 'center' }}>
                        <label style={{ fontSize: 12, color: colors.textMuted }}>Source URL</label>
                        <input
                          type="url"
                          value={source.url}
                          onChange={e => setSource(s => ({ ...s, url: e.target.value }))}
                          placeholder="https://…"
                          style={{ ...inputStyle, padding: '6px 8px', fontSize: 13 }}
                        />
                        <label style={{ fontSize: 12, color: colors.textMuted }}>Source title</label>
                        <input
                          type="text"
                          value={source.title}
                          onChange={e => setSource(s => ({ ...s, title: e.target.value }))}
                          placeholder="e.g. LVMH completes Bulgari acquisition"
                          style={{ ...inputStyle, padding: '6px 8px', fontSize: 13 }}
                        />
                        <label style={{ fontSize: 12, color: colors.textMuted }}>Publisher</label>
                        <input
                          type="text"
                          value={source.publisher}
                          onChange={e => setSource(s => ({ ...s, publisher: e.target.value }))}
                          placeholder="e.g. Reuters"
                          style={{ ...inputStyle, padding: '6px 8px', fontSize: 13 }}
                        />
                        <label style={{ fontSize: 12, color: colors.textMuted }}>Published</label>
                        <input
                          type="date"
                          value={source.published_date}
                          onChange={e => setSource(s => ({ ...s, published_date: e.target.value }))}
                          style={{ ...inputStyle, padding: '6px 8px', fontSize: 13, width: 160 }}
                        />
                        <label style={{ fontSize: 12, color: colors.textMuted }}>Type</label>
                        <select
                          value={source.source_type}
                          onChange={e => setSource(s => ({ ...s, source_type: e.target.value as SourceType }))}
                          style={{ ...inputStyle, padding: '6px 8px', fontSize: 13, width: 160 }}
                        >
                          <option value="primary">primary (company)</option>
                          <option value="filing">filing (regulator)</option>
                          <option value="secondary">secondary (news)</option>
                        </select>
                      </div>

                      <div style={{ fontSize: 11, color: colors.muted, marginTop: 8 }}>
                        Verify the URL before saving — the AI does not browse the web.
                      </div>
                    </>
                  )}
                </div>
              )}

              {/* Actions */}
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button
                  onClick={handleGenerate}
                  disabled={aiLoading}
                  style={{
                    padding: '8px 16px', fontSize: 13, fontWeight: 500,
                    background: aiLoading ? colors.surface : '#f0f7ff',
                    color: aiLoading ? colors.muted : '#0055aa',
                    border: '1px solid #b3d4f5', borderRadius: 4,
                    cursor: aiLoading ? 'not-allowed' : 'pointer',
                  }}
                >
                  {aiLoading ? 'Thinking…' : '✦ AI Generate'}
                </button>
                <button
                  onClick={handleSave}
                  disabled={!description.trim() || saveLoading}
                  style={{
                    padding: '8px 16px', fontSize: 13, fontWeight: 500,
                    background: description.trim() ? colors.accent : colors.surface,
                    color: description.trim() ? '#fff' : colors.muted,
                    border: 0, borderRadius: 4,
                    cursor: description.trim() ? 'pointer' : 'not-allowed',
                  }}
                >
                  {saveLoading ? 'Saving…' : 'Save'}
                </button>
                <button
                  onClick={handleSkip}
                  style={{ padding: '8px 12px', fontSize: 13, background: colors.bg, color: colors.textMuted, border: `1px solid ${colors.border}`, borderRadius: 4, cursor: 'pointer' }}
                >
                  Skip
                </button>
              </div>
            </div>

            {/* Up next */}
            {queue.length > cursorIndex + 1 && (
              <>
                <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.1em', color: colors.textMuted, marginBottom: 8 }}>
                  Up next
                </div>
                <div style={{ border: `1px solid ${colors.border}`, borderRadius: 4, overflow: 'hidden' }}>
                  {queue.slice(cursorIndex + 1, cursorIndex + 6).map((e, i) => (
                    <div
                      key={e.id}
                      onClick={() => setCursorIndex(cursorIndex + 1 + i)}
                      style={{ padding: '8px 12px', fontSize: 13, borderBottom: `1px solid ${colors.border}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer' }}
                    >
                      <div>
                        <span style={{ color: colors.text }}>{e.name}</span>
                        {e.parent_name && <span style={{ color: colors.muted, marginLeft: 8, fontSize: 11 }}>· {e.parent_name}</span>}
                      </div>
                      <span style={{ fontSize: 10, color: colors.muted, textTransform: 'uppercase' }}>{e.type}</span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
