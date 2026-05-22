/**
 * app/api/admin/categorize-suggest/route.ts
 *
 * POST action=suggest   — pick the best existing category for an entity
 * POST action=suggest_new — propose a brand-new category that fits the taxonomy
 *
 * Both share: entity_name, entity_type, parent_name, categories[]
 * suggest_new response: { name, parent_id, parent_name, level, reason }
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

function parseJson(raw: string): any {
  const clean = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()
  return JSON.parse(clean)
}

export async function POST(req: NextRequest) {
  if (!isAuthed(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: any
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const { action = 'suggest', entity_name, entity_type, parent_name, categories } = body
  if (!entity_name || !categories?.length) {
    return NextResponse.json({ error: 'entity_name and categories are required' }, { status: 400 })
  }

  const tree = buildCategoryTree(categories)

  // ── Suggest from existing categories ────────────────────────────────────────
  if (action === 'suggest') {
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
        model:     'claude-haiku-4-5',
        max_tokens: 256,
        messages:  [{ role: 'user', content: prompt }],
      })
      const raw = (message.content[0] as any).text?.trim() ?? ''
      let parsed: { category_id: string; reason: string }
      try { parsed = parseJson(raw) } catch {
        return NextResponse.json({ error: 'Claude returned unparseable JSON', raw }, { status: 502 })
      }
      if (!parsed.category_id) {
        return NextResponse.json({ error: 'Claude did not return a category_id', raw }, { status: 502 })
      }
      const cat = categories.find((c: any) => c.id === parsed.category_id)
      if (!cat) {
        return NextResponse.json({ error: `Claude returned unknown category_id: ${parsed.category_id}`, raw }, { status: 502 })
      }
      return NextResponse.json({ category_id: parsed.category_id, category_name: cat.name, reason: parsed.reason ?? '' })
    } catch (err: any) {
      return NextResponse.json({ error: err.message ?? 'Anthropic API error' }, { status: 500 })
    }
  }

  // ── Suggest a brand-new category (or confirm an existing one is sufficient) ──
  if (action === 'suggest_new') {
    const prompt = `You are a taxonomy curator for a corporate ownership database.

Entity to classify:
  Name: ${entity_name}
  Type: ${entity_type ?? 'unknown'}${parent_name ? `\n  Parent company: ${parent_name}` : ''}

Existing taxonomy (format: [id] Name, indented by level):
${tree}

Your task has two steps:

STEP 1 — Evaluate the existing taxonomy honestly. Is there already a category that accurately and specifically classifies this entity? A category is "good enough" if it captures what this entity IS, even if imperfect. Err toward reusing existing categories — only recommend a new one if the existing taxonomy has a genuine gap.

STEP 2 — Based on step 1, respond with exactly one of these two JSON shapes:

If an existing category is good enough:
{"verdict":"existing","category_id":"<exact id from the list>","reason":"<one sentence why this category fits>"}

If no existing category fits well and a new one is genuinely needed:
{"verdict":"new","name":"<new category name, 2-4 words, title-cased>","parent_id":"<exact id of existing parent>","reason":"<one sentence why a new category is needed and why this name fits>"}

Rules for "new":
- Must be genuinely missing, not a near-duplicate of an existing category
- parent_id must be an exact id from the taxonomy above
- Prefer level 3 (deepest) when a suitable level-2 parent exists

Respond with valid JSON only — no markdown, no preamble.`

    try {
      const message = await client.messages.create({
        model:     'claude-haiku-4-5',
        max_tokens: 300,
        messages:  [{ role: 'user', content: prompt }],
      })
      const raw = (message.content[0] as any).text?.trim() ?? ''
      let parsed: any
      try { parsed = parseJson(raw) } catch {
        return NextResponse.json({ error: 'Claude returned unparseable JSON', raw }, { status: 502 })
      }

      if (parsed.verdict === 'existing') {
        if (!parsed.category_id) {
          return NextResponse.json({ error: 'Claude did not return category_id for existing verdict', raw }, { status: 502 })
        }
        const cat = categories.find((c: any) => c.id === parsed.category_id)
        if (!cat) {
          return NextResponse.json({ error: `Claude returned unknown category_id: ${parsed.category_id}`, raw }, { status: 502 })
        }
        return NextResponse.json({
          verdict:       'existing',
          category_id:   parsed.category_id,
          category_name: cat.name,
          reason:        parsed.reason ?? '',
        })
      }

      if (parsed.verdict === 'new') {
        if (!parsed.name || !parsed.parent_id) {
          return NextResponse.json({ error: 'Claude did not return name and parent_id for new verdict', raw }, { status: 502 })
        }
        const parent = categories.find((c: any) => c.id === parsed.parent_id)
        if (!parent) {
          return NextResponse.json({ error: `Claude returned unknown parent_id: ${parsed.parent_id}`, raw }, { status: 502 })
        }
        return NextResponse.json({
          verdict:     'new',
          name:        parsed.name,
          parent_id:   parsed.parent_id,
          parent_name: parent.name,
          level:       (parent.level ?? 1) + 1,
          reason:      parsed.reason ?? '',
        })
      }

      return NextResponse.json({ error: `Claude returned unknown verdict: ${parsed.verdict}`, raw }, { status: 502 })
    } catch (err: any) {
      return NextResponse.json({ error: err.message ?? 'Anthropic API error' }, { status: 500 })
    }
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
}
