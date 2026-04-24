import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'
export const revalidate = 0

function checkAuth(req: NextRequest): boolean {
  const auth = req.headers.get('x-admin-password')
  return auth === process.env.ADMIN_PASSWORD
}

function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SECRET_KEY!,
    { auth: { persistSession: false } }
  )
}

export async function POST(req: NextRequest) {
  if (!checkAuth(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await req.json()
  const { action } = body
  const supabase = getAdminClient()

  // ── Reparent action ────────────────────────────────────────────────────
  if (action === 'reparent') {
    const { entity_ids, old_parent_id, new_parent_id, new_type } = body as {
      entity_ids: string[]
      old_parent_id: string
      new_parent_id: string
      new_type: string
    }

    if (!entity_ids?.length || !old_parent_id || !new_parent_id) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }

    // Safety: don't allow self-reparenting
    if (entity_ids.includes(new_parent_id)) {
      return NextResponse.json({ error: 'Cannot reparent an entity under itself' }, { status: 400 })
    }

    // Verify the new parent exists
    const { data: parentCheck } = await supabase
      .from('entities')
      .select('id')
      .eq('id', new_parent_id)
      .maybeSingle()

    if (!parentCheck) {
      return NextResponse.json({ error: `Target parent "${new_parent_id}" does not exist` }, { status: 400 })
    }

    let updated = 0

    for (const entity_id of entity_ids) {
      // Check if an edge already exists from new_parent_id to this entity
      // If so, just delete the old edge — don't create a duplicate
      const { data: existingNewEdge } = await supabase
        .from('ownership')
        .select('id')
        .eq('parent_id', new_parent_id)
        .eq('child_id', entity_id)
        .maybeSingle()

      if (existingNewEdge) {
        // Already under new parent — just remove the old edge
        await supabase
          .from('ownership')
          .delete()
          .eq('parent_id', old_parent_id)
          .eq('child_id', entity_id)
      } else {
        // Redirect the edge from old parent to new parent
        const { error: updateErr } = await supabase
          .from('ownership')
          .update({ parent_id: new_parent_id })
          .eq('parent_id', old_parent_id)
          .eq('child_id', entity_id)

        if (updateErr) {
          // Non-fatal — continue with others but log
          console.error(`Failed to reparent ${entity_id}:`, updateErr)
          continue
        }
      }

      // Update entity type if requested (and not "keep")
      if (new_type && new_type !== '__keep__') {
        const { error: typeErr } = await supabase
          .from('entities')
          .update({ type: new_type })
          .eq('id', entity_id)

        if (typeErr) console.error(`Failed to update type of ${entity_id}:`, typeErr)
      }

      updated++
    }

    return NextResponse.json({ updated })
  }

  // ── Delete action ──────────────────────────────────────────────────────
  if (action === 'delete') {
    const { entity_ids } = body as { entity_ids: string[] }

    if (!entity_ids?.length) {
      return NextResponse.json({ error: 'Missing entity_ids' }, { status: 400 })
    }

    // Delete all ownership edges referencing these entities (both as parent and child)
    const { error: childEdgeErr } = await supabase
      .from('ownership')
      .delete()
      .in('child_id', entity_ids)
    if (childEdgeErr) return NextResponse.json({ error: 'Failed to delete child edges: ' + childEdgeErr.message }, { status: 500 })

    const { error: parentEdgeErr } = await supabase
      .from('ownership')
      .delete()
      .in('parent_id', entity_ids)
    if (parentEdgeErr) return NextResponse.json({ error: 'Failed to delete parent edges: ' + parentEdgeErr.message }, { status: 500 })

    // Delete the entities themselves
    const { error: entityErr } = await supabase
      .from('entities')
      .delete()
      .in('id', entity_ids)
    if (entityErr) return NextResponse.json({ error: 'Failed to delete entities: ' + entityErr.message }, { status: 500 })

    return NextResponse.json({ deleted: entity_ids.length })
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
}
