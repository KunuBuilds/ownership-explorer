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
import { createHash } from 'crypto'

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

function parseJson(raw: string): any {
  const clean = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()
  return JSON.parse(clean)
}

function isValidDateString(s: unknown): s is string {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s))
}

function sourceIdFromUrl(url: string): string {
  return 'src-' + createHash('sha1').update(url.trim().toLowerCase()).digest('hex').slice(0, 12)
}

// Reject URLs that point at a search/index shell rather than a specific document.
// These are a common AI-hallucination tell (e.g. sec.gov/cgi-bin/browse-edgar search forms).
function isAcceptableSourceUrl(raw: string): boolean {
  if (!/^https?:\/\//i.test(raw)) return false
  let url: URL
  try { url = new URL(raw) } catch { return false }
  const path = url.pathname.toLowerCase()
  const search = url.search.toLowerCase()
  if (path.includes('/cgi-bin/browse-edgar')) return false
  if (/(^|\/)(search|results|find)(\/|$)/.test(path)) return false
  if (/[?&](q|query|s|action)=/.test(search)) return false
  return true
}

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

    // Parent context (also captures the live ownership edge id + existing acquired_date)
    const { data: parentRows } = ids.length === 0 ? { data: [] } : await supabase
      .from('ownership')
      .select('id, child_id, acquired_date, parent:entities!ownership_parent_id_fkey(id, name)')
      .in('child_id', ids)
      .is('divested_date', null)

    const parentMap = new Map<string, { ownership_id: number; parent_name: string; acquired_date: string | null }>()
    for (const row of (parentRows ?? []) as any[]) {
      if (!parentMap.has(row.child_id) && row.parent) {
        parentMap.set(row.child_id, {
          ownership_id:  row.id,
          parent_name:   row.parent.name,
          acquired_date: row.acquired_date ?? null,
        })
      }
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

    const rows = (entities ?? []).map(e => {
      const parent = parentMap.get(e.id)
      return {
        id:            e.id,
        name:          e.name,
        type:          e.type,
        parent_name:   parent?.parent_name ?? null,
        ownership_id:  parent?.ownership_id ?? null,
        acquired_date: parent?.acquired_date ?? null,
        category:      catMap.get(e.id) ?? null,
      }
    })

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
    const { entity_name, entity_type, parent_name, category, existing_acquired_date } = body
    if (!entity_name) return NextResponse.json({ error: 'entity_name is required' }, { status: 400 })

    // Only ask Claude for an acquisition date+source if there's a parent and no existing date.
    const wantAcquisition = Boolean(parent_name) && !existing_acquired_date

    const contextParts = [
      `Name: ${entity_name}`,
      `Type: ${entity_type ?? 'unknown'}`,
      parent_name ? `Owner: ${parent_name}` : 'Owner: Independent',
      category ? `Primary category: ${category}` : null,
    ].filter(Boolean).join('\n')

    const acquisitionInstructions = wantAcquisition ? `

Additionally, return the date ${entity_name} was acquired by ${parent_name}, along with a source you can cite. Only include the date and source if you can verify the acquisition from reliable knowledge (press release, SEC filing, mainstream news). If you are not confident the date is correct, return null for both — never guess.

- "acquired_date" must be YYYY-MM-DD. Use the close/completion date of the acquisition, not the announcement date, when both are known.
- "source" must reference a real, verifiable URL on a publisher you can name (e.g. SEC EDGAR, Reuters, the acquirer's investor-relations site, the acquirer's press release archive). Do not invent URLs.
- "source.source_type" must be one of: "primary" (the company itself, e.g. press release), "filing" (regulator filing, e.g. SEC, AMF), or "secondary" (reporting/news).` : ''

    const responseShape = wantAcquisition
      ? `{"description":"<2-3 sentence description>","acquired_date":"<YYYY-MM-DD or null>","source":{"title":"<title>","publisher":"<publisher>","url":"<full https URL>","published_date":"<YYYY-MM-DD or null>","source_type":"primary|filing|secondary"} or null}`
      : `{"description":"<2-3 sentence description>","acquired_date":null,"source":null}`

    const prompt = `Write a 2-3 sentence description for this corporate entity, suitable for a business ownership database. Be factual and encyclopedic. Do not use phrases like "is a leading" or marketing superlatives. State what the entity is, what it's known for, and who owns it (if not independent).${acquisitionInstructions}

${contextParts}

Respond with valid JSON only — no markdown, no preamble:
${responseShape}`

    try {
      const message = await anthropic.messages.create({
        model:      'claude-haiku-4-5',
        max_tokens: 600,
        messages:   [{ role: 'user', content: prompt }],
      })
      const raw = ((message.content[0] as any).text ?? '').trim()
      let parsed: any
      try { parsed = parseJson(raw) } catch {
        return NextResponse.json({ error: 'Claude returned unparseable JSON', raw }, { status: 502 })
      }

      const description = typeof parsed.description === 'string' ? parsed.description.trim() : ''
      if (!description) {
        return NextResponse.json({ error: 'Claude did not return a description', raw }, { status: 502 })
      }

      let acquired_date: string | null = null
      let source: { title: string; publisher: string | null; url: string; published_date: string | null; source_type: 'primary' | 'filing' | 'secondary' } | null = null

      if (wantAcquisition && parsed.acquired_date && parsed.source) {
        if (isValidDateString(parsed.acquired_date)) acquired_date = parsed.acquired_date
        const s = parsed.source
        if (
          s &&
          typeof s.title === 'string' && s.title.trim() &&
          typeof s.url === 'string' && isAcceptableSourceUrl(s.url) &&
          ['primary', 'filing', 'secondary'].includes(s.source_type)
        ) {
          source = {
            title:          s.title.trim(),
            publisher:      typeof s.publisher === 'string' && s.publisher.trim() ? s.publisher.trim() : null,
            url:            s.url.trim(),
            published_date: isValidDateString(s.published_date) ? s.published_date : null,
            source_type:    s.source_type,
          }
        }
        // If either piece is missing, drop both — we don't want an unverified date floating around.
        if (!acquired_date || !source) { acquired_date = null; source = null }
      }

      return NextResponse.json({ description, acquired_date, source })
    } catch (err: any) {
      return NextResponse.json({ error: err.message ?? 'Anthropic API error' }, { status: 500 })
    }
  }

  if (action === 'save') {
    const { entity_id, description, ownership_id, acquired_date, source } = body
    if (!entity_id) return NextResponse.json({ error: 'entity_id is required' }, { status: 400 })

    const supabase = getAdminClient()

    const { error: descErr } = await supabase
      .from('entities')
      .update({ description: description || null })
      .eq('id', entity_id)
    if (descErr) return NextResponse.json({ error: descErr.message }, { status: 500 })

    // Optionally write acquired_date + citation. Only fills in if currently null (server-side guard).
    let wrote_date = false
    let wrote_source = false

    // A date without an acceptable source URL never lands — the citation is the whole point.
    if (ownership_id && isValidDateString(acquired_date) && (!source?.url || !isAcceptableSourceUrl(source.url))) {
      return NextResponse.json({ error: 'acquired_date requires a source with a specific document URL (not a search shell)' }, { status: 400 })
    }

    if (ownership_id && isValidDateString(acquired_date)) {
      const { data: existing, error: readErr } = await supabase
        .from('ownership')
        .select('acquired_date')
        .eq('id', ownership_id)
        .single()
      if (readErr) return NextResponse.json({ error: readErr.message }, { status: 500 })

      if (existing && !existing.acquired_date) {
        const { error: updErr } = await supabase
          .from('ownership')
          .update({ acquired_date })
          .eq('id', ownership_id)
        if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 })
        wrote_date = true
      }

      if (source && typeof source.url === 'string' && isAcceptableSourceUrl(source.url) && source.title) {
        // Dedupe by URL: reuse an existing source row if one already cites this URL.
        const { data: existingSource } = await supabase
          .from('sources')
          .select('id')
          .eq('url', source.url.trim())
          .maybeSingle()

        const source_id = existingSource?.id ?? sourceIdFromUrl(source.url)

        if (!existingSource) {
          const { error: srcErr } = await supabase.from('sources').insert({
            id:             source_id,
            title:          String(source.title).trim().slice(0, 500),
            publisher:      source.publisher ? String(source.publisher).trim().slice(0, 200) : null,
            url:            source.url.trim(),
            published_date: isValidDateString(source.published_date) ? source.published_date : null,
            source_type:    ['primary', 'filing', 'secondary'].includes(source.source_type) ? source.source_type : 'secondary',
          })
          if (srcErr) return NextResponse.json({ error: srcErr.message }, { status: 500 })
        }

        const { error: linkErr } = await supabase
          .from('ownership_sources')
          .upsert({ ownership_id, source_id }, { onConflict: 'ownership_id,source_id' })
        if (linkErr) return NextResponse.json({ error: linkErr.message }, { status: 500 })
        wrote_source = true
      }
    }

    return NextResponse.json({ success: true, wrote_date, wrote_source })
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
}
