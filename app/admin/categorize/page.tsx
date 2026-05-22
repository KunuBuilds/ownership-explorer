'use client'

import { useState, useEffect, useMemo, useCallback, useRef } from 'react'

// ── Types ──────────────────────────────────────────────────────────────────
interface Category {
  id:              string
  name:            string
  parent_id:       string | null
  level:           number
  sort_order:      number
  explicit_count:  number
  primary_count:   number
  effective_count: number
}

interface QueueEntity {
  id:                     string
  name:                   string
  type:                   string
  parent_id:              string | null
  parent_name:            string | null
  inherited_category_ids: string[]
  explicit_categories:    { category_id: string; is_primary: boolean }[]
}

type Mode = 'queue' | 'bulk'

// Force light theme for admin, matching /admin/entities
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
  inherit:   '#ebf2ff',
}

export default function CategorizePage() {
  // ── Auth ────────────────────────────────────────────────────────────────
  const [password, setPassword] = useState('')
  const [authed, setAuthed] = useState(false)
  const [authError, setAuthError] = useState('')

  // ── Shared data ─────────────────────────────────────────────────────────
  const [categories, setCategories] = useState<Category[]>([])
  const [mode, setMode] = useState<Mode>('queue')
  const [status, setStatus] = useState<{ msg: string; kind: 'info' | 'success' | 'error' } | null>(null)

  // ── Filters (shared between modes) ──────────────────────────────────────
  const [typeFilter, setTypeFilter] = useState<string>('brand,conglomerate')
  const [search, setSearch]         = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 200)
    return () => clearTimeout(t)
  }, [search])

  // Parent filter — entity ID (e.g. 'mondelez') and scope ('direct' | 'subtree')
  const [parentFilter, setParentFilter] = useState<string>('')
  const [parentScope, setParentScope]   = useState<'direct' | 'subtree'>('subtree')
  // Category filter — show entities effectively in this category
  const [categoryFilter, setCategoryFilter] = useState<string>('')
  // When true, the queue includes entities that already have explicit categories,
  // so the admin can recategorize them instead of just adding to uncategorized ones.
  const [includeCategorized, setIncludeCategorized] = useState(false)
  // Lightweight list of all entities — used to populate the parent filter datalist.
  // Loaded once on auth so the user can autocomplete by name or slug.
  const [allEntities, setAllEntities] = useState<{ id: string; name: string; type: string }[]>([])

  // ── Queue state ─────────────────────────────────────────────────────────
  const [queue, setQueue] = useState<QueueEntity[]>([])
  const [queueTotal, setQueueTotal] = useState(0)
  const [queueLoading, setQueueLoading] = useState(false)
  const [cursorIndex, setCursorIndex] = useState(0)
  const [selectedCategoryId, setSelectedCategoryId] = useState('')
  const [markAsPrimary, setMarkAsPrimary] = useState(true)
  const categoryInputRef = useRef<HTMLInputElement>(null)

  // ── Bulk state ──────────────────────────────────────────────────────────
  const [bulkSelectedIds, setBulkSelectedIds] = useState<Set<string>>(new Set())
  const [bulkCategoryId, setBulkCategoryId] = useState('')
  const [bulkPrimary, setBulkPrimary] = useState(false)

  // ── Sidebar expand/collapse state ───────────────────────────────────────
  // Tracks which categories are expanded. By default, level-1 categories are
  // collapsed (their level-2 children are hidden) until the user clicks them.
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())

  function toggleExpanded(id: string) {
    setExpandedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  function expandCategory(id: string) {
    setExpandedIds(prev => {
      if (prev.has(id)) return prev
      const next = new Set(prev)
      next.add(id)
      return next
    })
  }

  // ── Body theme override ─────────────────────────────────────────────────
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

  // ── Auth handlers ───────────────────────────────────────────────────────
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

  // ── Data loading ────────────────────────────────────────────────────────
  const loadCoverage = useCallback(async () => {
    const res = await fetch('/api/admin/categorize?action=coverage', {
      headers: { 'x-admin-password': password },
    })
    if (!res.ok) return
    const data = await res.json()
    setCategories(data.coverage ?? [])
  }, [password])

  const loadQueue = useCallback(async () => {
    if (!authed) return
    setQueueLoading(true)
    try {
      const params = new URLSearchParams({
        action: 'queue',
        types: typeFilter,
        limit: '100',
      })
      if (debouncedSearch) params.set('search', debouncedSearch)
      if (parentFilter)    params.set('parent_id', parentFilter)
      if (parentFilter)    params.set('parent_scope', parentScope)
      if (categoryFilter)  params.set('category_id', categoryFilter)
      if (includeCategorized) params.set('include_categorized', '1')
      const res = await fetch(`/api/admin/categorize?${params}`, {
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
  }, [authed, password, typeFilter, debouncedSearch, parentFilter, parentScope, categoryFilter, includeCategorized])

  // Load the full entity list once for the parent autocomplete datalist.
  // Reuses the existing /api/admin/entities?list=parents route from /admin/entities.
  useEffect(() => {
    if (!authed) return
    fetch('/api/admin/entities?list=parents', {
      headers: { 'x-admin-password': password },
    })
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data?.allEntities) setAllEntities(data.allEntities)
      })
      .catch(() => { /* non-fatal */ })
  }, [authed, password])

  useEffect(() => { if (authed) { loadCoverage(); loadQueue() } }, [authed, loadCoverage, loadQueue])

  // ── Derived ─────────────────────────────────────────────────────────────
  const categoriesById = useMemo(() => new Map(categories.map(c => [c.id, c])), [categories])

  // Build a hierarchical, alphabetically-resolved list for the category picker
  // Level 1 -> bold label, level 2/3 -> indented children. We flatten for a
  // simple <datalist>-like picker but keep display-friendly labels.
  const categoryPickerOptions = useMemo(() => {
    // Sort by level, then sort_order, then name — matches your category tree convention.
    // Null-safe: if any field is missing on a row, fall back to sane defaults so a single
    // bad row can't crash the whole page.
    return [...categories].sort((a, b) => {
      const lvl = (a.level ?? 99) - (b.level ?? 99)
      if (lvl !== 0) return lvl
      const ord = (a.sort_order ?? 999) - (b.sort_order ?? 999)
      if (ord !== 0) return ord
      return (a.name ?? a.id ?? '').localeCompare(b.name ?? b.id ?? '')
    })
  }, [categories])

  // Tree-ordered list: parents immediately followed by their descendants, depth-first.
  // Used for the sidebar so the visual indentation actually matches parent/child structure.
  // The flat `categoryPickerOptions` above is still used for the datalist autocomplete,
  // where the ordering doesn't affect search.
  const categoryTreeOrder = useMemo(() => {
    const childrenByParent = new Map<string | null, Category[]>()
    for (const c of categories) {
      const key = c.parent_id ?? null
      const arr = childrenByParent.get(key) ?? []
      arr.push(c)
      childrenByParent.set(key, arr)
    }
    // Sort each sibling group
    for (const arr of childrenByParent.values()) {
      arr.sort((a, b) =>
        (a.sort_order ?? 999) - (b.sort_order ?? 999)
        || (a.name ?? a.id ?? '').localeCompare(b.name ?? b.id ?? '')
      )
    }
    const ordered: Category[] = []
    function walk(parentId: string | null) {
      const kids = childrenByParent.get(parentId) ?? []
      for (const k of kids) {
        ordered.push(k)
        walk(k.id)
      }
    }
    walk(null)
    return ordered
  }, [categories])

  // For each category, does it have any children? (Drives the disclosure triangle.)
  const hasChildren = useMemo(() => {
    const set = new Set<string>()
    for (const c of categories) {
      if (c.parent_id) set.add(c.parent_id)
    }
    return set
  }, [categories])

  // Visible sidebar rows: filter the tree order down to nodes whose entire ancestor
  // chain is expanded. Level-1 categories are always visible.
  const visibleSidebarCategories = useMemo(() => {
    const byId = new Map(categories.map(c => [c.id, c]))
    return categoryTreeOrder.filter(c => {
      // Walk up the chain — every ancestor must be in `expandedIds`.
      let cursor: Category | undefined = c
      while (cursor && cursor.parent_id) {
        if (!expandedIds.has(cursor.parent_id)) return false
        cursor = byId.get(cursor.parent_id)
      }
      return true
    })
  }, [categoryTreeOrder, categories, expandedIds])

  const currentQueueEntity = queue[cursorIndex]

  // ── Queue actions ───────────────────────────────────────────────────────
  async function assignToCurrent(categoryId: string, isPrimary: boolean) {
    if (!currentQueueEntity || !categoryId) return
    try {
      const res = await fetch('/api/admin/categorize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-admin-password': password },
        body: JSON.stringify({
          action: 'assign',
          entity_id: currentQueueEntity.id,
          category_id: categoryId,
          is_primary: isPrimary,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Request failed')

      setStatus({
        msg: `✓ ${currentQueueEntity.name} → ${categoriesById.get(categoryId)?.name ?? categoryId}`,
        kind: 'success',
      })

      if (includeCategorized) {
        // Edit-in-place: update this row's explicit_categories so the user can
        // continue refining without losing their cursor position.
        setQueue(prev => prev.map((q, i) => {
          if (i !== cursorIndex) return q
          const filteredOut = q.explicit_categories.filter(ec =>
            !(isPrimary && ec.is_primary)  // primary flag swap clears any prior primary
          )
          const existing = filteredOut.find(ec => ec.category_id === categoryId)
          const next = existing
            ? filteredOut.map(ec => ec.category_id === categoryId ? { ...ec, is_primary: isPrimary } : ec)
            : [...filteredOut, { category_id: categoryId, is_primary: isPrimary }]
          return { ...q, explicit_categories: next, inherited_category_ids: [] }
        }))
      } else {
        // Original behavior: drop the entity from the queue, advance cursor implicitly.
        setQueue(prev => prev.filter((_, i) => i !== cursorIndex))
        setQueueTotal(t => Math.max(0, t - 1))
      }

      setSelectedCategoryId('')
      setTimeout(() => categoryInputRef.current?.focus(), 10)
      loadCoverage()
    } catch (err: any) {
      setStatus({ msg: 'Error: ' + err.message, kind: 'error' })
    }
  }

  async function unassignFromCurrent(categoryId: string) {
    if (!currentQueueEntity) return
    try {
      const res = await fetch('/api/admin/categorize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-admin-password': password },
        body: JSON.stringify({
          action: 'unassign',
          entity_id: currentQueueEntity.id,
          category_id: categoryId,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Request failed')

      setStatus({
        msg: `✓ Removed ${categoriesById.get(categoryId)?.name ?? categoryId} from ${currentQueueEntity.name}`,
        kind: 'success',
      })

      setQueue(prev => prev.map((q, i) =>
        i === cursorIndex
          ? { ...q, explicit_categories: q.explicit_categories.filter(ec => ec.category_id !== categoryId) }
          : q
      ))
      loadCoverage()
    } catch (err: any) {
      setStatus({ msg: 'Error: ' + err.message, kind: 'error' })
    }
  }

  async function skipCurrent() {
    // "Skip" just advances without assigning — the entity stays uncategorized
    // and will reappear next time the queue is reloaded.
    setQueue(prev => prev.filter((_, i) => i !== cursorIndex))
    setSelectedCategoryId('')
    setTimeout(() => categoryInputRef.current?.focus(), 10)
  }

  async function acceptInherited() {
    // Shortcut: if the entity is inheriting a category, stamp that as explicit
    // (keeps the effective categorization but marks it as intentional).
    if (!currentQueueEntity?.inherited_category_ids.length) return
    const catId = currentQueueEntity.inherited_category_ids[0]
    await assignToCurrent(catId, markAsPrimary)
  }

  // ── Keyboard shortcuts for queue mode ──────────────────────────────────
  useEffect(() => {
    if (mode !== 'queue') return
    function onKey(e: KeyboardEvent) {
      // Don't trigger while typing in an input unless it's the category input with Enter
      const target = e.target as HTMLElement
      const inCategoryInput = target === categoryInputRef.current
      const inOtherInput = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT'

      if (e.key === 'Enter' && inCategoryInput) {
        e.preventDefault()
        // Resolve typed value to a category id
        const value = (target as HTMLInputElement).value.trim()
        if (!value) return
        const match = categoryPickerOptions.find(c =>
          c.id === value || c.name.toLowerCase() === value.toLowerCase()
        )
        if (match) {
          assignToCurrent(match.id, markAsPrimary)
        } else {
          setStatus({ msg: `No category matches "${value}"`, kind: 'error' })
        }
        return
      }

      if (inOtherInput) return

      if (e.key === 'ArrowDown' || e.key === 'j') {
        e.preventDefault()
        setCursorIndex(i => Math.min(queue.length - 1, i + 1))
      } else if (e.key === 'ArrowUp' || e.key === 'k') {
        e.preventDefault()
        setCursorIndex(i => Math.max(0, i - 1))
      } else if (e.key === 's') {
        e.preventDefault()
        skipCurrent()
      } else if (e.key === 'i') {
        e.preventDefault()
        acceptInherited()
      } else if (e.key === 'p') {
        e.preventDefault()
        setMarkAsPrimary(v => !v)
      } else if (e.key === '/') {
        e.preventDefault()
        categoryInputRef.current?.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [mode, queue, cursorIndex, categoryPickerOptions, markAsPrimary, currentQueueEntity])

  // ── Bulk actions ────────────────────────────────────────────────────────
  function toggleBulkSelect(id: string) {
    setBulkSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  function toggleBulkSelectAll() {
    if (bulkSelectedIds.size === queue.length) setBulkSelectedIds(new Set())
    else setBulkSelectedIds(new Set(queue.map(e => e.id)))
  }

  async function applyBulk() {
    if (!bulkSelectedIds.size || !bulkCategoryId) return
    const cat = categoriesById.get(bulkCategoryId)
    if (!confirm(`Assign category "${cat?.name ?? bulkCategoryId}" to ${bulkSelectedIds.size} ${bulkSelectedIds.size === 1 ? 'entity' : 'entities'}${bulkPrimary ? ' (as primary)' : ''}?`)) return

    setStatus({ msg: 'Applying...', kind: 'info' })
    try {
      const res = await fetch('/api/admin/categorize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-admin-password': password },
        body: JSON.stringify({
          action: 'bulk_assign',
          entity_ids: [...bulkSelectedIds],
          category_id: bulkCategoryId,
          is_primary: bulkPrimary,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Request failed')
      setStatus({ msg: `✓ Assigned ${data.inserted} entities to ${cat?.name ?? bulkCategoryId}`, kind: 'success' })
      setBulkSelectedIds(new Set())
      await Promise.all([loadQueue(), loadCoverage()])
    } catch (err: any) {
      setStatus({ msg: 'Error: ' + err.message, kind: 'error' })
    }
  }

  // ── Style helpers ───────────────────────────────────────────────────────
  const inputStyle = {
    background: colors.bg,
    color: colors.text,
    border: `1px solid ${colors.border}`,
    borderRadius: 4,
    outline: 'none',
    boxSizing: 'border-box' as const,
  }

  const labelStyle = {
    display: 'block',
    fontSize: 11,
    textTransform: 'uppercase' as const,
    letterSpacing: '0.1em',
    color: colors.textMuted,
    marginBottom: 6,
    fontWeight: 600,
  }

  // ── Login screen ────────────────────────────────────────────────────────
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
            <button type="submit" style={{ marginTop: 12, width: '100%', padding: '10px 12px', background: colors.accent, color: '#fff', border: 0, borderRadius: 4, fontSize: 14, cursor: 'pointer', fontWeight: 500 }}>
              Sign in
            </button>
          </form>
        </div>
      </div>
    )
  }

  // ── Main render ─────────────────────────────────────────────────────────
  return (
    <div style={{ minHeight: '100vh', background: colors.bg, color: colors.text, fontFamily: 'system-ui, sans-serif' }}>
      <div style={{ display: 'grid', gridTemplateColumns: '280px 1fr', minHeight: '100vh' }}>

        {/* ── Sidebar: category tree with counts ─────────────────────── */}
        <aside style={{ borderRight: `1px solid ${colors.border}`, background: colors.surface, padding: '24px 16px', overflowY: 'auto', position: 'sticky', top: 0, height: '100vh' }}>
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.1em', color: colors.textMuted, marginBottom: 4 }}>
              Coverage
            </div>
            <div style={{ fontSize: 22, fontWeight: 600 }}>
              {categories.reduce((a, c) => a + (c.explicit_count ?? 0), 0).toLocaleString()}
              <span style={{ fontSize: 12, fontWeight: 400, color: colors.textMuted, marginLeft: 6 }}>explicit</span>
            </div>
            <div style={{ fontSize: 11, color: colors.muted, marginTop: 2 }}>
              tree counts include cascade
            </div>
          </div>

          <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.1em', color: colors.textMuted, marginBottom: 10 }}>
            Categories
          </div>
          <div style={{ fontSize: 13 }}>
            {visibleSidebarCategories.map(c => {
              const expandable = hasChildren.has(c.id)
              const expanded   = expandedIds.has(c.id)
              return (
                <div
                  key={c.id}
                  style={{
                    padding: '4px 6px',
                    paddingLeft: 6 + (c.level - 1) * 14,
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    borderRadius: 3,
                    cursor: 'pointer',
                    fontWeight: c.level === 1 ? 600 : 400,
                    color: c.level === 1 ? colors.text : colors.textMuted,
                    background: selectedCategoryId === c.id || bulkCategoryId === c.id ? colors.inherit : 'transparent',
                  }}
                  onClick={() => {
                    // Click on the row body: select this category AND auto-expand it
                    // (so the user can immediately see its children to potentially
                    // refine the assignment).
                    if (mode === 'queue') setSelectedCategoryId(c.id)
                    else setBulkCategoryId(c.id)
                    if (expandable && !expanded) expandCategory(c.id)
                  }}
                  title={c.id}
                >
                  <span style={{ display: 'flex', alignItems: 'center', gap: 4, overflow: 'hidden', flex: 1 }}>
                    {/* Disclosure triangle — clickable independently of the row */}
                    <span
                      onClick={ev => {
                        if (!expandable) return
                        ev.stopPropagation()
                        toggleExpanded(c.id)
                      }}
                      style={{
                        display: 'inline-block',
                        width: 12,
                        textAlign: 'center',
                        fontSize: 9,
                        color: colors.muted,
                        cursor: expandable ? 'pointer' : 'default',
                        flexShrink: 0,
                      }}
                      aria-hidden={!expandable}
                    >
                      {expandable ? (expanded ? '▾' : '▸') : ''}
                    </span>
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {c.name}
                    </span>
                  </span>
                  {(() => {
                    const effective = c.effective_count ?? 0
                    if (effective === 0) return null
                    const direct = c.explicit_count ?? 0
                    return (
                      <span style={{ fontSize: 10, color: colors.textMuted, fontFamily: 'monospace', marginLeft: 6, flexShrink: 0 }}>
                        {effective}
                        {direct > 0 && direct !== effective && (
                          <span style={{ color: colors.muted, marginLeft: 3 }}>({direct})</span>
                        )}
                      </span>
                    )
                  })()}
                </div>
              )
            })}
          </div>
        </aside>

        {/* ── Main panel ──────────────────────────────────────────────── */}
        <main style={{ padding: 24, maxWidth: 1000 }}>
          {/* Header */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
            <h1 style={{ fontSize: 22, margin: 0 }}>Categorize Entities</h1>
            <div style={{ display: 'flex', gap: 8 }}>
              <a href="/admin/entities" style={{ padding: '6px 12px', fontSize: 12, background: colors.bg, color: colors.textMuted, border: `1px solid ${colors.border}`, borderRadius: 4, textDecoration: 'none' }}>
                Entities →
              </a>
              <button
                onClick={() => { sessionStorage.removeItem('admin_password'); setAuthed(false); setPassword('') }}
                style={{ padding: '6px 12px', fontSize: 12, background: colors.bg, color: colors.textMuted, border: `1px solid ${colors.border}`, borderRadius: 4, cursor: 'pointer' }}
              >
                Sign out
              </button>
            </div>
          </div>

          {/* Mode toggle */}
          <div style={{ display: 'flex', gap: 0, marginBottom: 20, border: `1px solid ${colors.border}`, borderRadius: 4, overflow: 'hidden', width: 'fit-content' }}>
            {(['queue', 'bulk'] as Mode[]).map(m => (
              <button
                key={m}
                onClick={() => setMode(m)}
                style={{
                  padding: '8px 20px',
                  fontSize: 13,
                  fontWeight: 500,
                  background: mode === m ? colors.accent : colors.bg,
                  color: mode === m ? '#fff' : colors.textMuted,
                  border: 0,
                  cursor: 'pointer',
                }}
              >
                {m === 'queue' ? 'Queue' : 'Bulk'}
              </button>
            ))}
          </div>

          {/* Shared filters — primary row */}
          <div style={{ display: 'flex', gap: 12, marginBottom: 12, flexWrap: 'wrap' }}>
            <div style={{ flex: 1, minWidth: 200 }}>
              <label style={labelStyle}>Search</label>
              <input
                type="text"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Filter by name..."
                style={{ ...inputStyle, width: '100%', padding: '8px 10px', fontSize: 14 }}
              />
            </div>
            <div>
              <label style={labelStyle}>Types</label>
              <select
                value={typeFilter}
                onChange={e => setTypeFilter(e.target.value)}
                style={{ ...inputStyle, padding: '8px 10px', fontSize: 14 }}
              >
                <option value="brand,conglomerate">Brands + Conglomerates</option>
                <option value="brand">Brands only</option>
                <option value="conglomerate">Conglomerates only</option>
                <option value="subsidiary">Subsidiaries</option>
                <option value="brand,conglomerate,subsidiary,product,legal-entity">All types</option>
              </select>
            </div>
          </div>

          {/* Shared filters — refinement row */}
          <div style={{ display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <div style={{ flex: 1, minWidth: 220 }}>
              <label style={labelStyle}>Parent company</label>
              <input
                type="text"
                list="parent-filter-options"
                value={parentFilter}
                onChange={e => setParentFilter(e.target.value)}
                placeholder="e.g. mondelez (or any entity slug)"
                style={{ ...inputStyle, width: '100%', padding: '8px 10px', fontSize: 14 }}
              />
              <datalist id="parent-filter-options">
                {allEntities.map(e => (
                  <option key={e.id} value={e.id}>{e.name} ({e.type})</option>
                ))}
              </datalist>
            </div>
            <div>
              <label style={labelStyle}>Scope</label>
              <select
                value={parentScope}
                onChange={e => setParentScope(e.target.value as 'direct' | 'subtree')}
                disabled={!parentFilter}
                style={{ ...inputStyle, padding: '8px 10px', fontSize: 14, opacity: parentFilter ? 1 : 0.5 }}
              >
                <option value="subtree">Anywhere in subtree</option>
                <option value="direct">Direct children only</option>
              </select>
            </div>
            <div style={{ flex: 1, minWidth: 200 }}>
              <label style={labelStyle}>Current category</label>
              <input
                type="text"
                list="cat-filter-options"
                value={categoryFilter}
                onChange={e => setCategoryFilter(e.target.value)}
                placeholder="Filter by effective category"
                style={{ ...inputStyle, width: '100%', padding: '8px 10px', fontSize: 14 }}
              />
              <datalist id="cat-filter-options">
                {categoryPickerOptions.map((c: Category) => (
                  <option key={c.id} value={c.id}>{c.name} (L{c.level})</option>
                ))}
              </datalist>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', height: 38 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: colors.textMuted, cursor: 'pointer', whiteSpace: 'nowrap' }}>
                <input
                  type="checkbox"
                  checked={includeCategorized}
                  onChange={e => setIncludeCategorized(e.target.checked)}
                />
                Include categorized
              </label>
            </div>
            {(parentFilter || categoryFilter || includeCategorized) && (
              <button
                onClick={() => {
                  setParentFilter('')
                  setCategoryFilter('')
                  setIncludeCategorized(false)
                }}
                style={{
                  padding: '8px 12px', fontSize: 12,
                  background: colors.bg, color: colors.textMuted,
                  border: `1px solid ${colors.border}`, borderRadius: 4,
                  cursor: 'pointer', height: 38,
                }}
              >
                Clear filters
              </button>
            )}
          </div>

          {/* Status */}
          {status && (
            <div style={{
              padding: 10,
              marginBottom: 16,
              borderRadius: 4,
              fontSize: 13,
              background:
                status.kind === 'error' ? '#fdeaea' :
                status.kind === 'success' ? '#e8f5e9' : '#e3f2fd',
              color:
                status.kind === 'error' ? colors.danger :
                status.kind === 'success' ? colors.success : colors.accent,
              border: `1px solid ${
                status.kind === 'error' ? '#f5c2c2' :
                status.kind === 'success' ? '#c8e6c9' : '#bbdefb'
              }`,
            }}>{status.msg}</div>
          )}

          {queueLoading ? (
            <div style={{ padding: 40, textAlign: 'center', color: colors.textMuted }}>Loading...</div>
          ) : mode === 'queue' ? (
            <QueueMode
              queue={queue}
              queueTotal={queueTotal}
              cursorIndex={cursorIndex}
              setCursorIndex={setCursorIndex}
              selectedCategoryId={selectedCategoryId}
              setSelectedCategoryId={setSelectedCategoryId}
              markAsPrimary={markAsPrimary}
              setMarkAsPrimary={setMarkAsPrimary}
              categoryPickerOptions={categoryPickerOptions}
              categoriesById={categoriesById}
              categoryInputRef={categoryInputRef}
              onAssign={assignToCurrent}
              onUnassign={unassignFromCurrent}
              onSkip={skipCurrent}
              onAcceptInherited={acceptInherited}
              colors={colors}
              inputStyle={inputStyle}
              password={password}
              allCategories={categories}
              onCategoryCreated={loadCoverage}
            />
          ) : (
            <BulkMode
              queue={queue}
              queueTotal={queueTotal}
              bulkSelectedIds={bulkSelectedIds}
              toggleBulkSelect={toggleBulkSelect}
              toggleBulkSelectAll={toggleBulkSelectAll}
              bulkCategoryId={bulkCategoryId}
              setBulkCategoryId={setBulkCategoryId}
              bulkPrimary={bulkPrimary}
              setBulkPrimary={setBulkPrimary}
              categoryPickerOptions={categoryPickerOptions}
              categoriesById={categoriesById}
              onApply={applyBulk}
              colors={colors}
              inputStyle={inputStyle}
            />
          )}
        </main>
      </div>
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════════════
// Queue Mode — one entity at a time, keyboard-driven
// ══════════════════════════════════════════════════════════════════════════════

function QueueMode({
  queue, queueTotal, cursorIndex, setCursorIndex,
  selectedCategoryId, setSelectedCategoryId,
  markAsPrimary, setMarkAsPrimary,
  categoryPickerOptions, categoriesById, categoryInputRef,
  onAssign, onUnassign, onSkip, onAcceptInherited,
  colors, inputStyle,
  password, allCategories, onCategoryCreated,
}: any) {
  const current = queue[cursorIndex]
  const [aiLoading, setAiLoading] = useState(false)
  const [aiSuggestion, setAiSuggestion] = useState<{ category_id: string; category_name: string; reason: string } | null>(null)
  const [aiError, setAiError] = useState<string | null>(null)

  const [descText, setDescText]       = useState('')
  const [descLoading, setDescLoading] = useState(false)
  const [descSaved, setDescSaved]     = useState(false)
  const [descError, setDescError]     = useState<string | null>(null)

  const [newCatLoading, setNewCatLoading] = useState(false)
  const [newCatProposal, setNewCatProposal] = useState<{
    name: string; parent_id: string; parent_name: string; level: number; reason: string
  } | null>(null)
  const [newCatError, setNewCatError]     = useState<string | null>(null)
  const [newCatCreating, setNewCatCreating] = useState(false)

  // Clear AI state when the current entity changes
  useEffect(() => {
    setAiSuggestion(null)
    setAiError(null)
    setDescText('')
    setDescSaved(false)
    setDescError(null)
    setNewCatProposal(null)
    setNewCatError(null)
  }, [current?.id])

  async function handleSuggestNew() {
    if (!current) return
    setNewCatLoading(true)
    setNewCatProposal(null)
    setNewCatError(null)
    try {
      const res = await fetch('/api/admin/categorize-suggest/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-admin-password': password },
        body: JSON.stringify({
          action:      'suggest_new',
          entity_name: current.name,
          entity_type: current.type,
          parent_name: current.parent_name ?? null,
          categories:  allCategories,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Request failed')
      setNewCatProposal(data)
    } catch (err: any) {
      setNewCatError(err.message)
    } finally {
      setNewCatLoading(false)
    }
  }

  async function handleCreateCategory() {
    if (!newCatProposal) return
    setNewCatCreating(true)
    try {
      const res = await fetch('/api/admin/categorize/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-admin-password': password },
        body: JSON.stringify({
          action:    'create_category',
          name:      newCatProposal.name,
          parent_id: newCatProposal.parent_id,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Request failed')
      // Reload category list in parent, then auto-select the new category
      await onCategoryCreated()
      setSelectedCategoryId(data.category.id)
      setNewCatProposal(null)
    } catch (err: any) {
      setNewCatError(err.message)
    } finally {
      setNewCatCreating(false)
    }
  }

  async function handleDescGenerate() {
    if (!current) return
    setDescLoading(true)
    setDescError(null)
    // Resolve best available category name for context
    const catId =
      selectedCategoryId ||
      current.explicit_categories?.[0]?.category_id ||
      current.inherited_category_ids?.[0] ||
      null
    const category = catId ? (categoriesById.get(catId)?.name ?? null) : null
    try {
      const res = await fetch('/api/admin/entity-description/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-admin-password': password },
        body: JSON.stringify({
          action:      'generate',
          entity_name: current.name,
          entity_type: current.type,
          parent_name: current.parent_name ?? null,
          category,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Request failed')
      setDescText(data.description)
      setDescSaved(false)
    } catch (err: any) {
      setDescError(err.message)
    } finally {
      setDescLoading(false)
    }
  }

  async function handleDescSave() {
    if (!current || !descText.trim()) return
    setDescLoading(true)
    setDescError(null)
    try {
      const res = await fetch('/api/admin/entity-description/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-admin-password': password },
        body: JSON.stringify({ action: 'save', entity_id: current.id, description: descText.trim() }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Request failed')
      setDescSaved(true)
    } catch (err: any) {
      setDescError(err.message)
    } finally {
      setDescLoading(false)
    }
  }

  async function handleAiSuggest() {
    if (!current) return
    setAiLoading(true)
    setAiSuggestion(null)
    setAiError(null)
    try {
      const res = await fetch('/api/admin/categorize-suggest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-admin-password': password },
        body: JSON.stringify({
          entity_name: current.name,
          entity_type: current.type,
          parent_name: current.parent_name ?? null,
          categories:  allCategories,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Request failed')
      setAiSuggestion(data)
      // Auto-populate the category picker
      setSelectedCategoryId(data.category_id)
    } catch (err: any) {
      setAiError(err.message)
    } finally {
      setAiLoading(false)
    }
  }

  if (!queue.length) {
    return (
      <div style={{ padding: 40, textAlign: 'center', border: `1px solid ${colors.border}`, borderRadius: 4, background: colors.surface }}>
        <div style={{ fontSize: 32, marginBottom: 8 }}>✓</div>
        <div style={{ fontSize: 14, color: colors.text, marginBottom: 4 }}>Queue is clear</div>
        <div style={{ fontSize: 12, color: colors.textMuted }}>All entities matching your filters have categories.</div>
      </div>
    )
  }

  return (
    <div>
      {/* Progress */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, fontSize: 12, color: colors.textMuted }}>
        <span>
          <strong style={{ color: colors.text }}>{cursorIndex + 1}</strong> of {queue.length} loaded
          {queueTotal > queue.length && <> · {queueTotal - queue.length} more after this batch</>}
        </span>
        <span style={{ fontFamily: 'monospace', fontSize: 11 }}>
          ↑↓/jk: navigate · /: focus category · ↵: assign · i: accept inherited · p: toggle primary · s: skip
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
            </div>
          </div>
          <span style={{
            display: 'inline-block', padding: '2px 8px', fontSize: 10, fontWeight: 600,
            color: current.type === 'brand' ? '#6a3fa0' : '#a86b0a',
            background: current.type === 'brand' ? '#f3ebff' : '#fff4e0',
            borderRadius: 3, textTransform: 'uppercase', letterSpacing: '0.05em',
          }}>{current.type}</span>
        </div>

        {/* Existing explicit categories — only shown when entity already has assignments
            (i.e. when admin is editing rather than tagging fresh from queue) */}
        {current.explicit_categories?.length > 0 && (
          <div style={{ padding: 10, background: '#fff8dc', borderRadius: 4, marginBottom: 16, fontSize: 13 }}>
            <div style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', color: colors.textMuted, marginBottom: 4 }}>
              Already categorized
            </div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
              {current.explicit_categories.map((ec: { category_id: string; is_primary: boolean }) => (
                <span key={ec.category_id} style={{
                  display: 'inline-flex', alignItems: 'center', gap: 4,
                  padding: '2px 4px 2px 8px', background: '#fff',
                  border: `1px solid ${ec.is_primary ? colors.accent : colors.border}`,
                  borderRadius: 3, fontSize: 12,
                }}>
                  {ec.is_primary && (
                    <span style={{ fontSize: 9, color: colors.accent, fontWeight: 600, marginRight: 2 }}>★</span>
                  )}
                  {categoriesById.get(ec.category_id)?.name ?? ec.category_id}
                  <button
                    onClick={() => onUnassign(ec.category_id)}
                    title="Remove this assignment"
                    style={{
                      marginLeft: 2, padding: '0 6px',
                      background: 'transparent', color: colors.muted,
                      border: 0, fontSize: 14, lineHeight: 1, cursor: 'pointer',
                    }}
                  >×</button>
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Inherited hint */}
        {current.inherited_category_ids.length > 0 && (
          <div style={{ padding: 10, background: colors.inherit, borderRadius: 4, marginBottom: 16, fontSize: 13 }}>
            <div style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', color: colors.textMuted, marginBottom: 4 }}>
              Currently inherits from ancestor
            </div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
              {current.inherited_category_ids.map((cid: string) => (
                <span key={cid} style={{ padding: '2px 8px', background: '#fff', border: `1px solid ${colors.border}`, borderRadius: 3, fontSize: 12 }}>
                  {categoriesById.get(cid)?.name ?? cid}
                </span>
              ))}
              <button
                onClick={onAcceptInherited}
                style={{ marginLeft: 8, padding: '2px 10px', fontSize: 11, background: colors.accent, color: '#fff', border: 0, borderRadius: 3, cursor: 'pointer' }}
              >
                Accept (i)
              </button>
            </div>
          </div>
        )}

        {/* AI suggestion banner */}
        {aiSuggestion && (
          <div style={{ padding: '10px 14px', background: '#f0f7ff', border: '1px solid #b3d4f5', borderLeft: '3px solid #0066cc', borderRadius: 4, marginBottom: 14, fontSize: 13 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', color: '#0066cc' }}>AI Suggestion</span>
              <strong style={{ color: '#1a1a1a' }}>{aiSuggestion.category_name}</strong>
              {aiSuggestion.reason && (
                <>
                  <span style={{ color: '#555', fontSize: 12 }}>— {aiSuggestion.reason}</span>
                  <button
                    onClick={() => { setDescText(aiSuggestion.reason); setDescSaved(false) }}
                    style={{ marginLeft: 4, padding: '2px 8px', fontSize: 11, background: '#fff', color: '#0055aa', border: '1px solid #b3d4f5', borderRadius: 3, cursor: 'pointer', whiteSpace: 'nowrap' }}
                  >
                    Use as description
                  </button>
                </>
              )}
            </div>
          </div>
        )}
        {aiError && (
          <div style={{ padding: '8px 12px', background: '#fdeaea', border: '1px solid #f5c2c2', borderRadius: 4, marginBottom: 14, fontSize: 12, color: '#c62828' }}>
            AI error: {aiError}
          </div>
        )}

        {/* New category proposal */}
        {newCatProposal && (
          <div style={{ padding: '10px 14px', background: '#f8f3ff', border: '1px solid #c9b3f5', borderLeft: '3px solid #7c4dca', borderRadius: 4, marginBottom: 14, fontSize: 13 }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
              <div style={{ flex: 1 }}>
                <span style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', color: '#7c4dca' }}>New category proposal</span>
                <div style={{ marginTop: 4, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                  <strong style={{ color: '#1a1a1a', fontSize: 14 }}>{newCatProposal.name}</strong>
                  <span style={{ color: '#888', fontSize: 12 }}>under</span>
                  <span style={{ padding: '1px 7px', background: '#ede8ff', border: '1px solid #c9b3f5', borderRadius: 3, fontSize: 11, color: '#5b3fa0' }}>{newCatProposal.parent_name}</span>
                  <span style={{ fontSize: 10, color: '#888' }}>L{newCatProposal.level}</span>
                </div>
                {newCatProposal.reason && (
                  <div style={{ fontSize: 11, color: '#555', marginTop: 4 }}>{newCatProposal.reason}</div>
                )}
              </div>
              <div style={{ display: 'flex', gap: 6, flexShrink: 0, alignItems: 'center' }}>
                <button
                  onClick={handleCreateCategory}
                  disabled={newCatCreating}
                  style={{
                    padding: '5px 12px', fontSize: 12, fontWeight: 600,
                    background: newCatCreating ? colors.surface : '#7c4dca',
                    color: newCatCreating ? colors.muted : '#fff',
                    border: 0, borderRadius: 3,
                    cursor: newCatCreating ? 'not-allowed' : 'pointer',
                  }}
                >
                  {newCatCreating ? 'Creating…' : 'Create & select'}
                </button>
                <button
                  onClick={() => { setNewCatProposal(null); setNewCatError(null) }}
                  style={{ padding: '5px 10px', fontSize: 12, background: 'transparent', color: colors.muted, border: `1px solid ${colors.border}`, borderRadius: 3, cursor: 'pointer' }}
                >
                  Dismiss
                </button>
              </div>
            </div>
            {newCatError && (
              <div style={{ marginTop: 8, fontSize: 11, color: '#c62828' }}>Error: {newCatError}</div>
            )}
          </div>
        )}
        {!newCatProposal && newCatError && (
          <div style={{ padding: '8px 12px', background: '#fdeaea', border: '1px solid #f5c2c2', borderRadius: 4, marginBottom: 14, fontSize: 12, color: '#c62828' }}>
            {newCatError}
          </div>
        )}

        {/* Category picker */}
        <div>
          <label style={{ display: 'block', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.1em', color: colors.textMuted, marginBottom: 6, fontWeight: 600 }}>
            Assign category
          </label>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <input
              ref={categoryInputRef}
              type="text"
              list="queue-cat-options"
              value={selectedCategoryId}
              onChange={e => setSelectedCategoryId(e.target.value)}
              placeholder="Type to search or click in sidebar…"
              autoFocus
              style={{ ...inputStyle, flex: 1, minWidth: 200, padding: '8px 10px', fontSize: 14 }}
            />
            <datalist id="queue-cat-options">
              {categoryPickerOptions.map((c: Category) => (
                <option key={c.id} value={c.id}>{c.name} (L{c.level})</option>
              ))}
            </datalist>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: colors.textMuted, cursor: 'pointer', whiteSpace: 'nowrap' }}>
              <input type="checkbox" checked={markAsPrimary} onChange={e => setMarkAsPrimary(e.target.checked)} />
              Primary
            </label>
            <button
              onClick={handleAiSuggest}
              disabled={aiLoading || newCatLoading}
              style={{
                padding: '8px 14px', fontSize: 13, fontWeight: 500,
                background: aiLoading ? colors.surface : '#f0f7ff',
                color: aiLoading ? colors.muted : '#0055aa',
                border: '1px solid #b3d4f5', borderRadius: 4,
                cursor: (aiLoading || newCatLoading) ? 'not-allowed' : 'pointer',
                whiteSpace: 'nowrap',
              }}
            >
              {aiLoading ? 'Thinking…' : '✦ AI Suggest'}
            </button>
            <button
              onClick={handleSuggestNew}
              disabled={aiLoading || newCatLoading}
              title="Ask Claude to propose a new category not yet in the taxonomy"
              style={{
                padding: '8px 14px', fontSize: 13, fontWeight: 500,
                background: newCatLoading ? colors.surface : '#f5f0ff',
                color: newCatLoading ? colors.muted : '#5b3fa0',
                border: '1px solid #c9b3f5', borderRadius: 4,
                cursor: (aiLoading || newCatLoading) ? 'not-allowed' : 'pointer',
                whiteSpace: 'nowrap',
              }}
            >
              {newCatLoading ? 'Thinking…' : '✦ Suggest new'}
            </button>
            <button
              onClick={() => {
                const value = selectedCategoryId.trim()
                const match = categoryPickerOptions.find((c: Category) =>
                  c.id === value || c.name.toLowerCase() === value.toLowerCase()
                )
                if (match) onAssign(match.id, markAsPrimary)
              }}
              disabled={!selectedCategoryId}
              style={{
                padding: '8px 16px', fontSize: 13, fontWeight: 500,
                background: selectedCategoryId ? colors.accent : colors.surface,
                color: selectedCategoryId ? '#fff' : colors.muted,
                border: 0, borderRadius: 4,
                cursor: selectedCategoryId ? 'pointer' : 'not-allowed',
                whiteSpace: 'nowrap',
              }}
            >
              Assign
            </button>
            <button
              onClick={onSkip}
              style={{ padding: '8px 12px', fontSize: 13, background: colors.bg, color: colors.textMuted, border: `1px solid ${colors.border}`, borderRadius: 4, cursor: 'pointer', whiteSpace: 'nowrap' }}
            >
              Skip (s)
            </button>
          </div>
        </div>

        {/* Description */}
        <div style={{ marginTop: 20, paddingTop: 16, borderTop: `1px solid ${colors.border}` }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
            <label style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.1em', color: colors.textMuted, fontWeight: 600 }}>
              Description
            </label>
            <div style={{ display: 'flex', gap: 6 }}>
              <button
                onClick={handleDescGenerate}
                disabled={descLoading}
                style={{
                  padding: '4px 10px', fontSize: 12, fontWeight: 500,
                  background: descLoading ? colors.surface : '#f0f7ff',
                  color: descLoading ? colors.muted : '#0055aa',
                  border: '1px solid #b3d4f5', borderRadius: 3,
                  cursor: descLoading ? 'not-allowed' : 'pointer',
                }}
              >
                {descLoading ? 'Thinking…' : '✦ Generate'}
              </button>
              {descText && (
                <button
                  onClick={handleDescSave}
                  disabled={descLoading || descSaved}
                  style={{
                    padding: '4px 10px', fontSize: 12, fontWeight: 500,
                    background: descSaved ? '#e8f5e9' : colors.accent,
                    color: descSaved ? colors.success : '#fff',
                    border: 0, borderRadius: 3,
                    cursor: descLoading || descSaved ? 'default' : 'pointer',
                  }}
                >
                  {descSaved ? '✓ Saved' : 'Save'}
                </button>
              )}
            </div>
          </div>
          <textarea
            value={descText}
            onChange={e => { setDescText(e.target.value); setDescSaved(false) }}
            placeholder="Click ✦ Generate or type a description…"
            rows={3}
            style={{ ...inputStyle, width: '100%', padding: '8px 10px', fontSize: 13, resize: 'vertical', lineHeight: 1.6 }}
          />
          {descError && (
            <div style={{ fontSize: 11, color: colors.danger, marginTop: 4 }}>Error: {descError}</div>
          )}
        </div>
      </div>

      {/* Upcoming preview */}
      <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.1em', color: colors.textMuted, marginBottom: 8 }}>
        Up next
      </div>
      <div style={{ border: `1px solid ${colors.border}`, borderRadius: 4, overflow: 'hidden' }}>
        {queue.slice(cursorIndex + 1, cursorIndex + 8).map((e: QueueEntity, i: number) => (
          <div key={e.id} onClick={() => setCursorIndex(cursorIndex + 1 + i)} style={{
            padding: '8px 12px', fontSize: 13, borderBottom: `1px solid ${colors.border}`,
            display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer',
          }}>
            <div>
              <span style={{ color: colors.text }}>{e.name}</span>
              {e.parent_name && <span style={{ color: colors.muted, marginLeft: 8, fontSize: 11 }}>· {e.parent_name}</span>}
            </div>
            <span style={{ fontSize: 10, color: colors.muted, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{e.type}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════════════
// Bulk Mode — multi-select + one-shot category assignment
// ══════════════════════════════════════════════════════════════════════════════

function BulkMode({
  queue, queueTotal, bulkSelectedIds, toggleBulkSelect, toggleBulkSelectAll,
  bulkCategoryId, setBulkCategoryId, bulkPrimary, setBulkPrimary,
  categoryPickerOptions, categoriesById, onApply,
  colors, inputStyle,
}: any) {
  if (!queue.length) {
    return (
      <div style={{ padding: 40, textAlign: 'center', border: `1px solid ${colors.border}`, borderRadius: 4, background: colors.surface }}>
        <div style={{ fontSize: 14, color: colors.text }}>No uncategorized entities match your filter.</div>
      </div>
    )
  }

  const allSelected = queue.length > 0 && queue.every((e: QueueEntity) => bulkSelectedIds.has(e.id))

  return (
    <div>
      <div style={{ fontSize: 12, color: colors.textMuted, marginBottom: 12 }}>
        Showing {queue.length} of {queueTotal} uncategorized
        {bulkSelectedIds.size > 0 && <> · <strong style={{ color: colors.accent }}>{bulkSelectedIds.size} selected</strong></>}
      </div>

      {bulkSelectedIds.size > 0 && (
        <div style={{ padding: 16, background: '#fffbea', border: `1px solid ${colors.warning}`, borderRadius: 4, marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <strong style={{ color: colors.warning }}>{bulkSelectedIds.size} selected:</strong>
            <input
              type="text"
              list="bulk-cat-options"
              value={bulkCategoryId}
              onChange={e => setBulkCategoryId(e.target.value)}
              placeholder="Category id or name…"
              style={{ ...inputStyle, flex: 1, minWidth: 200, padding: '6px 10px', fontSize: 13 }}
            />
            <datalist id="bulk-cat-options">
              {categoryPickerOptions.map((c: Category) => (
                <option key={c.id} value={c.id}>{c.name} (L{c.level})</option>
              ))}
            </datalist>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, cursor: 'pointer' }}>
              <input type="checkbox" checked={bulkPrimary} onChange={e => setBulkPrimary(e.target.checked)} />
              Mark as primary
            </label>
            <button
              onClick={onApply}
              disabled={!bulkCategoryId}
              style={{
                padding: '6px 14px', fontSize: 13, fontWeight: 500,
                background: bulkCategoryId ? colors.accent : colors.surface,
                color: bulkCategoryId ? '#fff' : colors.muted,
                border: 0, borderRadius: 4,
                cursor: bulkCategoryId ? 'pointer' : 'not-allowed',
              }}
            >
              Apply to {bulkSelectedIds.size}
            </button>
          </div>
        </div>
      )}

      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, background: colors.bg, border: `1px solid ${colors.border}`, borderRadius: 4, overflow: 'hidden' }}>
        <thead>
          <tr style={{ background: colors.surface, borderBottom: `1px solid ${colors.border}` }}>
            <th style={{ padding: '10px 12px', textAlign: 'left', width: 36 }}>
              <input type="checkbox" checked={allSelected} onChange={toggleBulkSelectAll} />
            </th>
            <th style={{ padding: '10px 12px', textAlign: 'left', color: colors.textMuted, fontWeight: 600, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Name</th>
            <th style={{ padding: '10px 12px', textAlign: 'left', color: colors.textMuted, fontWeight: 600, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Parent</th>
            <th style={{ padding: '10px 12px', textAlign: 'left', width: 110, color: colors.textMuted, fontWeight: 600, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Type</th>
            <th style={{ padding: '10px 12px', textAlign: 'left', color: colors.textMuted, fontWeight: 600, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Categories</th>
          </tr>
        </thead>
        <tbody>
          {queue.map((e: QueueEntity) => (
            <tr
              key={e.id}
              onClick={() => toggleBulkSelect(e.id)}
              style={{
                borderBottom: `1px solid ${colors.border}`,
                background: bulkSelectedIds.has(e.id) ? colors.selected : 'transparent',
                cursor: 'pointer',
              }}
            >
              <td style={{ padding: '8px 12px' }} onClick={ev => ev.stopPropagation()}>
                <input type="checkbox" checked={bulkSelectedIds.has(e.id)} onChange={() => toggleBulkSelect(e.id)} />
              </td>
              <td style={{ padding: '8px 12px' }}>{e.name}</td>
              <td style={{ padding: '8px 12px', color: colors.textMuted, fontSize: 12 }}>{e.parent_name ?? '—'}</td>
              <td style={{ padding: '8px 12px' }}>
                <span style={{
                  display: 'inline-block', padding: '2px 8px', fontSize: 10, fontWeight: 600,
                  color: e.type === 'brand' ? '#6a3fa0' : e.type === 'conglomerate' ? '#a86b0a' : '#666',
                  background: e.type === 'brand' ? '#f3ebff' : e.type === 'conglomerate' ? '#fff4e0' : '#f0f0f0',
                  borderRadius: 3, textTransform: 'uppercase', letterSpacing: '0.05em',
                }}>{e.type}</span>
              </td>
              <td style={{ padding: '8px 12px', fontSize: 12, color: colors.textMuted }}>
                {e.explicit_categories?.length > 0 ? (
                  // Explicit: show with star for primary, no prefix
                  <span>
                    {e.explicit_categories.map((ec, i) => (
                      <span key={ec.category_id}>
                        {i > 0 && ', '}
                        {ec.is_primary && <span style={{ color: colors.accent }}>★ </span>}
                        {categoriesById.get(ec.category_id)?.name ?? ec.category_id}
                      </span>
                    ))}
                  </span>
                ) : e.inherited_category_ids.length > 0 ? (
                  // Inherited: prefix with "inherits:" for clarity
                  <span style={{ fontStyle: 'italic' }}>
                    inherits: {e.inherited_category_ids.map(cid => categoriesById.get(cid)?.name ?? cid).join(', ')}
                  </span>
                ) : '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
