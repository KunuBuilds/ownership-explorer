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

// Helper: set intersection. Returns a new set containing only IDs in both inputs.
function intersectSets<T>(a: Set<T>, b: Set<T>): Set<T> {
  const [smaller, larger] = a.size < b.size ? [a, b] : [b, a]
  const out = new Set<T>()
  for (const item of smaller) if (larger.has(item)) out.add(item)
  return out
}

export async function GET(req: NextRequest) {
  if (!isAuthed(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const url = req.nextUrl
  const action = url.searchParams.get('action')

  try {
    if (action === 'queue') {
      const typesParam        = url.searchParams.get('types')
      const search            = url.searchParams.get('search') ?? undefined
      const limit             = Number(url.searchParams.get('limit') ?? 50)
      const offset            = Number(url.searchParams.get('offset') ?? 0)
      const parentIdParam     = url.searchParams.get('parent_id') ?? undefined
      const parentScopeParam  = (url.searchParams.get('parent_scope') ?? 'subtree') as 'direct' | 'subtree'
      const categoryIdParam   = url.searchParams.get('category_id') ?? undefined
      const includeCategorized = url.searchParams.get('include_categorized') === '1'
      const types = typesParam ? typesParam.split(',') : ['brand', 'conglomerate']

      // ── Step A: figure out the entity ID universe based on parent / category filters
      // We collect "allowed IDs" sets from each filter that's active. If two filters
      // are both active we intersect them.
      let allowedIds: Set<string> | null = null  // null means "no filter, allow all"

      // Parent filter
      if (parentIdParam) {
        const parentSet = new Set<string>()
        if (parentScopeParam === 'direct') {
          // Direct children only — one query against ownership
          const { data: kids } = await supabase
            .from('ownership')
            .select('child_id')
            .eq('parent_id', parentIdParam)
            .is('divested_date', null)
          for (const r of kids ?? []) parentSet.add(r.child_id)
        } else {
          // Whole subtree — use the SQL recursive function
          const { data: descs } = await supabase.rpc('entity_descendants', {
            target_entity_id: parentIdParam,
          })
          for (const r of (descs ?? []) as any[]) parentSet.add(r.entity_id)
        }
        allowedIds = parentSet
      }

      // Category filter — entities effectively in this category (explicit or via cascade)
      if (categoryIdParam) {
        const { data: catEntities } = await supabase.rpc('entities_in_category', {
          target_category_id: categoryIdParam,
        })
        const catSet = new Set<string>((catEntities ?? []).map((r: any) => r.entity_id))
        allowedIds = allowedIds === null ? catSet : intersectSets(allowedIds, catSet)
      }

      // ── Step B: figure out which entities have explicit categories (always needed)
      const { data: tagged } = await supabase
        .from('entity_categories')
        .select('entity_id, category_id, is_primary')
      const taggedMap = new Map<string, { category_id: string; is_primary: boolean }[]>()
      for (const r of tagged ?? []) {
        const arr = taggedMap.get(r.entity_id) ?? []
        arr.push({ category_id: r.category_id, is_primary: r.is_primary })
        taggedMap.set(r.entity_id, arr)
      }

      // ── Step C: fetch candidate entities, applying type + search + allowedIds filters
      let query = supabase
        .from('entities')
        .select('id, name, type', { count: 'exact' })
        .in('type', types)
        .order('name')
      if (search) query = query.ilike('name', `%${search}%`)
      if (allowedIds !== null) {
        if (allowedIds.size === 0) {
          // No matches possible — short-circuit
          return NextResponse.json({ rows: [], total: 0 })
        }
        // Postgres IN list: pass the set as an array. There's no hard limit on
        // size but performance degrades past ~10k. For the admin tool it's fine.
        query = query.in('id', [...allowedIds])
      }

      // We over-fetch to give ourselves room to filter out tagged entities client-side
      // when include_categorized = false. With the toggle on, we don't need to over-fetch.
      const fetchSize = includeCategorized ? limit : limit * 2
      const { data: candidates, count } = await query.range(offset, offset + fetchSize)

      const filtered = (candidates ?? [])
        .filter(e => includeCategorized || !taggedMap.has(e.id))
        .slice(0, limit)
      const entityIds = filtered.map(e => e.id)

      // ── Step D: parent context (one parent per entity for display)
      const { data: parentRows } = entityIds.length === 0
        ? { data: [] }
        : await supabase
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

      // ── Step E: inherited categories per entity (for the queue UI hint)
      // Skip the rpc roundtrip for entities that already have explicit assignments —
      // they don't inherit anything (override semantics).
      const needsInheritedLookup = entityIds.filter(id => !taggedMap.has(id))
      const inheritedResults = await Promise.all(
        needsInheritedLookup.map(async id => {
          const { data } = await supabase.rpc('entity_effective_categories', { target_entity_id: id })
          const inherited = ((data ?? []) as any[])
            .filter(c => c.source === 'inherited')
            .map(c => c.category_id)
          return { id, inherited }
        })
      )
      const inheritedMap = new Map(inheritedResults.map(r => [r.id, r.inherited]))

      const rows = filtered.map(e => ({
        id:                       e.id,
        name:                     e.name,
        type:                     e.type,
        parent_id:                parentMap.get(e.id)?.id ?? null,
        parent_name:              parentMap.get(e.id)?.name ?? null,
        inherited_category_ids:   inheritedMap.get(e.id) ?? [],
        explicit_categories:      taggedMap.get(e.id) ?? [],
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
