/**
 * app/api/admin/categorize-suggest/route.ts
 *
 * POST — ask Claude to suggest the best category for a given entity.
 *
 * Request body:
 *   entity_name   string
 *   entity_type   string
 *   parent_name   string | null
 *   categories    { id, name, parent_id, level }[]
 *
 * Response:
 *   { category_id, category_name, reason }
 */

import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD!

function isAuthed(req: NextRequest): boolean {
  const header = req.headers.get('x-admin-password')
  return Boolean(header) && header === ADMIN_PASSWORD
}

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })

function buildCategoryTree(categories: { id: string; name: string; parent_id: string | null; level: number }[]): string {
  const byParent = new Map<string | null, typeof categories>()
  for (const c of categories) {
    const arr = byParent.get(c.parent_id) ?? []
    arr.push(c)
    byParent.set(c.parent_id, arr)
  }

  const lines: string[] = []
  function walk(parentId: string | null, indent: number) {
    const kids = byParent.get(parentId) ?? []
    for (const c of kids) {
      lines.push(`${'  '.repeat(indent)}[${c.id}] ${c.name}`)
      walk(c.id, indent + 1)
    }
  }
  walk(null, 0)
  return lines.join('\n')
}

export async function POST(req: NextRequest) {
  if (!isAuthed(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: any
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const { entity_name, entity_type, parent_name, categories } = body
  if (!entity_name || !categories?.length) {
    return NextResponse.json({ error: 'entity_name and categories are required' }, { status: 400 })
  }

  const tree = buildCategoryTree(categories)

  const prompt = `You are classifying corporate entities for an ownership database.

Entity to classify:
  Name: ${entity_name}
  Type: ${entity_type ?? 'unknown'}${parent_name ? `\n  Parent company: ${parent_name}` : ''}

Available categories (format: [id] Name, indented by level):
${tree}

Pick the single most specific and accurate leaf category for this entity. Prefer deeper (more specific) categories over broad ones. If the entity spans multiple categories pick the most dominant one.

Respond with valid JSON only — no markdown, no explanation outside the JSON:
{"category_id":"<id from the list above>","reason":"<one short sentence>"}`

  try {
    const message = await client.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 256,
      messages: [{ role: 'user', content: prompt }],
    })

    const raw = (message.content[0] as any).text?.trim() ?? ''

    // Strip markdown code fences if Claude wraps the JSON
    const jsonText = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()

    let parsed: { category_id: string; reason: string }
    try {
      parsed = JSON.parse(jsonText)
    } catch {
      return NextResponse.json({ error: 'Claude returned unparseable JSON', raw }, { status: 502 })
    }

    if (!parsed.category_id) {
      return NextResponse.json({ error: 'Claude did not return a category_id', raw }, { status: 502 })
    }

    const cat = categories.find((c: any) => c.id === parsed.category_id)
    if (!cat) {
      return NextResponse.json({ error: `Claude returned unknown category_id: ${parsed.category_id}`, raw }, { status: 502 })
    }

    return NextResponse.json({
      category_id:   parsed.category_id,
      category_name: cat.name,
      reason:        parsed.reason ?? '',
    })
  } catch (err: any) {
    return NextResponse.json({ error: err.message ?? 'Anthropic API error' }, { status: 500 })
  }
}
