/**
 * app/api/admin/categorize/route.ts
 *
 * Admin-gated API route for all category assignment operations.
 * Follows the same auth pattern as your existing /api/admin/actions route
 * (x-admin-password header).
 *
 * Endpoints:
 *   GET  ?action=queue       — list uncategorized entities
 *   GET  ?action=coverage    — category coverage stats
 *   GET  ?action=entity&id=X — explicit + inherited categories for one entity
 *   POST action=assign       — assign one category to one entity
 *   POST action=bulk_assign  — assign one category to many entities
 *   POST action=unassign     — remove an explicit assignment
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

// Server-side client with the secret key (bypasses RLS for admin writes)
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
  if (!isAuthed(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const url = req.nextUrl
  const action = url.searchParams.get('action')

  try {
    if (action === 'queue') {
      const typesParam = url.searchParams.get('types')
      const search     = url.searchParams.get('search') ?? undefined
      const limit      = Number(url.searchParams.get('limit') ?? 50)
      const offset     = Number(url.searchParams.get('offset') ?? 0)
      const types = typesParam ? typesParam.split(',') : ['brand', 'conglomerate']

      // Inline version of getUncategorizedEntities — the admin route can
      // access it via the shared lib if you prefer, but duplicating keeps
      // the auth boundary tight.
      const { data: tagged } = await supabase
        .from('entity_categories')
        .select('entity_id')
      const taggedIds = new Set((tagged ?? []).map(r => r.entity_id))

      let query = supabase
        .from('entities')
        .select('id, name, type', { count: 'exact' })
        .in('type', types)
        .order('name')
      if (search) query = query.ilike('name', `%${search}%`)

      const { data: candidates, count } = await query
        .range(offset, offset + limit * 2)

      const filtered = (candidates ?? [])
        .filter(e => !taggedIds.has(e.id))
        .slice(0, limit)
      const entityIds = filtered.map(e => e.id)

      // Parent context
      const { data: parentRows } = await supabase
        .from('ownership')
        .select('child_id, parent:entities!ownership_parent_id_fkey (id, name)')
        .in('child_id', entityIds)
        .is('divested_date', null)
      const parentMap = new Map<string, { id: string; name: string }>()
      for (const row of (parentRows ?? []) as any[]) {
        if (!parentMap.has(row.child_id) && row.parent) {
          parentMap.set(row.child_id, { id: row.parent.id, name: row.parent.name })
        }
      }

      // Inherited categories — batched rpc calls
      const inheritedResults = await Promise.all(
        entityIds.map(async id => {
          const { data } = await supabase.rpc('entity_effective_categories', { target_entity_id: id })
          const inherited = ((data ?? []) as any[])
            .filter(c => c.source === 'inherited')
            .map(c => c.category_id)
          return { id, inherited }
        })
      )
      const inheritedMap = new Map(inheritedResults.map(r => [r.id, r.inherited]))

      const rows = filtered.map(e => ({
        id:        e.id,
        name:      e.name,
        type:      e.type,
        parent_id: parentMap.get(e.id)?.id ?? null,
        parent_name: parentMap.get(e.id)?.name ?? null,
        inherited_category_ids: inheritedMap.get(e.id) ?? [],
      }))

      return NextResponse.json({ rows, total: count ?? rows.length })
    }

    if (action === 'coverage') {
      const [{ data: cats }, { data: assignments }, { data: effectiveCounts }] = await Promise.all([
        supabase.from('categories').select('id, name, parent_id, level, sort_order'),
        supabase.from('entity_categories').select('category_id, is_primary'),
        supabase.rpc('category_effective_counts'),
      ])

      const counts = new Map<string, { explicit: number; primary: number }>()
      for (const row of assignments ?? []) {
        const c = counts.get(row.category_id) ?? { explicit: 0, primary: 0 }
        c.explicit += 1
        if (row.is_primary) c.primary += 1
        counts.set(row.category_id, c)
      }

      // effectiveCounts comes back as [{ category_id, effective_count }] — index it for lookup
      const effectiveByCategory = new Map<string, number>()
      for (const row of (effectiveCounts ?? []) as any[]) {
        effectiveByCategory.set(row.category_id, Number(row.effective_count) || 0)
      }

      const coverage = (cats ?? []).map(c => {
        const { explicit = 0, primary = 0 } = counts.get(c.id) ?? {}
        return {
          category_id:    c.id,
          category_name:  c.name,
          id:             c.id,
          name:           c.name,
          parent_id:      c.parent_id,
          level:          c.level,
          sort_order:     c.sort_order,
          explicit_count:  explicit,
          primary_count:   primary,
          effective_count: effectiveByCategory.get(c.id) ?? 0,
        }
      })

      return NextResponse.json({ coverage })
    }

    if (action === 'entity') {
      const id = url.searchParams.get('id')
      if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })

      const [{ data: explicit }, { data: effective }, { data: entity }] = await Promise.all([
        supabase.from('entity_categories')
          .select('category_id, is_primary')
          .eq('entity_id', id),
        supabase.rpc('entity_effective_categories', { target_entity_id: id }),
        supabase.from('entities').select('id, name, type').eq('id', id).single(),
      ])

      return NextResponse.json({
        entity,
        explicit: explicit ?? [],
        effective: effective ?? [],
      })
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
  } catch (err: any) {
    return NextResponse.json({ error: err.message ?? 'Server error' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  if (!isAuthed(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: any
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }
  const { action } = body

  try {
    if (action === 'assign') {
      const { entity_id, category_id, is_primary } = body
      if (!entity_id || !category_id) {
        return NextResponse.json({ error: 'Missing entity_id or category_id' }, { status: 400 })
      }

      if (is_primary) {
        await supabase
          .from('entity_categories')
          .update({ is_primary: false })
          .eq('entity_id', entity_id)
          .eq('is_primary', true)
      }

      const { error } = await supabase
        .from('entity_categories')
        .upsert(
          { entity_id, category_id, is_primary: !!is_primary },
          { onConflict: 'entity_id,category_id' }
        )
      if (error) throw error
      return NextResponse.json({ success: true })
    }

    if (action === 'bulk_assign') {
      const { entity_ids, category_id, is_primary } = body
      if (!Array.isArray(entity_ids) || !category_id) {
        return NextResponse.json({ error: 'Missing entity_ids or category_id' }, { status: 400 })
      }
      if (entity_ids.length === 0) {
        return NextResponse.json({ success: true, inserted: 0 })
      }

      if (is_primary) {
        await supabase
          .from('entity_categories')
          .update({ is_primary: false })
          .in('entity_id', entity_ids)
          .eq('is_primary', true)
      }

      const rows = entity_ids.map((entity_id: string) => ({
        entity_id,
        category_id,
        is_primary: !!is_primary,
      }))

      const { error, count } = await supabase
        .from('entity_categories')
        .upsert(rows, { onConflict: 'entity_id,category_id', count: 'exact' })

      if (error) throw error
      return NextResponse.json({ success: true, inserted: count ?? rows.length })
    }

    if (action === 'unassign') {
      const { entity_id, category_id } = body
      if (!entity_id || !category_id) {
        return NextResponse.json({ error: 'Missing entity_id or category_id' }, { status: 400 })
      }
      const { error } = await supabase
        .from('entity_categories')
        .delete()
        .eq('entity_id', entity_id)
        .eq('category_id', category_id)
      if (error) throw error
      return NextResponse.json({ success: true })
    }

    if (action === 'set_primary') {
      const { entity_id, category_id } = body
      if (!entity_id || !category_id) {
        return NextResponse.json({ error: 'Missing entity_id or category_id' }, { status: 400 })
      }
      // Clear existing primary, then mark the target as primary
      await supabase
        .from('entity_categories')
        .update({ is_primary: false })
        .eq('entity_id', entity_id)
        .eq('is_primary', true)
      const { error } = await supabase
        .from('entity_categories')
        .update({ is_primary: true })
        .eq('entity_id', entity_id)
        .eq('category_id', category_id)
      if (error) throw error
      return NextResponse.json({ success: true })
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
  } catch (err: any) {
    return NextResponse.json({ error: err.message ?? 'Server error' }, { status: 500 })
  }
}