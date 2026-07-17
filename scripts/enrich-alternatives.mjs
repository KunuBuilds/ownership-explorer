// scripts/enrich-alternatives.mjs
//
// Sonnet enrichment pass over PENDING alternative candidates. For each pair it
// asks claude-sonnet-4-6 whether ALT is a genuine consumer alternative to BRAND,
// then records the verdict:
//   keep   -> llm_verdict='keep',   llm_reason=<display reason>   (stays pending; humans still approve)
//   reject -> llm_verdict='reject', llm_reason=<rationale>, status='rejected'
//
// Selection is WHERE status='pending' AND llm_verdict IS NULL — approved and
// rejected rows are never read or written. Idempotent: kept rows carry a
// non-null llm_verdict, so a re-run processes 0.
//
// Env (.env.local): SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL), SUPABASE_SECRET_KEY,
// ANTHROPIC_API_KEY. Uses plain fetch — no Anthropic SDK.
//
// Usage:
//   node scripts/enrich-alternatives.mjs --dry-run --limit 20
//   node scripts/enrich-alternatives.mjs --limit 20
//   node scripts/enrich-alternatives.mjs --category food-conf-candy

import { serviceClient, fetchAll, loadEnv } from './_supabase.mjs'

const MODEL = 'claude-sonnet-4-6'
const API_URL = 'https://api.anthropic.com/v1/messages'
const ANTHROPIC_VERSION = '2023-06-01'
const MAX_TOKENS = 2000
const BATCH_SIZE = 20
const INTER_CALL_MS = 500
const MAX_DEPTH = 10

const SYSTEM_PROMPT =
  "You review candidate 'alternative product/brand' pairs for a corporate " +
  'ownership transparency site. For each pair, judge whether ALT is a ' +
  'genuine consumer alternative to BRAND: same product category and use ' +
  'case, currently operating, actually substitutable by a shopper. Reject ' +
  'pairs that are defunct, not consumer-facing, only technically in the ' +
  'same broad category, or not real substitutes. For kept pairs, write a ' +
  'neutral one-line display reason (max 120 chars) that states the ' +
  "ownership contrast, e.g. 'Independent, employee-owned alternative in " +
  "the same snack category.' Respond with ONLY a JSON array, no prose, no " +
  "markdown fences: [{entity_id, alternative_id, verdict: 'keep'|'reject', " +
  'reason, rationale}] — one element per input pair, ids copied exactly.'

const sleep = ms => new Promise(r => setTimeout(r, ms))
const chunk = (a, n) => { const o = []; for (let i = 0; i < a.length; i += n) o.push(a.slice(i, i + n)); return o }

class ApiError extends Error {}

function parseArgs() {
  const a = { limit: 100, category: null, dryRun: false }
  for (let i = 2; i < process.argv.length; i++) {
    const f = process.argv[i]
    if (f === '--limit') a.limit = Number(process.argv[++i])
    else if (f === '--category') a.category = process.argv[++i]
    else if (f === '--dry-run') a.dryRun = true
    else if (f === '--help' || f === '-h') {
      console.log('node scripts/enrich-alternatives.mjs [--limit N] [--category X] [--dry-run]')
      process.exit(0)
    }
  }
  return a
}

// ── Ownership chains (current edges only) ───────────────────────────────────
function buildParentMap(edges) {
  const m = new Map() // child -> [{ parent, share }]
  for (const e of edges) {
    if (e.divested_date != null || e.parent_id === e.child_id) continue
    const arr = m.get(e.child_id) ?? []
    arr.push({ parent: e.parent_id, share: e.share_pct == null ? 100 : e.share_pct })
    m.set(e.child_id, arr)
  }
  return m
}

// Chain of NAMES from the entity up to its ownership root. Deterministic parent
// pick (highest share, then id); depth-capped; self-loop guarded.
function chainToRoot(id, parentMap, nameOf) {
  const path = [id]
  const seen = new Set([id])
  let cur = id
  for (let d = 0; d < MAX_DEPTH; d++) {
    const parents = parentMap.get(cur)
    if (!parents || parents.length === 0) break
    const best = [...parents].sort((a, b) => b.share - a.share || (a.parent < b.parent ? -1 : 1))[0]
    if (seen.has(best.parent)) break
    cur = best.parent
    seen.add(cur)
    path.push(cur)
  }
  return path.map(x => nameOf.get(x) ?? x)
}

// ── Anthropic call (plain fetch, one retry on 429/5xx/network) ──────────────
async function anthropicCall(pairsPayload, apiKey) {
  const body = {
    model: MODEL,
    max_tokens: MAX_TOKENS,
    system: SYSTEM_PROMPT,
    messages: [{
      role: 'user',
      content: 'Judge each of the following candidate alternative pairs. Return one ' +
        'array element per pair, ids copied exactly.\n\nPairs:\n' + JSON.stringify(pairsPayload),
    }],
  }
  for (let attempt = 0; attempt < 2; attempt++) {
    let res
    try {
      res = await fetch(API_URL, {
        method: 'POST',
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': ANTHROPIC_VERSION,
          'content-type': 'application/json',
        },
        body: JSON.stringify(body),
      })
    } catch (netErr) {
      if (attempt === 0) { await sleep(2000); continue }
      throw new ApiError(`network error: ${netErr.message}`)
    }
    if (res.ok) {
      const json = await res.json()
      const text = (json.content ?? []).filter(b => b.type === 'text').map(b => b.text).join('')
      return { text, usage: json.usage ?? {} }
    }
    if (res.status === 429 || res.status >= 500) {
      if (attempt === 0) {
        const ra = Number(res.headers.get('retry-after'))
        await sleep(Number.isFinite(ra) && ra > 0 ? ra * 1000 : 2000)
        continue
      }
      throw new ApiError(`HTTP ${res.status} after retry`)
    }
    // 4xx (non-retryable) — surface the body
    const errBody = await res.text().catch(() => '')
    throw new ApiError(`HTTP ${res.status}: ${errBody.slice(0, 300)}`)
  }
  throw new ApiError('unreachable')
}

// Strip accidental fences, extract the JSON array, validate 1:1 id coverage.
function validate(text, pairs) {
  let t = (text ?? '').trim()
  const start = t.indexOf('[')
  const end = t.lastIndexOf(']')
  if (start === -1 || end === -1 || end < start) return null
  t = t.slice(start, end + 1)
  let arr
  try { arr = JSON.parse(t) } catch { return null }
  if (!Array.isArray(arr) || arr.length !== pairs.length) return null

  const wanted = new Map(pairs.map(p => [`${p.entity_id}|${p.alternative_id}`, p]))
  const seen = new Set()
  const out = []
  for (const el of arr) {
    if (!el || typeof el !== 'object') return null
    const eid = String(el.entity_id ?? '').trim()
    const aid = String(el.alternative_id ?? '').trim()
    const key = `${eid}|${aid}`
    if (!wanted.has(key) || seen.has(key)) return null
    if (el.verdict !== 'keep' && el.verdict !== 'reject') return null
    seen.add(key)
    out.push({ entity_id: eid, alternative_id: aid, verdict: el.verdict,
               reason: el.reason ?? null, rationale: el.rationale ?? null })
  }
  return seen.size === pairs.length ? out : null
}

async function main() {
  const args = parseArgs()
  loadEnv()
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) { console.error('ERROR: ANTHROPIC_API_KEY missing (.env.local).'); process.exit(1) }
  const sb = serviceClient()

  // Category scope (optional): entity_id must be a member of the category.
  let scopeIds = null
  if (args.category) {
    const { data, error } = await sb.rpc('entities_in_category', { target_category_id: args.category })
    if (error) { console.error('entities_in_category error:', error.message); process.exit(1) }
    scopeIds = new Set((data ?? []).map(r => r.entity_id))
  }

  // Pending, un-judged candidates (paginated, deterministic order).
  let rows = await fetchAll(sb, 'alternatives',
    'id, entity_id, alternative_id, score, generated_reason',
    q => q.eq('status', 'pending').is('llm_verdict', null))
  if (scopeIds) rows = rows.filter(r => scopeIds.has(r.entity_id))
  rows = rows.slice(0, args.limit)

  if (rows.length === 0) { console.log('Nothing to enrich (0 pending rows without an llm_verdict).'); return }

  // Context: all current edges + all entity names/types/hq_country, once.
  const edges = await fetchAll(sb, 'ownership', 'parent_id, child_id, share_pct, divested_date')
  const parentMap = buildParentMap(edges)
  const ents = await fetchAll(sb, 'entities', 'id, name, type, hq_country')
  const nameOf = new Map(ents.map(e => [e.id, e.name]))
  const hqOf = new Map(ents.map(e => [e.id, e.hq_country]))

  const effCache = new Map() // brand_id -> primary/effective category id
  async function brandCategory(brandId, genReason) {
    const m = /same category:\s*(.+?)\s*$/.exec(genReason ?? '')
    if (m) return m[1]
    if (effCache.has(brandId)) return effCache.get(brandId)
    const { data } = await sb.rpc('entity_effective_categories', { target_entity_id: brandId })
    const primary = (data ?? []).find(c => c.is_primary) ?? (data ?? [])[0]
    const cat = primary?.category_id ?? null
    effCache.set(brandId, cat)
    return cat
  }

  // Build per-pair payloads.
  const payloads = []
  for (const r of rows) {
    const category = await brandCategory(r.entity_id, r.generated_reason)
    payloads.push({
      row: r,
      category,
      pair: {
        entity_id: r.entity_id,
        alternative_id: r.alternative_id,
        brand: { name: nameOf.get(r.entity_id) ?? r.entity_id, chain: chainToRoot(r.entity_id, parentMap, nameOf), hq_country: hqOf.get(r.entity_id) ?? null },
        alt: { name: nameOf.get(r.alternative_id) ?? r.alternative_id, chain: chainToRoot(r.alternative_id, parentMap, nameOf), hq_country: hqOf.get(r.alternative_id) ?? null },
        category,
        score: r.score,
        generated_reason: r.generated_reason,
      },
    })
  }

  console.log(`${payloads.length} pending pairs to judge in ${Math.ceil(payloads.length / BATCH_SIZE)} batch(es)${args.dryRun ? ' [DRY RUN]' : ''}.\n`)

  const rowByKey = new Map(payloads.map(p => [`${p.pair.entity_id}|${p.pair.alternative_id}`, p]))
  let processed = 0, kept = 0, rejected = 0, skipped = 0
  const usage = { input: 0, output: 0, cacheWrite: 0, cacheRead: 0 }
  const perCat = new Map() // category -> { kept, rejected }
  const bump = (cat, field) => { const c = perCat.get(cat) ?? { kept: 0, rejected: 0 }; c[field]++; perCat.set(cat, c) }

  const batches = chunk(payloads, BATCH_SIZE)
  try {
    for (let bi = 0; bi < batches.length; bi++) {
      const batch = batches[bi]
      const pairs = batch.map(p => p.pair)

      // Up to two attempts to get a VALID response (each attempt is a fresh call;
      // an API/network error inside anthropicCall stops the whole run).
      let results = null
      for (let attempt = 0; attempt < 2 && !results; attempt++) {
        const { text, usage: u } = await anthropicCall(pairs, apiKey)
        usage.input += u.input_tokens ?? 0
        usage.output += u.output_tokens ?? 0
        usage.cacheWrite += u.cache_creation_input_tokens ?? 0
        usage.cacheRead += u.cache_read_input_tokens ?? 0
        results = validate(text, pairs)
        if (!results && attempt === 0) console.warn(`  batch ${bi + 1}: invalid response, retrying once`)
      }

      if (!results) {
        console.warn(`  batch ${bi + 1}: invalid after retry — SKIPPED (${batch.length} rows stay pending)`)
        skipped += batch.length
        if (bi < batches.length - 1) await sleep(INTER_CALL_MS)
        continue
      }

      // Apply verdicts.
      const updates = [] // { row, verdict, patch }
      for (const el of results) {
        const p = rowByKey.get(`${el.entity_id}|${el.alternative_id}`)
        const cat = p.category ?? '(none)'
        if (el.verdict === 'keep') {
          kept++; bump(cat, 'kept')
          updates.push({ id: p.row.id, patch: { llm_verdict: 'keep', llm_reason: el.reason } })
          if (args.dryRun) console.log(`  KEEP   ${el.entity_id} ~ ${el.alternative_id}  "${el.reason ?? ''}"`)
        } else {
          rejected++; bump(cat, 'rejected')
          updates.push({ id: p.row.id, patch: { llm_verdict: 'reject', llm_reason: el.rationale, status: 'rejected' } })
          if (args.dryRun) console.log(`  REJECT ${el.entity_id} ~ ${el.alternative_id}  "${el.rationale ?? ''}"`)
        }
      }
      processed += results.length

      if (!args.dryRun) {
        // Guarded updates: only touch rows still pending & un-judged.
        for (const grp of chunk(updates, 10)) {
          await Promise.all(grp.map(u =>
            sb.from('alternatives').update(u.patch)
              .eq('id', u.id).eq('status', 'pending').is('llm_verdict', null)
              .then(({ error }) => { if (error) console.error(`  update FAIL ${u.id}: ${error.message}`) })
          ))
        }
      }

      if (bi < batches.length - 1) await sleep(INTER_CALL_MS)
    }
  } catch (err) {
    if (err instanceof ApiError) {
      console.error(`\nAnthropic API error — stopping cleanly: ${err.message}`)
      console.error(`Processed ${processed} of ${payloads.length}; ${payloads.length - processed - skipped} remaining still pending.`)
      printSummary()
      process.exit(1)
    }
    throw err
  }

  console.log(args.dryRun ? '\n[dry run] nothing written.' : '\nDone.')
  printSummary()

  function printSummary() {
    console.log(`\nProcessed ${processed}  |  kept ${kept}  |  rejected ${rejected}  |  skipped ${skipped}`)
    if (perCat.size) {
      console.log('\nPer-category:')
      for (const [cat, c] of [...perCat.entries()].sort((a, b) => (b[1].kept + b[1].rejected) - (a[1].kept + a[1].rejected))) {
        console.log(`  ${cat.padEnd(34)} kept ${String(c.kept).padStart(4)}  rejected ${String(c.rejected).padStart(4)}`)
      }
    }
    const total = usage.input + usage.output
    console.log(`\nEstimated tokens: input ${usage.input}, output ${usage.output}, cache_write ${usage.cacheWrite}, cache_read ${usage.cacheRead}  (billed ~${total})`)
  }
}

main().catch(e => { console.error(e); process.exit(1) })
