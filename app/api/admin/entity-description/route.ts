/**
 * app/api/admin/entity-description/route.ts
 *
 * GET  ?action=queue&types=X&limit=N&search=X  — entities without descriptions
 * POST action=generate                          — AI-generate a description (no save)
 * POST action=save                              — write description to entities table
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import Anthropic from '@anthropic-ai/sdk'

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

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })

export async function GET(req: NextRequest) {
  if (!isAuthed(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const supabase = getAdminClient()
  const action   = req.nextUrl.searchParams.get('action')

  if (action === 'queue') {
    const typesParam = req.nextUrl.searchParams.get('types') ?? 'brand,conglomerate'
    const search     = req.nextUrl.searchParams.get('search') ?? ''
    const limit      = Math.min(Number(req.nextUrl.searchParams.get('limit') ?? 100), 200)
    const types      = typesParam.split(',')

    let query = supabase
      .from('entities')
      .select('id, name, type', { count: 'exact' })
      .in('type', types)
      .is('description', null)
      .order('name')
      .limit(limit)

    if (search.trim()) query = query.ilike('name', `%${search.trim()}%`)

    const { data: entities, count, error } = await query
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    const ids = (entities ?? []).map(e => e.id)

    // Parent context
    const { data: parentRows } = ids.length === 0 ? { data: [] } : await supabase
      .from('ownership')
      .select('child_id, parent:entities!ownership_parent_id_fkey(id, name)')
      .in('child_id', ids)
      .is('divested_date', null)

    const parentMap = new Map<string, string>()
    for (const row of (parentRows ?? []) as any[]) {
      if (!parentMap.has(row.child_id) && row.parent) parentMap.set(row.child_id, row.parent.name)
    }

    // Category context
    const { data: catRows } = ids.length === 0 ? { data: [] } : await supabase
      .from('entity_categories')
      .select('entity_id, category:categories!entity_categories_category_id_fkey(name)')
      .in('entity_id', ids)
      .eq('is_primary', true)

    const catMap = new Map<string, string>()
    for (const row of (catRows ?? []) as any[]) {
      if (!catMap.has(row.entity_id) && row.category) catMap.set(row.entity_id, row.category.name)
    }

    const rows = (entities ?? []).map(e => ({
      id:          e.id,
      name:        e.name,
      type:        e.type,
      parent_name: parentMap.get(e.id) ?? null,
      category:    catMap.get(e.id) ?? null,
    }))

    return NextResponse.json({ rows, total: count ?? rows.length })
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
}

export async function POST(req: NextRequest) {
  if (!isAuthed(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: any
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const { action } = body

  if (action === 'generate') {
    const { entity_name, entity_type, parent_name, category } = body
    if (!entity_name) return NextResponse.json({ error: 'entity_name is required' }, { status: 400 })

    const contextParts = [
      `Name: ${entity_name}`,
      `Type: ${entity_type ?? 'unknown'}`,
      parent_name ? `Owner: ${parent_name}` : 'Owner: Independent',
      category ? `Primary category: ${category}` : null,
    ].filter(Boolean).join('\n')

    const prompt = `Write a 2–3 sentence description for this corporate entity, suitable for a business ownership database. Be factual and encyclopedic. Do not use phrases like "is a leading" or marketing superlatives. State what the entity is, what it's known for, and who owns it (if not independent). Respond with only the description text — no preamble, no quotes.

${contextParts}`

    try {
      const message = await anthropic.messages.create({
        model:      'claude-haiku-4-5',
        max_tokens: 300,
        messages:   [{ role: 'user', content: prompt }],
      })
      const description = ((message.content[0] as any).text ?? '').trim()
      return NextResponse.json({ description })
    } catch (err: any) {
      return NextResponse.json({ error: err.message ?? 'Anthropic API error' }, { status: 500 })
    }
  }

  if (action === 'save') {
    const { entity_id, description } = body
    if (!entity_id) return NextResponse.json({ error: 'entity_id is required' }, { status: 400 })

    const supabase = getAdminClient()
    const { error } = await supabase
      .from('entities')
      .update({ description: description || null })
      .eq('id', entity_id)

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ success: true })
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
}
