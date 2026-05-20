/**
 * app/api/admin/add/route.ts
 *
 * Admin-gated API for creating new entities and ownership edges.
 *
 * POST actions:
 *   create_entity   — insert a new entity row + optional parent edge(s)
 *   link_children   — create ownership edges from existing entities to a parent
 *
 * GET actions:
 *   search          — search entities by name (for autocomplete)
 *   categories      — list all categories (for the category picker)
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { randomUUID } from 'crypto'

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

  const url = req.nextUrl
  const action = url.searchParams.get('action')

  try {
    // ── Entity search (for autocomplete pickers) ─────────────────────────────
    if (action === 'search') {
      const q = url.searchParams.get('q') ?? ''
      const type = url.searchParams.get('type') ?? undefined  // optional type filter
      const limit = Math.min(Number(url.searchParams.get('limit') ?? 20), 50)

      let query = supabase
        .from('entities')
        .select('id, name, type')
        .order('name')
        .limit(limit)

      if (q.trim()) query = query.ilike('name', `%${q.trim()}%`)
      if (type)     query = query.eq('type', type)

      const { data, error } = await query
      if (error) throw error
      return NextResponse.json({ results: data ?? [] })
    }

    // ── Categories list ──────────────────────────────────────────────────────
    if (action === 'categories') {
      const { data, error } = await supabase
        .from('categories')
        .select('id, name, parent_id, level, sort_order')
        .order('sort_order')
      if (error) throw error
      return NextResponse.json({ categories: data ?? [] })
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
  } catch (err: any) {
    return NextResponse.json({ error: err.message ?? 'Server error' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  if (!isAuthed(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: any
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const { action } = body

  try {
    // ── Create a brand-new entity ────────────────────────────────────────────
    if (action === 'create_entity') {
      const {
        name,
        type,
        parent_ids = [],       // [] means root / no parent
        category_ids = [],     // explicit categories to assign immediately
        primary_category_id,   // which of category_ids (if any) is primary
        acquired_date,
        ownership_percentage,
      } = body

      if (!name?.trim()) return NextResponse.json({ error: 'name is required' }, { status: 400 })
      if (!type)         return NextResponse.json({ error: 'type is required' }, { status: 400 })

      const VALID_TYPES = ['conglomerate', 'brand', 'subsidiary', 'legal_entity', 'product']
      if (!VALID_TYPES.includes(type)) {
        return NextResponse.json({ error: `Invalid type "${type}"` }, { status: 400 })
      }

      // Generate a URL-safe slug ID from the name (same convention as scraper).
      // Use the clean slug if available; only append a short suffix on collision.
      const slug = name.trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')

      let id = slug
      const { data: existing } = await supabase
        .from('entities')
        .select('id')
        .eq('id', slug)
        .maybeSingle()
      if (existing) {
        id = `${slug}-${randomUUID().slice(0, 6)}`
      }

      // 1. Insert the entity
      const { error: entityErr } = await supabase
        .from('entities')
        .insert({ id, name: name.trim(), type })
      if (entityErr) throw entityErr

      // 2. Create ownership edges for each parent
      if (parent_ids.length > 0) {
        const edges = parent_ids.map((pid: string) => ({
          parent_id:            pid,
          child_id:             id,
          acquired_date:        acquired_date || null,
          share_pct:     ownership_percentage ? Number(ownership_percentage) : null,
          divested_date:        null,
        }))
        const { error: edgeErr } = await supabase.from('ownership').insert(edges)
        if (edgeErr) throw edgeErr
      }

      // 3. Assign categories
      if (category_ids.length > 0) {
        // If a primary is designated, clear any accidental existing primary first
        // (entity is brand-new so there shouldn't be any, but defensive).
        const rows = category_ids.map((cid: string) => ({
          entity_id:   id,
          category_id: cid,
          is_primary:  cid === primary_category_id,
        }))
        const { error: catErr } = await supabase
          .from('entity_categories')
          .upsert(rows, { onConflict: 'entity_id,category_id' })
        if (catErr) throw catErr
      }

      return NextResponse.json({ success: true, id, name: name.trim(), type })
    }

    // ── Link existing entities as children of a parent ───────────────────────
    if (action === 'link_children') {
      const {
        parent_id,
        child_ids = [],
        acquired_date,
        ownership_percentage,
      } = body

      if (!parent_id)            return NextResponse.json({ error: 'parent_id is required' }, { status: 400 })
      if (child_ids.length === 0) return NextResponse.json({ error: 'child_ids is empty' }, { status: 400 })

      // Verify parent exists
      const { data: parent, error: parentErr } = await supabase
        .from('entities')
        .select('id, name')
        .eq('id', parent_id)
        .single()
      if (parentErr || !parent) return NextResponse.json({ error: 'Parent entity not found' }, { status: 404 })

      // Build edges — skip any pair that already has an active edge
      const { data: existing } = await supabase
        .from('ownership')
        .select('child_id')
        .eq('parent_id', parent_id)
        .in('child_id', child_ids)
        .is('divested_date', null)

      const existingSet = new Set((existing ?? []).map((r: any) => r.child_id))
      const newEdges = child_ids
        .filter((cid: string) => !existingSet.has(cid))
        .map((cid: string) => ({
          parent_id,
          child_id:             cid,
          acquired_date:        acquired_date || null,
          share_pct:     ownership_percentage ? Number(ownership_percentage) : null,
          divested_date:        null,
        }))

      if (newEdges.length === 0) {
        return NextResponse.json({ success: true, linked: 0, skipped: child_ids.length, message: 'All edges already existed' })
      }

      const { error: edgeErr } = await supabase.from('ownership').insert(newEdges)
      if (edgeErr) throw edgeErr

      return NextResponse.json({
        success: true,
        linked:  newEdges.length,
        skipped: existingSet.size,
        parent:  parent.name,
      })
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
  } catch (err: any) {
    return NextResponse.json({ error: err.message ?? 'Server error' }, { status: 500 })
  }
}