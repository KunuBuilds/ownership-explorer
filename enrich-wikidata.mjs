/**
 * enrich-wikidata.mjs
 *
 * Resolves entities to their Wikidata item by name and backfills logos:
 *   - HIGH-confidence matches are applied automatically
 *     (writes entities.wikidata_qid + entities.logo_url).
 *   - Everything uncertain is queued in logo_candidates for human review
 *     at /admin/logos.
 *
 * A match is auto-applied only when exactly ONE candidate is, simultaneously,
 * an exact name match AND an instance-of company/brand/business AND has a logo
 * (Wikidata P154). Anything ambiguous or weaker becomes a review candidate.
 *
 * Prerequisites:
 *   - entities.logo_url + entities.wikidata_qid columns exist
 *   - logo_candidates table exists (see supabase/schema.sql)
 *   - env: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SECRET_KEY
 *     (auto-loaded from .env.local if the `dotenv` package is installed; else
 *      export them in your shell before running)
 *   - Node 18+ (global fetch)
 *
 * Usage:
 *   node enrich-wikidata.mjs --dry-run --limit 50 --verbose   # inspect, write nothing
 *   node enrich-wikidata.mjs                                  # apply + queue
 *   node enrich-wikidata.mjs --width 256                      # logo thumbnail width (default 128)
 */

import { argv, exit, env } from 'node:process'
import { createClient } from '@supabase/supabase-js'

try { const d = await import('dotenv'); d.config({ path: '.env.local' }) } catch { /* dotenv optional */ }

const UA = 'WhoOwnsThis/1.0 (https://github.com/KunuBuilds/ownership-explorer; logo enrichment)'
const API = 'https://www.wikidata.org/w/api.php'
const PAGE_SIZE = 1000

// Wikidata items that mark a search hit as a company / brand / business.
// Combined with a label-substring fallback (see isCompanyType) so the list
// doesn't need to be exhaustive.
const COMPANY_TYPE_QIDS = new Set([
  'Q4830453',   // business
  'Q6881511',   // enterprise
  'Q783794',    // company
  'Q891723',    // public company
  'Q1589009',   // privately held company
  'Q167037',    // corporation
  'Q161726',    // multinational corporation
  'Q43229',     // organization
  'Q431289',    // brand
  'Q207320',    // conglomerate (company type)
  'Q18388277',  // technology company
  'Q4830453',   // business (dup ok in a Set)
])
const COMPANY_LABEL_RE = /\b(company|business|enterprise|brand|corporation|manufacturer|retailer|conglomerate|bank|airline|automaker|automobile|winery|brewery|distillery|cosmetics|subsidiary|holding)\b/i

// ─── CLI ──────────────────────────────────────────────────────────────────
function parseArgs() {
  // Default excludes legal-entity: SEC Exhibit 21 filers are ~72% of the table,
  // almost never on Wikidata, and their generic names are the most likely to
  // mis-match. Pass --type to override (e.g. --type legal-entity, or --type all).
  const a = { dryRun: false, limit: null, width: 128, verbose: false, types: ['brand', 'conglomerate', 'subsidiary', 'product'] }
  for (let i = 2; i < argv.length; i++) {
    const f = argv[i]
    if (f === '--dry-run') a.dryRun = true
    else if (f === '--limit') a.limit = Number(argv[++i])
    else if (f === '--width') a.width = Number(argv[++i])
    else if (f === '--type') a.types = argv[++i] === 'all' ? null : argv[i].split(',').map(s => s.trim()).filter(Boolean)
    else if (f === '--verbose' || f === '-v') a.verbose = true
    else if (f === '--help' || f === '-h') { printHelp(); exit(0) }
  }
  return a
}

function printHelp() {
  console.log(`
enrich-wikidata.mjs — match entities to Wikidata, auto-apply confident logos, queue the rest

  node enrich-wikidata.mjs [flags]

Flags:
  --dry-run     Resolve + classify and print a summary; write nothing
  --limit N     Only process the first N entities (testing)
  --type CSV    Entity types to process (default: brand,conglomerate,subsidiary,product;
                use "all" to include legal-entity)
  --width N     Logo thumbnail width in px (default 128)
  --verbose     Per-entity detail
`)
}

// ─── Helpers ──────────────────────────────────────────────────────────────
const sleep = ms => new Promise(r => setTimeout(r, ms))
const chunk = (arr, n) => { const out = []; for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n)); return out }

const CORP_SUFFIX_RE = /\b(inc|incorporated|corp|corporation|co|company|ltd|limited|llc|plc|sa|s\.a\.|ag|nv|n\.v\.|gmbh|holdings?|group|the)\b/gi
function normalizeName(s) {
  return (s ?? '')
    .toLowerCase()
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')   // strip accents
    .replace(/&/g, ' and ')
    .replace(CORP_SUFFIX_RE, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

// Commons filename → a stable thumbnail URL (Special:FilePath redirects to the file).
function commonsThumb(filename, width) {
  const enc = encodeURIComponent(filename.replace(/ /g, '_'))
  return `https://commons.wikimedia.org/wiki/Special:FilePath/${enc}${width ? `?width=${width}` : ''}`
}

async function wd(params) {
  const url = `${API}?${new URLSearchParams({ format: 'json', ...params })}`
  const res = await fetch(url, { headers: { 'User-Agent': UA, 'Accept': 'application/json' } })
  if (!res.ok) throw new Error(`Wikidata HTTP ${res.status}`)
  return res.json()
}

// Search Wikidata for items matching a name. Returns up to `limit` {id,label,description}.
async function searchEntities(name, limit = 7) {
  const json = await wd({ action: 'wbsearchentities', search: name, language: 'en', uselang: 'en', type: 'item', limit: String(limit) })
  return (json.search ?? []).map(s => ({ id: s.id, label: s.label ?? '', description: s.description ?? '' }))
}

// Fetch claims (P31 instance-of, P154 logo, P17 country) + aliases for a batch of QIDs.
async function getEntityClaims(qids) {
  const json = await wd({ action: 'wbgetentities', ids: qids.join('|'), props: 'claims|aliases|labels', languages: 'en' })
  const out = new Map()
  for (const [qid, ent] of Object.entries(json.entities ?? {})) {
    const claims = ent.claims ?? {}
    const instanceOf = (claims.P31 ?? [])
      .map(c => c.mainsnak?.datavalue?.value?.id)
      .filter(Boolean)
    const logoFile = (claims.P154 ?? [])
      .map(c => c.mainsnak?.datavalue?.value)
      .filter(v => typeof v === 'string')
    // Prefer an SVG logo when several exist.
    logoFile.sort((a, b) => (/\.svg$/i.test(b) ? 1 : 0) - (/\.svg$/i.test(a) ? 1 : 0))
    const country = (claims.P17 ?? [])
      .map(c => c.mainsnak?.datavalue?.value?.id)
      .filter(Boolean)
    const aliases = (ent.aliases?.en ?? []).map(a => a.value)
    const label = ent.labels?.en?.value ?? ''
    out.set(qid, { instanceOf, logoFile: logoFile[0] ?? null, country, aliases, label })
  }
  return out
}

// Resolve a set of type QIDs to human labels (for the review UI + label fallback).
async function getLabels(qids) {
  const out = new Map()
  if (qids.length === 0) return out
  for (const grp of chunk([...qids], 50)) {
    const json = await wd({ action: 'wbgetentities', ids: grp.join('|'), props: 'labels', languages: 'en' })
    for (const [qid, ent] of Object.entries(json.entities ?? {})) {
      out.set(qid, ent.labels?.en?.value ?? qid)
    }
    await sleep(150)
  }
  return out
}

function isCompanyType(instanceOfQids, typeLabels) {
  if (instanceOfQids.some(q => COMPANY_TYPE_QIDS.has(q))) return true
  return instanceOfQids.some(q => COMPANY_LABEL_RE.test(typeLabels.get(q) ?? ''))
}

// ─── DB ───────────────────────────────────────────────────────────────────
// Entities needing enrichment: no logo, no qid, and not already in the review
// queue (so re-runs are cheap and don't clobber prior review decisions).
async function fetchCandidates(supabase, types) {
  const queued = new Set()
  {
    let from = 0
    while (true) {
      const { data, error } = await supabase
        .from('logo_candidates').select('entity_id').order('entity_id').range(from, from + PAGE_SIZE - 1)
      if (error) throw error
      if (!data || data.length === 0) break
      for (const r of data) queued.add(r.entity_id)
      if (data.length < PAGE_SIZE) break
      from += PAGE_SIZE
    }
  }

  const all = []
  let from = 0
  while (true) {
    let q = supabase
      .from('entities')
      .select('id, name, type, hq_country')
      .is('logo_url', null)
      .is('wikidata_qid', null)
    if (types) q = q.in('type', types)
    const { data, error } = await q.order('id').range(from, from + PAGE_SIZE - 1)
    if (error) throw error
    if (!data || data.length === 0) break
    all.push(...data)
    if (data.length < PAGE_SIZE) break
    from += PAGE_SIZE
  }
  return all.filter(e => !queued.has(e.id))
}

// ─── Classification ─────────────────────────────────────────────────────────
// For one entity, score each search candidate and decide: auto-apply / queue / skip.
async function classify(entity, args, typeLabelCache) {
  const hits = await searchEntities(entity.name)
  if (hits.length === 0) return { decision: 'skip', reason: 'no search hits' }

  const claims = await getEntityClaims(hits.map(h => h.id))

  // Resolve any unseen type QIDs to labels (for display + company test).
  const unseenTypes = new Set()
  for (const h of hits) for (const q of claims.get(h.id)?.instanceOf ?? []) {
    if (!typeLabelCache.has(q)) unseenTypes.add(q)
  }
  if (unseenTypes.size) {
    const labels = await getLabels([...unseenTypes])
    for (const [q, l] of labels) typeLabelCache.set(q, l)
  }

  const target = normalizeName(entity.name)
  const candidates = hits.map(h => {
    const c = claims.get(h.id) ?? { instanceOf: [], logoFile: null, country: [], aliases: [], label: h.label }
    const names = [h.label, c.label, ...c.aliases].filter(Boolean)
    const exact = names.some(n => normalizeName(n) === target)
    const company = isCompanyType(c.instanceOf, typeLabelCache)
    const hasLogo = Boolean(c.logoFile)
    const countryMatch = Boolean(entity.hq_country) && c.country.length > 0 // soft signal only
    let score = 0
    if (exact) score += 0.5
    if (company) score += 0.25
    if (hasLogo) score += 0.2
    if (countryMatch) score += 0.05
    const typeNames = c.instanceOf.map(q => typeLabelCache.get(q) ?? q)
    return {
      qid: h.id, label: h.label || c.label, description: h.description,
      instanceOf: typeNames, logoFile: c.logoFile, exact, company, hasLogo, score,
    }
  })

  const strong = candidates.filter(c => c.exact && c.company && c.hasLogo)
  if (strong.length === 1) {
    const c = strong[0]
    return { decision: 'auto', pick: c, logo_url: commonsThumb(c.logoFile, args.width) }
  }

  // Otherwise queue every candidate that at least has a logo (top 3 by score).
  const reviewable = candidates.filter(c => c.hasLogo).sort((a, b) => b.score - a.score).slice(0, 3)
  if (reviewable.length === 0) return { decision: 'skip', reason: strong.length > 1 ? 'ambiguous, no usable logo' : 'no logo on any hit' }
  return {
    decision: 'review',
    candidates: reviewable.map((c, i) => ({
      wikidata_qid: c.qid,
      label:        c.label || null,
      description:  c.description || null,
      instance_of:  c.instanceOf.slice(0, 4).join(', ') || null,
      logo_url:     commonsThumb(c.logoFile, args.width),
      score:        Number(c.score.toFixed(3)),
      is_suggested: i === 0,
    })),
  }
}

// ─── Main ───────────────────────────────────────────────────────────────────
async function main() {
  const args = parseArgs()

  const url = env.NEXT_PUBLIC_SUPABASE_URL
  const key = env.SUPABASE_SECRET_KEY
  if (!url || !key) {
    console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SECRET_KEY (set them in .env.local or your shell).')
    exit(1)
  }
  const supabase = createClient(url, key, { auth: { persistSession: false } })

  console.log(`Fetching entities (types: ${args.types ? args.types.join(', ') : 'all'}) with no logo_url and no wikidata_qid (excluding already-queued) ...`)
  let candidates = await fetchCandidates(supabase, args.types)
  if (args.limit) candidates = candidates.slice(0, args.limit)
  console.log(`-> ${candidates.length} entities to process\n`)
  if (candidates.length === 0) { console.log('Nothing to do.'); return }

  const typeLabelCache = new Map()
  const autos = []        // { id, name, qid, logo_url }
  const reviews = []       // { entity, candidates[] }
  let skipped = 0

  for (let i = 0; i < candidates.length; i++) {
    const e = candidates[i]
    process.stdout.write(`\r-> ${i + 1}/${candidates.length}  ${e.name.slice(0, 40).padEnd(40)}`)
    try {
      const r = await classify(e, args, typeLabelCache)
      if (r.decision === 'auto') {
        autos.push({ id: e.id, name: e.name, qid: r.pick.qid, logo_url: r.logo_url })
        if (args.verbose) console.log(`\n   AUTO  ${e.name} -> ${r.pick.qid} (${r.pick.label})`)
      } else if (r.decision === 'review') {
        reviews.push({ entity: e, candidates: r.candidates })
        if (args.verbose) console.log(`\n   QUEUE ${e.name} -> ${r.candidates.length} candidate(s)`)
      } else {
        skipped++
        if (args.verbose) console.log(`\n   skip  ${e.name} (${r.reason})`)
      }
    } catch (err) {
      skipped++
      if (args.verbose) console.log(`\n   ERR   ${e.name}: ${err.message}`)
    }
    await sleep(220)   // be polite to the Wikidata API
  }

  console.log(`\n\nClassified ${candidates.length}: ${autos.length} auto-apply, ${reviews.length} to review, ${skipped} skipped.`)

  if (args.dryRun) {
    console.log('\n[dry run] sample auto-applies:')
    for (const a of autos.slice(0, 15)) console.log(`   ${a.id.padEnd(30)} ${a.qid.padEnd(11)} ${a.logo_url}`)
    if (autos.length > 15) console.log(`   ... and ${autos.length - 15} more`)
    console.log('\n[dry run] sample review queue:')
    for (const r of reviews.slice(0, 15)) console.log(`   ${r.entity.id.padEnd(30)} ${r.candidates.length} candidate(s), top=${r.candidates[0].wikidata_qid} score=${r.candidates[0].score}`)
    if (reviews.length > 15) console.log(`   ... and ${reviews.length - 15} more`)
    console.log('\nNothing written (dry run).')
    return
  }

  // Apply auto matches.
  let written = 0, failed = 0
  for (const group of chunk(autos, 10)) {
    const results = await Promise.all(group.map(a =>
      supabase.from('entities').update({ wikidata_qid: a.qid, logo_url: a.logo_url }).eq('id', a.id)
        .then(({ error }) => error ? { ok: false, id: a.id, error } : { ok: true })
    ))
    for (const r of results) r.ok ? written++ : (failed++, args.verbose && console.log(`   FAIL ${r.id}: ${r.error.message}`))
  }
  console.log(`Auto-applied ${written} logos${failed ? `, ${failed} failed` : ''}.`)

  // Insert review candidates (ignore duplicates so re-runs are safe).
  const rows = reviews.flatMap(r => r.candidates.map(c => ({ entity_id: r.entity.id, ...c, status: 'pending' })))
  let queued = 0, qfailed = 0
  for (const group of chunk(rows, 50)) {
    const { error } = await supabase
      .from('logo_candidates')
      .upsert(group, { onConflict: 'entity_id,wikidata_qid', ignoreDuplicates: true })
    if (error) { qfailed += group.length; if (args.verbose) console.log(`   queue FAIL: ${error.message}`) }
    else queued += group.length
  }
  console.log(`Queued ${queued} review candidate(s) across ${reviews.length} entities${qfailed ? `, ${qfailed} failed` : ''}.`)
  console.log('\nReview the queued matches at /admin/logos.')
}

main().catch(e => { console.error(e); exit(1) })
