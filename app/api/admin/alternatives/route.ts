/**
 * app/api/admin/alternatives/route.ts
 *
 * GET  ?action=list&entity_id=X        — list all alternatives for an entity (both directions)
 * GET  ?action=suggestions&entity_id=X — entities in the same category, not yet linked
 * GET  ?action=search&q=X              — entity name autocomplete
 * POST action=add                      — add an alternative relationship
 * POST action=remove                   — remove an alternative relationship by id
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

export async function GET(req: NextRequest) {
  if (!isAuthed(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const action = req.nextUrl.searchParams.get('action')

  if (action === 'list') {
    const entityId = req.nextUrl.searchParams.get('entity_id')
    if (!entityId) return NextResponse.json({ error: 'Missing entity_id' }, { status: 400 })

    // Rows where this entity is the subject
    const { data: forward, error: e1 } = await supabase
      .from('alternatives')
      .select('id, entity_id, alternative_id, reason, directional, alt:entities!alternatives_alternative_id_fkey(id, name, type)')
      .eq('entity_id', entityId)

    if (e1) return NextResponse.json({ error: e1.message }, { status: 500 })

    // Rows where this entity is the alternative (mutual only)
    const { data: reverse, error: e2 } = await supabase
      .from('alternatives')
      .select('id, entity_id, alternative_id, reason, directional, alt:entities!alternatives_entity_id_fkey(id, name, type)')
      .eq('alternative_id', entityId)
      .eq('directional', false)

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

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
}
