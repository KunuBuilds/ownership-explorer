/**
 * app/api/admin/alternatives/route.ts
 *
 * GET  ?action=list&entity_id=X        — list all alternatives for an entity (both directions)
 * GET  ?action=suggestions&entity_id=X — entities in the same category, not yet linked
 * GET  ?action=search&q=X              — entity name autocomplete
 * GET  ?action=queue&category&verdict&page — staged pending candidates (100/page), joined to
 *                                        both entities, filterable by the brand's effective
 *                                        category and by llm_verdict ('keep' | 'null' | 'all')
 * GET  ?action=stats                   — counts by status + pending broken down by llm_verdict
 * POST action=add                      — add an alternative relationship
 * POST action=remove                   — remove an alternative relationship by id
 * POST action=approve  { pairs }       — pending → approved, reason = COALESCE(llm_reason, generated_reason)
 * POST action=reject   { pairs }       — pending → rejected
 * POST action=edit_reason { entity_id, alternative_id, reason } — set reason + llm_reason (pending/approved)
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SECRET_KEY!
)

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD!

function isAuthed(req: NextRequest): boolean {
  const header = req.headers.get('x-admin-password')
  return Boolean(header) && header === ADMIN_PASSWORD
}

function chunk<T>(arr: T[], n: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n))
  return out
}

const QUEUE_PAGE_SIZE = 100

export async function GET(req: NextRequest) {
  if (!isAuthed(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const action = req.nextUrl.searchParams.get('action')

  // ── Staged review queue: pending candidates, paginated 100/page ──────────
  if (action === 'queue') {
    const category = req.nextUrl.searchParams.get('category') || null
    const verdict  = req.nextUrl.searchParams.get('verdict') || 'all' // 'keep' | 'null' | 'all'
    const page     = Math.max(1, Number(req.nextUrl.searchParams.get('page') ?? 1))
    const from     = (page - 1) * QUEUE_PAGE_SIZE

    // Category filter is on the BRAND (entity_id) via its effective categories.
    let memberIds: string[] | null = null
    if (category) {
      const { data, error } = await supabase.rpc('entities_in_category', { target_category_id: category })
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
      memberIds = [...new Set(((data ?? []) as any[]).map(r => String(r.entity_id)))]
      if (memberIds.length === 0) {
        return NextResponse.json({ rows: [], page, page_size: QUEUE_PAGE_SIZE, total: 0 })
      }
    }

    let q = supabase
      .from('alternatives')
      .select(
        'id, entity_id, alternative_id, score, generated_reason, llm_reason, llm_verdict, status, ' +
        'brand:entities!alternatives_entity_id_fkey(id, name, type), ' +
        'alt:entities!alternatives_alternative_id_fkey(id, name, type)',
        { count: 'exact' }
      )
      .eq('status', 'pending')
    if (verdict === 'keep') q = q.eq('llm_verdict', 'keep')
    else if (verdict === 'null') q = q.is('llm_verdict', null)
    if (memberIds) q = q.in('entity_id', memberIds)

    const { data, count, error } = await q
      .order('score', { ascending: false, nullsFirst: false })
      .order('entity_id', { ascending: true })
      .order('id', { ascending: true })   // unique tiebreak — keeps pages disjoint
      .range(from, from + QUEUE_PAGE_SIZE - 1)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    return NextResponse.json({ rows: data ?? [], page, page_size: QUEUE_PAGE_SIZE, total: count ?? 0 })
  }

  // ── Queue stats: status totals + pending broken down by llm_verdict ──────
  if (action === 'stats') {
    const countOf = async (build: (q: any) => any): Promise<number> => {
      const { count, error } = await build(
        supabase.from('alternatives').select('id', { count: 'exact', head: true })
      )
      if (error) throw error
      return count ?? 0
    }
    try {
      const [approved, pending, rejected, pendingKeep, pendingNull] = await Promise.all([
        countOf(q => q.eq('status', 'approved')),
        countOf(q => q.eq('status', 'pending')),
        countOf(q => q.eq('status', 'rejected')),
        countOf(q => q.eq('status', 'pending').eq('llm_verdict', 'keep')),
        countOf(q => q.eq('status', 'pending').is('llm_verdict', null)),
      ])
      return NextResponse.json({
        by_status: { approved, pending, rejected },
        pending_by_verdict: { keep: pendingKeep, not_enriched: pendingNull },
      })
    } catch (err: any) {
      return NextResponse.json({ error: err.message ?? 'Server error' }, { status: 500 })
    }
  }

  if (action === 'list') {
    const entityId = req.nextUrl.searchParams.get('entity_id')
    if (!entityId) return NextResponse.json({ error: 'Missing entity_id' }, { status: 400 })

    // Rows where this entity is the subject
    const { data: forward, error: e1 } = await supabase
      .from('alternatives')
      .select('id, entity_id, alternative_id, reason, directional, alt:entities!alternatives_alternative_id_fkey(id, name, type)')
      .eq('entity_id', entityId)
      .eq('status', 'approved')

    if (e1) return NextResponse.json({ error: e1.message }, { status: 500 })

    // Rows where this entity is the alternative (mutual only)
    const { data: reverse, error: e2 } = await supabase
      .from('alternatives')
      .select('id, entity_id, alternative_id, reason, directional, alt:entities!alternatives_entity_id_fkey(id, name, type)')
      .eq('alternative_id', entityId)
      .eq('directional', false)
      .eq('status', 'approved')

    if (e2) return NextResponse.json({ error: e2.message }, { status: 500 })

    const rows = [
      ...(forward ?? []).map((r: any) => ({
        id:          r.id,
        direction:   'forward' as const,
        other:       r.alt,
        reason:      r.reason,
        directional: r.directional,
      })),
      ...(reverse ?? []).map((r: any) => ({
        id:          r.id,
        direction:   'reverse' as const,
        other:       r.alt,
        reason:      r.reason,
        directional: r.directional,
      })),
    ]

    return NextResponse.json({ rows })
  }

  if (action === 'chain') {
    const entityId = req.nextUrl.searchParams.get('entity_id')
    if (!entityId) return NextResponse.json({ error: 'Missing entity_id' }, { status: 400 })

    // Walk up the ownership graph iteratively until we reach a root
    const chain: { id: string; name: string; type: string }[] = []
    let currentId = entityId
    const visited = new Set<string>()

    while (currentId && !visited.has(currentId)) {
      visited.add(currentId)
      const { data: entity } = await supabase
        .from('entities')
        .select('id, name, type')
        .eq('id', currentId)
        .single()
      if (!entity) break
      chain.unshift(entity)

      const { data: edge } = await supabase
        .from('ownership')
        .select('parent_id')
        .eq('child_id', currentId)
        .is('divested_date', null)
        .limit(1)
        .single()
      if (!edge) break
      currentId = edge.parent_id
    }

    return NextResponse.json({ chain })
  }

  if (action === 'suggestions') {
    const entityId = req.nextUrl.searchParams.get('entity_id')
    if (!entityId) return NextResponse.json({ error: 'Missing entity_id' }, { status: 400 })

    // Already-linked alternative IDs to exclude from suggestions
    const excludeParam = req.nextUrl.searchParams.get('exclude') ?? ''
    const excludeIds = new Set([entityId, ...excludeParam.split(',').filter(Boolean)])

    // Only suggest entities of the SAME type as the subject — a brand's alternative
    // is another brand, a product's is another product; never a parent conglomerate.
    const { data: subject } = await supabase
      .from('entities').select('type').eq('id', entityId).single()
    const subjectType = subject?.type ?? null

    // Get this entity's effective categories
    const { data: catRows, error: catErr } = await supabase.rpc('entity_effective_categories', {
      target_entity_id: entityId,
    })
    if (catErr) return NextResponse.json({ error: catErr.message }, { status: 500 })
    if (!catRows || catRows.length === 0) return NextResponse.json({ suggestions: [] })

    // Fetch entities in each category, union them
    const categoryIds: string[] = (catRows as any[]).map(r => r.category_id)
    const { data: catEntityRows, error: ceErr } = await supabase
      .from('entity_categories')
      .select('entity_id, entity:entities!entity_categories_entity_id_fkey(id, name, type)')
      .in('category_id', categoryIds)

    if (ceErr) return NextResponse.json({ error: ceErr.message }, { status: 500 })

    // Deduplicate and filter
    const seen = new Set<string>()
    const suggestions: { id: string; name: string; type: string }[] = []
    for (const row of (catEntityRows ?? []) as any[]) {
      const e = row.entity
      if (!e || excludeIds.has(e.id) || seen.has(e.id)) continue
      if (subjectType && e.type !== subjectType) continue   // same level only
      seen.add(e.id)
      suggestions.push({ id: e.id, name: e.name, type: e.type })
    }
    suggestions.sort((a, b) => a.name.localeCompare(b.name))

    return NextResponse.json({ suggestions, categoryIds })
  }

  if (action === 'search') {
    const q = req.nextUrl.searchParams.get('q') ?? ''
    const limit = Math.min(Number(req.nextUrl.searchParams.get('limit') ?? 10), 50)
    let query = supabase.from('entities').select('id, name, type').order('name').limit(limit)
    if (q.trim()) query = query.ilike('name', `%${q.trim()}%`)
    const { data, error } = await query
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ results: data ?? [] })
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
}

export async function POST(req: NextRequest) {
  if (!isAuthed(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: any
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const { action } = body

  if (action === 'add') {
    const { entity_id, alternative_id, reason, directional } = body
    if (!entity_id || !alternative_id) {
      return NextResponse.json({ error: 'entity_id and alternative_id are required' }, { status: 400 })
    }
    if (entity_id === alternative_id) {
      return NextResponse.json({ error: 'An entity cannot be its own alternative' }, { status: 400 })
    }

    const { data, error } = await supabase
      .from('alternatives')
      .insert({ entity_id, alternative_id, reason: reason || null, directional: !!directional })
      .select('id')
      .single()

    if (error) {
      if (error.code === '23505') {
        return NextResponse.json({ error: 'This alternative already exists' }, { status: 409 })
      }
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ success: true, id: data.id })
  }

  if (action === 'remove') {
    const { id } = body
    if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 })

    const { error } = await supabase.from('alternatives').delete().eq('id', id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ success: true })
  }

  // ── Approve staged candidates: pending → approved, reason from COALESCE ───
  if (action === 'approve') {
    const pairs: { entity_id: string; alternative_id: string }[] = Array.isArray(body.pairs) ? body.pairs : []
    if (pairs.length === 0) return NextResponse.json({ changed: 0, requested: 0 })

    // Read the current pending rows so reason can fall back generated_reason.
    const eids = [...new Set(pairs.map(p => p.entity_id))]
    const aids = [...new Set(pairs.map(p => p.alternative_id))]
    const wanted = new Set(pairs.map(p => `${p.entity_id}|${p.alternative_id}`))
    const { data: rows, error } = await supabase
      .from('alternatives')
      .select('id, entity_id, alternative_id, llm_reason, generated_reason')
      .eq('status', 'pending')
      .in('entity_id', eids)
      .in('alternative_id', aids)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    const targets = (rows ?? []).filter(r => wanted.has(`${r.entity_id}|${r.alternative_id}`))
    let changed = 0
    for (const grp of chunk(targets, 20)) {
      const results = await Promise.all(grp.map(r =>
        supabase.from('alternatives')
          .update({ status: 'approved', reason: r.llm_reason ?? r.generated_reason })
          .eq('id', r.id).eq('status', 'pending')   // guard: only ever transition FROM pending
          .select('id')
          .then(({ data }) => (data && data.length ? 1 : 0))
      ))
      changed += results.reduce<number>((a, b) => a + b, 0)
    }
    return NextResponse.json({ changed, requested: pairs.length })
  }

  // ── Reject staged candidates: pending → rejected ─────────────────────────
  if (action === 'reject') {
    const pairs: { entity_id: string; alternative_id: string }[] = Array.isArray(body.pairs) ? body.pairs : []
    if (pairs.length === 0) return NextResponse.json({ changed: 0, requested: 0 })

    let changed = 0
    for (const grp of chunk(pairs, 20)) {
      const results = await Promise.all(grp.map(p =>
        supabase.from('alternatives')
          .update({ status: 'rejected' })
          .eq('entity_id', p.entity_id).eq('alternative_id', p.alternative_id).eq('status', 'pending')
          .select('id')
          .then(({ data }) => (data && data.length ? 1 : 0))
      ))
      changed += results.reduce<number>((a, b) => a + b, 0)
    }
    return NextResponse.json({ changed, requested: pairs.length })
  }

  // ── Edit the display reason for one pair (pending or approved rows) ───────
  if (action === 'edit_reason') {
    const { entity_id, alternative_id, reason } = body
    if (!entity_id || !alternative_id) {
      return NextResponse.json({ error: 'entity_id and alternative_id are required' }, { status: 400 })
    }
    const { data, error } = await supabase
      .from('alternatives')
      .update({ reason: reason ?? null, llm_reason: reason ?? null })
      .eq('entity_id', entity_id).eq('alternative_id', alternative_id)
      .in('status', ['pending', 'approved'])
      .select('id')
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ changed: data?.length ?? 0 })
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
}
