'use client'

import { useState, useEffect, useCallback, useRef, useMemo } from 'react'

interface EntityOption {
  id: string
  name: string
  type: string
}

interface Category {
  id: string
  name: string
  parent_id: string | null
  level: number
  sort_order: number
}

type Mode = 'create' | 'link'

interface QueuedName {
  key: number
  name: string
  status: 'pending' | 'success' | 'error'
  resultId?: string
  errorMsg?: string
}

const ENTITY_TYPES = ['conglomerate', 'brand', 'subsidiary', 'legal_entity', 'product'] as const

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
  chip:          '#e8f0fd',
  chipText:      '#1a4fa3',
}

const inputBase: React.CSSProperties = {
  width: '100%', padding: '8px 10px', fontSize: 14, boxSizing: 'border-box',
  border: `1px solid ${c.border}`, borderRadius: 4,
  background: c.bg, color: c.text, outline: 'none',
}

// Entity autocomplete picker

function EntityPicker({
  label, placeholder, selected, onAdd, onRemove, password, multi = true,
}: {
  label: string
  placeholder: string
  selected: EntityOption[]
  onAdd: (e: EntityOption) => void
  onRemove: (id: string) => void
  password: string
  multi?: boolean
}) {
  const [q, setQ] = useState('')
  const [results, setResults] = useState<EntityOption[]>([])
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const search = useCallback(async (query: string) => {
    if (!query.trim()) { setResults([]); setOpen(false); return }
    setLoading(true)
    try {
      const res = await fetch(`/api/admin/add?action=search&q=${encodeURIComponent(query)}&limit=10`, {
        headers: { 'x-admin-password': password },
      })
      const data = await res.json()
      const filtered = (data.results ?? []).filter((r: EntityOption) => !selected.some(s => s.id === r.id))
      setResults(filtered)
      setOpen(filtered.length > 0)
    } finally { setLoading(false) }
  }, [password, selected])

  function handleChange(val: string) {
    setQ(val)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => search(val), 220)
  }

  function pick(e: EntityOption) {
    onAdd(e)
    setQ(''); setResults([]); setOpen(false)
    if (multi) inputRef.current?.focus()
  }

  return (
    <div>
      <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: c.textMuted, marginBottom: 4 }}>{label}</label>
      {selected.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
          {selected.map(e => (
            <span key={e.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: c.chip, color: c.chipText, borderRadius: 4, padding: '3px 8px', fontSize: 13 }}>
              <span style={{ fontSize: 10, opacity: 0.7, textTransform: 'uppercase' }}>{e.type}</span>
              {e.name}
              <button onClick={() => onRemove(e.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: c.chipText, padding: '0 0 0 2px', fontSize: 14, lineHeight: 1 }}>x</button>
            </span>
          ))}
        </div>
      )}
      {(multi || selected.length === 0) && (
        <div style={{ position: 'relative' }}>
          <input
            ref={inputRef}
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
                  <span style={{ fontSize: 10, color: c.muted, textTransform: 'uppercase', minWidth: 72 }}>{r.type}</span>
                  <span style={{ fontSize: 14 }}>{r.name}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// Category picker

function CategoryPicker({ categories, selected, primaryId, onToggle, onSetPrimary }: {
  categories: Category[]
  selected: string[]
  primaryId: string | null
  onToggle: (id: string) => void
  onSetPrimary: (id: string | null) => void
}) {
  const [search, setSearch] = useState('')

  const treeOrdered = useMemo(() => {
    const byParent = new Map<string | null, Category[]>()
    for (const cat of categories) {
      const key = cat.parent_id ?? null
      const arr = byParent.get(key) ?? []
      arr.push(cat)
      byParent.set(key, arr)
    }
    for (const arr of byParent.values()) {
      arr.sort((a, b) => (a.sort_order ?? 999) - (b.sort_order ?? 999) || a.name.localeCompare(b.name))
    }
    const ordered: Category[] = []
    function walk(pid: string | null) {
      for (const cat of byParent.get(pid) ?? []) { ordered.push(cat); walk(cat.id) }
    }
    walk(null)
    return ordered
  }, [categories])

  const flat = search.trim()
    ? treeOrdered.filter(cat => cat.name.toLowerCase().includes(search.toLowerCase()))
    : treeOrdered

  return (
    <div>
      <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: c.textMuted, marginBottom: 4 }}>
        Categories <span style={{ fontWeight: 400, color: c.muted }}>(optional — applied to all)</span>
      </label>
      {selected.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
          {selected.map(id => {
            const cat = categories.find(cat => cat.id === id)
            const isPrimary = id === primaryId
            return (
              <span key={id} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: isPrimary ? '#fff3cd' : c.chip, color: isPrimary ? '#856404' : c.chipText, borderRadius: 4, padding: '3px 8px', fontSize: 13, border: isPrimary ? '1px solid #ffc107' : '1px solid transparent' }}>
                {isPrimary && <span>*</span>}
                {cat?.name ?? id}
                {!isPrimary && <button title="Set as primary" onClick={() => onSetPrimary(id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: c.muted, padding: '0 2px', fontSize: 12 }}>*</button>}
                {isPrimary && <button title="Unset primary" onClick={() => onSetPrimary(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#856404', padding: '0 2px', fontSize: 12 }}>x</button>}
                <button onClick={() => { onToggle(id); if (isPrimary) onSetPrimary(null) }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'inherit', padding: '0 0 0 2px', fontSize: 14, lineHeight: 1 }}>x</button>
              </span>
            )
          })}
        </div>
      )}
      <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Filter categories..."
        style={{ ...inputBase, marginBottom: 6 }} />
      <div style={{ maxHeight: 200, overflowY: 'auto', border: `1px solid ${c.border}`, borderRadius: 4, background: c.surface }}>
        {flat.length === 0 && <div style={{ padding: '10px 12px', fontSize: 13, color: c.muted }}>No categories match</div>}
        {flat.map(cat => {
          const checked = selected.includes(cat.id)
          return (
            <label key={cat.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: `6px ${12 + (cat.level - 1) * 16}px`, cursor: 'pointer', fontSize: 13, background: checked ? c.chip : 'transparent' }}>
              <input type="checkbox" checked={checked} onChange={() => onToggle(cat.id)} style={{ cursor: 'pointer' }} />
              <span style={{ color: checked ? c.chipText : c.text }}>{cat.name}</span>
              {cat.id === primaryId && <span style={{ fontSize: 11, color: '#856404' }}>* primary</span>}
            </label>
          )
        })}
      </div>
    </div>
  )
}

// Field wrapper

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: c.textMuted, marginBottom: 2 }}>{label}</label>
      {hint && <div style={{ fontSize: 12, color: c.muted, marginBottom: 4 }}>{hint}</div>}
      {children}
    </div>
  )
}

function TInput({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  return <input value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} style={inputBase} />
}

// Name queue row

function NameRow({ item, index, isOnly, onChange, onRemove, onEnter, inputRef }: {
  item: QueuedName
  index: number
  isOnly: boolean
  onChange: (val: string) => void
  onRemove: () => void
  onEnter: () => void
  inputRef?: React.RefObject<HTMLInputElement>
}) {
  const rowBg   = item.status === 'success' ? c.successBg  : item.status === 'error' ? c.dangerBg  : 'transparent'
  const rowBdr  = item.status === 'success' ? c.successBorder : item.status === 'error' ? c.dangerBorder : 'transparent'
  const textClr = item.status === 'success' ? c.success    : item.status === 'error' ? c.danger    : c.text

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 8px', borderRadius: 5, background: rowBg, border: `1px solid ${rowBdr}` }}>
      <span style={{ fontSize: 12, color: c.muted, minWidth: 22, textAlign: 'right', userSelect: 'none', flexShrink: 0 }}>
        {index + 1}.
      </span>

      {item.status === 'pending' ? (
        <input
          ref={inputRef}
          value={item.name}
          onChange={e => onChange(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter') { e.preventDefault(); onEnter() }
            if (e.key === 'Backspace' && item.name === '' && !isOnly) { e.preventDefault(); onRemove() }
          }}
          placeholder="Entity name..."
          style={{ flex: 1, padding: '6px 8px', fontSize: 14, border: `1px solid ${c.border}`, borderRadius: 4, background: c.bg, color: c.text, outline: 'none' }}
        />
      ) : (
        <span style={{ flex: 1, fontSize: 14, color: textClr, padding: '6px 8px' }}>
          {item.name}
          {item.status === 'success' && item.resultId && (
            <a href={`/entity/${item.resultId}`} target="_blank" rel="noreferrer"
              style={{ marginLeft: 8, fontSize: 12, color: c.accent, textDecoration: 'none' }}>View</a>
          )}
          {item.status === 'error' && item.errorMsg && (
            <span style={{ marginLeft: 8, fontSize: 12 }}> — {item.errorMsg}</span>
          )}
        </span>
      )}

      {item.status === 'pending' && !isOnly && (
        <button onClick={onRemove} style={{ background: 'none', border: 'none', cursor: 'pointer', color: c.muted, fontSize: 16, padding: '0 4px', lineHeight: 1, flexShrink: 0 }}>x</button>
      )}
      {item.status === 'success' && <span style={{ fontSize: 12, color: c.success, flexShrink: 0 }}>created</span>}
      {item.status === 'error' && (
        <button onClick={() => onChange(item.name)} style={{ fontSize: 12, color: c.danger, background: 'none', border: 'none', cursor: 'pointer', flexShrink: 0 }}>retry</button>
      )}
    </div>
  )
}

// Main page

export default function AdminAddPage() {
  const [password, setPassword] = useState('')
  const [authed, setAuthed]     = useState(false)
  const [authError, setAuthError] = useState('')
  const [mode, setMode]          = useState<Mode>('create')
  const [categories, setCategories] = useState<Category[]>([])

  // Template state (create mode)
  const [type, setType]         = useState('brand')
  const [parents, setParents]   = useState<EntityOption[]>([])
  const [catIds, setCatIds]     = useState<string[]>([])
  const [primaryCatId, setPrimaryCatId] = useState<string | null>(null)
  const [acquiredDate, setAcquiredDate] = useState('')
  const [ownershipPct, setOwnershipPct] = useState('')

  // Name queue
  const [queue, setQueue] = useState<QueuedName[]>([{ key: 0, name: '', status: 'pending' }])
  const keyCounter = useRef(1)
  const lastInputRef = useRef<HTMLInputElement>(null)
  const [submitting, setSubmitting] = useState(false)

  // Link mode state
  const [linkParent, setLinkParent]   = useState<EntityOption[]>([])
  const [linkChildren, setLinkChildren] = useState<EntityOption[]>([])
  const [linkAcquiredDate, setLinkAcquiredDate] = useState('')
  const [linkOwnershipPct, setLinkOwnershipPct] = useState('')
  const [linkStatus, setLinkStatus] = useState<{ msg: string; kind: 'success' | 'error' | 'info' } | null>(null)

  // Auth

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

  useEffect(() => {
    if (!authed) return
    fetch('/api/admin/add?action=categories', { headers: { 'x-admin-password': password } })
      .then(r => r.json()).then(d => setCategories(d.categories ?? []))
  }, [authed, password])

  // Queue helpers

  function addRow() {
    const key = keyCounter.current++
    setQueue(prev => [...prev, { key, name: '', status: 'pending' }])
    setTimeout(() => lastInputRef.current?.focus(), 30)
  }

  function updateName(key: number, name: string) {
    setQueue(prev => prev.map(r => r.key === key ? { ...r, name, status: 'pending', errorMsg: undefined, resultId: undefined } : r))
  }

  function removeRow(key: number) {
    setQueue(prev => {
      const next = prev.filter(r => r.key !== key)
      return next.length > 0 ? next : [{ key: keyCounter.current++, name: '', status: 'pending' }]
    })
  }

  function handleRowEnter(rowKey: number) {
    const idx = queue.findIndex(r => r.key === rowKey)
    if (idx === queue.length - 1) addRow()
  }

  // Paste handler — splits clipboard text on newlines/tabs and bulk-loads names
  function pasteNames(text: string) {
    const names = text
      .split(/\r?\n/)
      .map(line => line.split('\t')[0].trim())  // take first column if multi-column paste
      .filter(Boolean)
    if (names.length === 0) return

    setQueue(prev => {
      // Drop any trailing empty pending row before appending
      const base = prev.filter(r => !(r.status === 'pending' && r.name.trim() === ''))
      const newRows: QueuedName[] = names.map(name => ({
        key: keyCounter.current++,
        name,
        status: 'pending',
      }))
      // Always leave one empty row at the end
      newRows.push({ key: keyCounter.current++, name: '', status: 'pending' })
      return [...base, ...newRows]
    })
  }

  // Global paste listener — active only in create mode so it doesn't interfere
  // with the entity autocomplete inputs in link mode
  useEffect(() => {
    if (mode !== 'create') return
    function handlePaste(e: ClipboardEvent) {
      const target = e.target as HTMLElement
      // Let individual text inputs handle their own paste normally
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return
      const text = e.clipboardData?.getData('text/plain') ?? ''
      if (!text.trim()) return
      e.preventDefault()
      pasteNames(text)
    }
    document.addEventListener('paste', handlePaste)
    return () => document.removeEventListener('paste', handlePaste)
  }, [mode])

  const pendingQueue = queue.filter(r => r.status === 'pending' && r.name.trim())
  const successCount = queue.filter(r => r.status === 'success').length
  const errorCount   = queue.filter(r => r.status === 'error').length
  const canSubmit    = !submitting && pendingQueue.length > 0

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    if (!canSubmit) return
    setSubmitting(true)

    const results = await Promise.all(
      pendingQueue.map(async row => {
        try {
          const res = await fetch('/api/admin/add', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-admin-password': password },
            body: JSON.stringify({
              action: 'create_entity',
              name: row.name.trim(), type,
              parent_ids: parents.map(p => p.id),
              category_ids: catIds,
              primary_category_id: primaryCatId,
              acquired_date: acquiredDate || undefined,
              ownership_percentage: ownershipPct ? Number(ownershipPct) : undefined,
            }),
          })
          const data = await res.json()
          if (!res.ok) throw new Error(data.error ?? 'Request failed')
          return { key: row.key, status: 'success' as const, resultId: data.id }
        } catch (err: any) {
          return { key: row.key, status: 'error' as const, errorMsg: err.message }
        }
      })
    )

    setQueue(prev => prev.map(r => {
      const result = results.find(res => res.key === r.key)
      return result ? { ...r, ...result } : r
    }))
    setSubmitting(false)

    // After 1.8s, sweep succeeded rows out and ensure a fresh empty row exists
    setTimeout(() => {
      setQueue(prev => {
        const remaining = prev.filter(r => r.status !== 'success')
        const hasPending = remaining.some(r => r.status === 'pending')
        if (!hasPending) remaining.push({ key: keyCounter.current++, name: '', status: 'pending' })
        return remaining.length > 0 ? remaining : [{ key: keyCounter.current++, name: '', status: 'pending' }]
      })
      setTimeout(() => lastInputRef.current?.focus(), 50)
    }, 1800)
  }

  function clearSucceeded() {
    setQueue(prev => {
      const remaining = prev.filter(r => r.status !== 'success')
      return remaining.length > 0 ? remaining : [{ key: keyCounter.current++, name: '', status: 'pending' }]
    })
  }

  async function handleLink(e: React.FormEvent) {
    e.preventDefault()
    if (!linkParent[0] || linkChildren.length === 0) return
    setSubmitting(true); setLinkStatus({ msg: 'Linking...', kind: 'info' })
    try {
      const res = await fetch('/api/admin/add', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-admin-password': password },
        body: JSON.stringify({
          action: 'link_children',
          parent_id: linkParent[0].id,
          child_ids: linkChildren.map(ch => ch.id),
          acquired_date: linkAcquiredDate || undefined,
          ownership_percentage: linkOwnershipPct ? Number(linkOwnershipPct) : undefined,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Request failed')
      const skipNote = data.skipped > 0 ? ` (${data.skipped} already linked, skipped)` : ''
      setLinkStatus({ msg: `Done — linked ${data.linked} ${data.linked === 1 ? 'entity' : 'entities'} under "${data.parent}"${skipNote}`, kind: 'success' })
      setLinkChildren([])
    } catch (err: any) {
      setLinkStatus({ msg: `Error: ${err.message}`, kind: 'error' })
    } finally { setSubmitting(false) }
  }

  function toggleCat(id: string) {
    setCatIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])
  }

  // Login screen

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

  const panel: React.CSSProperties = {
    background: c.surface, border: `1px solid ${c.border}`, borderRadius: 8,
    padding: 24, display: 'flex', flexDirection: 'column', gap: 18,
  }

  const btnPrimary: React.CSSProperties = {
    padding: '9px 20px', background: c.accent, color: '#fff', border: 0,
    borderRadius: 4, fontSize: 14, cursor: canSubmit ? 'pointer' : 'not-allowed',
    fontWeight: 500, opacity: submitting ? 0.6 : 1,
  }

  const statusBg = (kind: string) =>
    kind === 'success' ? c.successBg : kind === 'error' ? c.dangerBg : c.surface2
  const statusColor = (kind: string) =>
    kind === 'success' ? c.success : kind === 'error' ? c.danger : c.text
  const statusBorder = (kind: string) =>
    kind === 'success' ? c.successBorder : kind === 'error' ? c.dangerBorder : c.border

  return (
    <div style={{ minHeight: '100vh', background: c.bg, color: c.text, fontFamily: 'system-ui, sans-serif' }}>
      <div style={{ maxWidth: 720, margin: '0 auto', padding: '28px 24px' }}>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
          <div>
            <h1 style={{ fontSize: 22, margin: 0 }}>Add Entities</h1>
            <div style={{ fontSize: 13, color: c.muted, marginTop: 2 }}>Create new or link existing entities</div>
          </div>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <a href="/admin/entities" style={{ fontSize: 13, color: c.accent, textDecoration: 'none' }}>Back to entity admin</a>
            <button onClick={() => { sessionStorage.removeItem('admin_password'); setAuthed(false); setPassword('') }}
              style={{ padding: '5px 10px', fontSize: 12, background: c.bg, color: c.textMuted, border: `1px solid ${c.border}`, borderRadius: 4, cursor: 'pointer' }}>
              Sign out
            </button>
          </div>
        </div>

        {/* Mode tabs */}
        <div style={{ display: 'flex', gap: 2, marginBottom: 24, background: c.surface2, borderRadius: 6, padding: 3, width: 'fit-content' }}>
          {(['create', 'link'] as Mode[]).map(m => (
            <button key={m} onClick={() => { setMode(m); setLinkStatus(null) }}
              style={{ padding: '7px 20px', borderRadius: 5, border: 'none', fontSize: 14, cursor: 'pointer', fontWeight: mode === m ? 600 : 400, background: mode === m ? c.bg : 'transparent', color: mode === m ? c.text : c.textMuted, boxShadow: mode === m ? '0 1px 3px rgba(0,0,0,0.1)' : 'none' }}>
              {m === 'create' ? '+ Create new entities' : 'Link existing entities'}
            </button>
          ))}
        </div>

        {/* CREATE MODE */}
        {mode === 'create' && (
          <form onSubmit={handleCreate}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

              {/* Shared template */}
              <div style={panel}>
                <div style={{ fontSize: 13, fontWeight: 600, color: c.textMuted }}>
                  Shared settings — applied to every entity in the list below
                </div>

                <Field label="Type *">
                  <select value={type} onChange={e => setType(e.target.value)} style={{ ...inputBase, width: 'auto' }}>
                    {ENTITY_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                </Field>

                <EntityPicker
                  label="Parent entity (optional)"
                  placeholder="Search by name..."
                  selected={parents}
                  onAdd={e => setParents(prev => [...prev, e])}
                  onRemove={id => setParents(prev => prev.filter(p => p.id !== id))}
                  password={password}
                  multi={true}
                />

                {parents.length > 0 && (
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                    <Field label="Acquired date" hint="Optional — YYYY-MM-DD">
                      <TInput value={acquiredDate} onChange={setAcquiredDate} placeholder="e.g. 2010-03-15" />
                    </Field>
                    <Field label="Ownership %" hint="Optional — 0-100">
                      <TInput value={ownershipPct} onChange={setOwnershipPct} placeholder="e.g. 100" />
                    </Field>
                  </div>
                )}

                <CategoryPicker categories={categories} selected={catIds} primaryId={primaryCatId} onToggle={toggleCat} onSetPrimary={setPrimaryCatId} />
              </div>

              {/* Name queue */}
              <div style={panel}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: c.textMuted }}>
                    Entity names
                    {(pendingQueue.length > 0 || successCount > 0 || errorCount > 0) && (
                      <span style={{ fontWeight: 400, color: c.muted, marginLeft: 6 }}>
                        {pendingQueue.length > 0 && `${pendingQueue.length} to create`}
                        {successCount > 0 && `${pendingQueue.length > 0 ? ', ' : ''}${successCount} created`}
                        {errorCount > 0 && `, ${errorCount} failed`}
                      </span>
                    )}
                  </div>
                  {successCount > 0 && (
                    <button type="button" onClick={clearSucceeded}
                      style={{ fontSize: 12, color: c.muted, background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
                      Clear {successCount} created
                    </button>
                  )}
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {queue.map((row, idx) => (
                    <NameRow
                      key={row.key}
                      item={row}
                      index={idx}
                      isOnly={queue.length === 1}
                      onChange={val => updateName(row.key, val)}
                      onRemove={() => removeRow(row.key)}
                      onEnter={() => handleRowEnter(row.key)}
                      inputRef={idx === queue.length - 1 ? lastInputRef : undefined}
                    />
                  ))}
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                  <button type="button" onClick={addRow}
                    style={{ padding: '6px 14px', fontSize: 13, background: c.bg, color: c.accent, border: `1px solid ${c.accent}`, borderRadius: 4, cursor: 'pointer' }}>
                    + Add row
                  </button>
                  <span style={{ color: c.muted, fontSize: 12 }}>or press Enter in any row</span>
                  <span style={{ color: c.muted, fontSize: 12, marginLeft: 'auto' }}>
                    or{' '}
                    <button
                      type="button"
                      onClick={() => {
                        const el = document.getElementById('paste-zone')
                        el?.focus()
                      }}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', color: c.accent, fontSize: 12, padding: 0, textDecoration: 'underline' }}
                    >
                      paste a list
                    </button>
                  </span>
                </div>

                {/* Paste zone — hidden textarea that accepts multi-line paste from Sheets */}
                <div>
                  <textarea
                    id="paste-zone"
                    rows={3}
                    placeholder={"Paste names here — one per line, or a column from Google Sheets\nLeading/trailing spaces and blank lines are ignored automatically"}
                    onPaste={e => {
                      const text = e.clipboardData.getData('text/plain')
                      if (!text.trim()) return
                      e.preventDefault()
                      pasteNames(text)
                      ;(e.target as HTMLTextAreaElement).value = ''
                    }}
                    onChange={() => {}}
                    style={{
                      width: '100%', padding: '8px 10px', fontSize: 13,
                      boxSizing: 'border-box', borderRadius: 4,
                      border: `1px dashed ${c.border}`,
                      background: c.surface2, color: c.text, outline: 'none',
                      resize: 'vertical', fontFamily: 'inherit',
                    }}
                    onFocus={e => { e.currentTarget.style.borderColor = c.accent }}
                    onBlur={e => { e.currentTarget.style.borderColor = c.border }}
                  />
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 12, paddingTop: 4, borderTop: `1px solid ${c.border}` }}>
                  <button type="submit" disabled={!canSubmit} style={btnPrimary}>
                    {submitting
                      ? `Creating ${pendingQueue.length}...`
                      : `Create ${pendingQueue.length > 0 ? pendingQueue.length + ' ' : ''}${pendingQueue.length === 1 ? 'entity' : 'entities'}`}
                  </button>
                  {pendingQueue.length === 0 && !submitting && (
                    <span style={{ fontSize: 12, color: c.muted }}>Enter at least one name above</span>
                  )}
                </div>
              </div>
            </div>
          </form>
        )}

        {/* LINK MODE */}
        {mode === 'link' && (
          <form onSubmit={handleLink}>
            <div style={panel}>
              {linkStatus && (
                <div style={{ padding: '10px 14px', borderRadius: 6, fontSize: 14, background: statusBg(linkStatus.kind), color: statusColor(linkStatus.kind), border: `1px solid ${statusBorder(linkStatus.kind)}` }}>
                  {linkStatus.msg}
                </div>
              )}

              <EntityPicker label="Parent entity *" placeholder="Search for the parent..." selected={linkParent}
                onAdd={e => setLinkParent([e])} onRemove={() => setLinkParent([])} password={password} multi={false} />

              <EntityPicker label="Children to link *" placeholder="Search for entities to attach..." selected={linkChildren}
                onAdd={e => setLinkChildren(prev => [...prev, e])} onRemove={id => setLinkChildren(prev => prev.filter(ch => ch.id !== id))} password={password} multi={true} />

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <Field label="Acquired date" hint="Optional — applied to all new edges">
                  <TInput value={linkAcquiredDate} onChange={setLinkAcquiredDate} placeholder="e.g. 2010-03-15" />
                </Field>
                <Field label="Ownership %" hint="Optional — applied to all new edges">
                  <TInput value={linkOwnershipPct} onChange={setLinkOwnershipPct} placeholder="e.g. 100" />
                </Field>
              </div>

              <div style={{ background: c.surface2, borderRadius: 6, padding: '10px 14px', fontSize: 13, color: c.textMuted }}>
                Duplicate edges (same parent + child, no divested date) are detected and skipped automatically.
              </div>

              <div>
                <button type="submit" disabled={submitting || !linkParent[0] || linkChildren.length === 0}
                  style={{ ...btnPrimary, cursor: (!submitting && linkParent[0] && linkChildren.length > 0) ? 'pointer' : 'not-allowed' }}>
                  {submitting ? 'Linking...' : `Link ${linkChildren.length > 0 ? linkChildren.length + ' ' : ''}${linkChildren.length === 1 ? 'entity' : 'entities'}`}
                </button>
              </div>
            </div>
          </form>
        )}

        <div style={{ marginTop: 28, paddingTop: 18, borderTop: `1px solid ${c.border}`, display: 'flex', gap: 16 }}>
          <a href="/admin/categorize" style={{ fontSize: 13, color: c.accent, textDecoration: 'none' }}>Categorize</a>
          <a href="/admin/entities" style={{ fontSize: 13, color: c.accent, textDecoration: 'none' }}>Entity admin</a>
        </div>

      </div>
    </div>
  )
}