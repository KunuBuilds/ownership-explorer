/**
 * fetch-logos.mjs
 *
 * Populates entities.logo_url from Wikidata property P154 ("logo image").
 *
 * Reads entities that already have a wikidata_qid but no logo_url, looks up
 * their logo on the Wikidata Query Service (SPARQL), and writes a sized
 * Wikimedia Commons thumbnail URL back to Supabase. Safe to re-run — it only
 * touches rows where logo_url is still null.
 *
 * Prerequisites:
 *   - logo_url column exists:   alter table entities add column logo_url text;
 *   - wikidata_qid populated     (via import-wikidata.mjs)
 *   - env vars: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SECRET_KEY
 *     (auto-loaded from .env.local if the `dotenv` package is installed)
 *   - Node 18+ (uses global fetch)
 *
 * Usage:
 *   node fetch-logos.mjs                 # fetch + write all missing logos
 *   node fetch-logos.mjs --dry-run       # show what would change, write nothing
 *   node fetch-logos.mjs --limit 50      # only process first 50 (good for a test run)
 *   node fetch-logos.mjs --width 256     # thumbnail width in px (default 128)
 *   node fetch-logos.mjs --out logos.json
 *   node fetch-logos.mjs --verbose
 */

import { writeFileSync } from 'node:fs'
import { argv, exit, env, stdout } from 'node:process'
import { createClient } from '@supabase/supabase-js'

try { const d = await import('dotenv'); d.config({ path: '.env.local' }) } catch { /* dotenv optional */ }

const UA = 'WhoOwnsThis/1.0 (https://github.com/KunuBuilds/ownership-explorer; logo enrichment)'
const WDQS = 'https://query.wikidata.org/sparql'
const PAGE_SIZE = 1000

// ─── CLI ────────────────────────────────────────────────────────────────────

function parseArgs() {
  const a = { dryRun: false, limit: null, width: 128, batch: 100, out: null, verbose: false }
  for (let i = 2; i < argv.length; i++) {
    const f = argv[i]
    if (f === '--dry-run') a.dryRun = true
    else if (f === '--limit') a.limit = Number(argv[++i])
    else if (f === '--width') a.width = Number(argv[++i])
    else if (f === '--batch') a.batch = Number(argv[++i])
    else if (f === '--out') a.out = argv[++i]
    else if (f === '--verbose' || f === '-v') a.verbose = true
    else if (f === '--help' || f === '-h') { printHelp(); exit(0) }
  }
  return a
}

function printHelp() {
  console.log(`
fetch-logos.mjs — populate entities.logo_url from Wikidata P154

  node fetch-logos.mjs [flags]

Flags:
  --dry-run     Resolve logos and print a sample; write nothing to the DB
  --limit N     Only process the first N candidate entities (testing)
  --width N     Thumbnail width in px appended to the Commons URL (default 128)
  --batch N     QIDs per SPARQL request (default 100)
  --out FILE    Also dump resolved { id, name, logo_url } pairs to FILE
  --verbose     Per-batch detail
`)
}

// ─── Helpers ──────────────────────────────────────────────────────────────

const sleep = ms => new Promise(r => setTimeout(r, ms))
const chunk = (arr, n) => { const out = []; for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n)); return out }

// Query WDQS for P154 logos for a batch of QIDs. Returns Map<qid, logoUrl>.
async function fetchLogoBatch(qids, verbose) {
  const values = qids.map(q => `wd:${q}`).join(' ')
  const query = `SELECT ?item ?logo WHERE { VALUES ?item { ${values} } ?item wdt:P154 ?logo . }`

  const res = await fetch(WDQS, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Accept': 'application/sparql-results+json',
      'User-Agent': UA,
    },
    body: new URLSearchParams({ query }).toString(),
  })

  if (!res.ok) {
    if (verbose) console.log(`   WDQS HTTP ${res.status} for batch of ${qids.length}`)
    return new Map()
  }

  const json = await res.json()
  const map = new Map()
  for (const row of json.results?.bindings ?? []) {
    const qid = row.item.value.split('/').pop()
    const url = row.logo.value.replace(/^http:/, 'https:')
    const existing = map.get(qid)
    // When an item has multiple logos, prefer an SVG (scales cleanly).
    if (!existing || (/\.svg$/i.test(url) && !/\.svg$/i.test(existing))) {
      map.set(qid, url)
    }
  }
  return map
}

async function fetchCandidates(supabase) {
  const all = []
  let from = 0
  while (true) {
    const { data, error } = await supabase
      .from('entities')
      .select('id, name, wikidata_qid')
      .not('wikidata_qid', 'is', null)
      .is('logo_url', null)
      .order('id')
      .range(from, from + PAGE_SIZE - 1)
    if (error) throw error
    if (!data || data.length === 0) break
    all.push(...data)
    if (data.length < PAGE_SIZE) break
    from += PAGE_SIZE
  }
  return all
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
  const supabase = createClient(url, key)

  console.log('Fetching entities with a wikidata_qid and no logo_url ...')
  let candidates = await fetchCandidates(supabase)
  if (args.limit) candidates = candidates.slice(0, args.limit)
  console.log(`-> ${candidates.length} candidate entities`)
  if (candidates.length === 0) { console.log('Nothing to do.'); return }

  // QID -> [entities]  (a QID could, in rare cases, map to more than one entity)
  const byQid = new Map()
  for (const e of candidates) {
    const arr = byQid.get(e.wikidata_qid) ?? []
    arr.push(e)
    byQid.set(e.wikidata_qid, arr)
  }
  const qids = [...byQid.keys()]

  // Resolve logos in polite batches
  const logoByQid = new Map()
  const batches = chunk(qids, args.batch)
  for (let i = 0; i < batches.length; i++) {
    stdout.write(`-> WDQS batch ${i + 1}/${batches.length} ... `)
    try {
      const m = await fetchLogoBatch(batches[i], args.verbose)
      for (const [q, u] of m) logoByQid.set(q, u)
      console.log(`${m.size} logos`)
    } catch (err) {
      console.log(`ERROR ${err.message}`)
    }
    await sleep(400)
  }

  // Build updates
  const updates = []
  for (const [qid, entities] of byQid) {
    const base = logoByQid.get(qid)
    if (!base) continue
    const logo_url = args.width ? `${base}?width=${args.width}` : base
    for (const e of entities) updates.push({ id: e.id, name: e.name, logo_url })
  }

  console.log(`\nResolved logos for ${updates.length}/${candidates.length} entities`)

  if (args.out) {
    writeFileSync(args.out, JSON.stringify(updates, null, 2))
    console.log(`Wrote ${args.out}`)
  }

  if (args.dryRun) {
    console.log('\n[dry run] sample of what would be written:')
    for (const u of updates.slice(0, 20)) console.log(`   ${u.id.padEnd(32)} ${u.logo_url}`)
    if (updates.length > 20) console.log(`   ... and ${updates.length - 20} more`)
    return
  }

  // Write back in small concurrent chunks
  let written = 0, failed = 0
  for (const group of chunk(updates, 10)) {
    const results = await Promise.all(group.map(u =>
      supabase.from('entities').update({ logo_url: u.logo_url }).eq('id', u.id)
        .then(({ error }) => error ? { ok: false, id: u.id, error } : { ok: true })
    ))
    for (const r of results) {
      if (r.ok) written++
      else { failed++; if (args.verbose) console.log(`   FAIL ${r.id}: ${r.error.message}`) }
    }
    stdout.write(`\r-> written ${written}/${updates.length}`)
  }
  console.log(`\nDone. Updated ${written} entities${failed ? `, ${failed} failed` : ''}.`)
}

main().catch(e => { console.error(e); exit(1) })
