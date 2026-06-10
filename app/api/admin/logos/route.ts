/**
 * app/api/admin/logos/route.ts
 *
 * Review queue for uncertain Wikidata logo matches (populated by
 * enrich-wikidata.mjs into the logo_candidates table).
 *
 * GET  ?action=queue&limit=N   — entities with pending candidates + their options
 * POST action=approve          — apply one candidate (writes entity qid + logo_url)
 * POST action=reject           — dismiss all of an entity's pending candidates
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD!

function isAuthed(req: NextRequest): boolean {
  const header = req.headers.get('x-admin-password')
  return Boolean(header) && header === ADMIN_PASSWORD
}

function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SECRET_KEY!,
    { auth: { persistSession: false } }
  )
}

export async function GET(req: NextRequest) {
  if (!isAuthed(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const supabase = getAdminClient()
  const action = req.nextUrl.searchParams.get('action')

  if (action === 'queue') {
    const limit = Math.min(Number(req.nextUrl.searchParams.get('limit') ?? 200), 500)

    const { data: cands, error } = await supabase
      .from('logo_candidates')
      .select('id, entity_id, wikidata_qid, label, description, instance_of, logo_url, score, is_suggested')
      .eq('status', 'pending')
      .order('entity_id')
      .order('score', { ascending: false })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    const rows = cands ?? []
    const entityIds = [...new Set(rows.map(r => r.entity_id))]

    // Entity names/types for display.
    const { data: ents } = entityIds.length === 0 ? { data: [] } : await supabase
      .from('entities')
      .select('id, name, type')
      .in('id', entityIds)
    const meta = new Map((ents ?? []).map(e => [e.id, e]))

    // Walk the ownership tree upward so each entity shows its full chain to the
    // root — the context that makes a brand identifiable. Level-by-level keeps
    // this to a few small queries (chains are only a handful deep).
    const parentOf = new Map<string, { id: string; name: string }>()  // child_id -> first live parent
    {
      let frontier = entityIds
      const seen = new Set<string>(entityIds)
      let depth = 0
      while (frontier.length > 0 && depth < 25) {
        const { data: edges } = await supabase
          .from('ownership')
          .select('child_id, parent:entities!ownership_parent_id_fkey(id, name)')
          .in('child_id', frontier)
          .is('divested_date', null)
        const next: string[] = []
        for (const row of (edges ?? []) as any[]) {
          if (!row.parent) continue
          if (!parentOf.has(row.child_id)) parentOf.set(row.child_id, { id: row.parent.id, name: row.parent.name })
          if (!seen.has(row.parent.id)) { seen.add(row.parent.id); next.push(row.parent.id) }
        }
        frontier = next
        depth++
      }
    }

    // Ancestors ordered root → immediate parent (cycle-guarded).
    const chainFor = (id: string): { id: string; name: string }[] => {
      const chain: { id: string; name: string }[] = []
      const guard = new Set<string>([id])
      let cur = id
      while (parentOf.has(cur)) {
        const p = parentOf.get(cur)!
        if (guard.has(p.id)) break
        chain.unshift(p)
        guard.add(p.id)
        cur = p.id
      }
      return chain
    }

    // Group by entity, preserving the most-pending entities first.
    const grouped: any[] = []
    const indexByEntity = new Map<string, number>()
    for (const c of rows) {
      let idx = indexByEntity.get(c.entity_id)
      if (idx === undefined) {
        idx = grouped.length
        indexByEntity.set(c.entity_id, idx)
        const m = meta.get(c.entity_id)
        grouped.push({
          entity_id: c.entity_id,
          entity_name: m?.name ?? c.entity_id,
          entity_type: m?.type ?? null,
          chain: chainFor(c.entity_id),
          candidates: [],
        })
      }
      grouped[idx].candidates.push({
        id: c.id, wikidata_qid: c.wikidata_qid, label: c.label, description: c.description,
        instance_of: c.instance_of, logo_url: c.logo_url, score: c.score, is_suggested: c.is_suggested,
      })
    }

    return NextResponse.json({ rows: grouped.slice(0, limit), total: grouped.length })
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
}

export async function POST(req: NextRequest) {
  if (!isAuthed(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: any
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const supabase = getAdminClient()
  const { action } = body

  if (action === 'approve') {
    const { candidate_id } = body
    if (!candidate_id) return NextResponse.json({ error: 'candidate_id is required' }, { status: 400 })

    const { data: cand, error: readErr } = await supabase
      .from('logo_candidates')
      .select('id, entity_id, wikidata_qid, logo_url')
      .eq('id', candidate_id)
      .single()
    if (readErr || !cand) return NextResponse.json({ error: readErr?.message ?? 'Candidate not found' }, { status: 404 })

    // Write the chosen logo + qid onto the entity.
    const { error: updErr } = await supabase
      .from('entities')
      .update({ wikidata_qid: cand.wikidata_qid, logo_url: cand.logo_url })
      .eq('id', cand.entity_id)
    if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 })

    // Mark the picked candidate approved and retire the entity's other candidates.
    await supabase.from('logo_candidates').update({ status: 'rejected' })
      .eq('entity_id', cand.entity_id).eq('status', 'pending')
    const { error: apprErr } = await supabase.from('logo_candidates').update({ status: 'approved' }).eq('id', cand.id)
    if (apprErr) return NextResponse.json({ error: apprErr.message }, { status: 500 })

    return NextResponse.json({ success: true, entity_id: cand.entity_id, logo_url: cand.logo_url })
  }

  if (action === 'reject') {
    const { entity_id } = body
    if (!entity_id) return NextResponse.json({ error: 'entity_id is required' }, { status: 400 })
    const { error } = await supabase.from('logo_candidates').update({ status: 'rejected' })
      .eq('entity_id', entity_id).eq('status', 'pending')
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ success: true, entity_id })
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
}
