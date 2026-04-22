/**
 * scripts/wiki-brands.mjs
 *
 * Wikipedia brand-portfolio scraper.
 *
 * Fetches brand lists from Wikipedia for consumer-goods conglomerates and
 * outputs JSON in the same format as the SEC scraper so import-seed.mjs
 * can ingest it directly.
 *
 * Usage:
 *   node scripts/wiki-brands.mjs --companies MDLZ,KHC,PG --out scripts/wiki-brands.json
 *   node scripts/wiki-brands.mjs --lookup "Mondelez International"    (find canonical Wikipedia title)
 *   node scripts/wiki-brands.mjs --list                                (show configured companies)
 *
 * Data sources (in priority order):
 *   1. "List of X brands" article (e.g. "List of Procter & Gamble brands")
 *   2. "Brands" section of the company's main article
 *   3. Infobox "Subsidiaries" field (fallback)
 *
 * Output format matches scripts/scraper.mjs:
 *   { entities: [], ownership: [], sources: [] }
 */

import { writeFileSync } from 'node:fs'
import { argv, exit } from 'node:process'
import fetch from 'node-fetch'
import * as cheerio from 'cheerio'

// ─── Configuration ────────────────────────────────────────────────────────

// Map of ticker → Wikipedia article info
// The `brands_article` field is optional — if set, it's the "List of X brands"
// article which is typically more comprehensive. If null or missing, we'll
// fall back to parsing the main article.
const WIKI_MAP = {
  // Consumer goods
  MDLZ:   { parent_id: 'mondelez',            main: 'Mondelez_International',     brands_article: 'List_of_Mondelez_International_brands' },
  KHC:    { parent_id: 'kraft-heinz',         main: 'Kraft_Heinz',                brands_article: 'List_of_Kraft_Heinz_brands' },
  PG:     { parent_id: 'procter-gamble-co',   main: 'Procter_%26_Gamble',         brands_article: 'List_of_Procter_%26_Gamble_brands' },
  CL:     { parent_id: 'colgate-palmolive-co',main: 'Colgate-Palmolive',          brands_article: null },
  KMB:    { parent_id: 'kimberly-clark',      main: 'Kimberly-Clark',             brands_article: null },
  UL:     { parent_id: 'unilever',            main: 'Unilever',                   brands_article: 'List_of_Unilever_brands' },
  NSRGY:  { parent_id: 'nestle',              main: 'Nestl%C3%A9',                brands_article: 'List_of_Nestl%C3%A9_brands' },
  GIS:    { parent_id: 'general-mills-inc',   main: 'General_Mills',              brands_article: 'List_of_General_Mills_brands' },
  CPB:    { parent_id: 'campbell-s-co',       main: 'Campbell_Soup_Company',      brands_article: null },
  HRL:    { parent_id: 'hormel-foods',        main: 'Hormel',                     brands_article: null },
  SJM:    { parent_id: 'j-m-smucker',         main: 'The_J.M._Smucker_Company',   brands_article: null },
  MKC:    { parent_id: 'mccormick-co-inc',    main: 'McCormick_%26_Company',      brands_article: null },
  K:      { parent_id: 'kellanova',           main: 'Kellanova',                  brands_article: null },
  CAG:    { parent_id: 'conagra-brands-inc',  main: 'Conagra_Brands',             brands_article: null },

  // Beverages / alcohol
  STZ:    { parent_id: 'constellation-brands',main: 'Constellation_Brands',       brands_article: null },
  DEO:    { parent_id: 'diageo',              main: 'Diageo',                     brands_article: 'List_of_Diageo_brands' },
  BUD:    { parent_id: 'ab-inbev',            main: 'AB_InBev',                   brands_article: 'List_of_AB_InBev_brands' },
  TAP:    { parent_id: 'molson-coors-beverage-co', main: 'Molson_Coors_Beverage_Company', brands_article: null },

  // Luxury / European (the deregistered SEC companies we couldn't scrape)
  LVMUY:  { parent_id: 'lvmh',                main: 'LVMH',                       brands_article: 'List_of_LVMH_brands' },
  CFRUY:  { parent_id: 'richemont',           main: 'Richemont',                  brands_article: null },
  PPRUY:  { parent_id: 'kering',              main: 'Kering',                     brands_article: null },
  HESAY:  { parent_id: 'hermes',              main: 'Herm%C3%A8s',                brands_article: null },

  // Apparel
  VFC:    { parent_id: 'v-f-corp',            main: 'VF_Corporation',             brands_article: null },
  PVH:    { parent_id: 'pvh-corp-de',         main: 'PVH_(company)',              brands_article: null },
  RL:     { parent_id: 'ralph-lauren-corp',   main: 'Ralph_Lauren_Corporation',   brands_article: null },
  TPR:    { parent_id: 'tapestry-inc',        main: 'Tapestry,_Inc.',             brands_article: null },
  CPRI:   { parent_id: 'capri-holdings-ltd',  main: 'Capri_Holdings',             brands_article: null },
  HBI:    { parent_id: 'hanesbrands-inc',     main: 'Hanesbrands',                brands_article: null },

  // Media
  CMCSA:  { parent_id: 'comcast-corp',        main: 'Comcast',                    brands_article: 'List_of_Comcast_subsidiaries' },
  WBD:    { parent_id: 'warner-bros-discovery-inc', main: 'Warner_Bros._Discovery', brands_article: null },
  FOX:    { parent_id: 'fox-corp',            main: 'Fox_Corporation',            brands_article: null },
  NYT:    { parent_id: 'new-york-times-co',   main: 'The_New_York_Times_Company', brands_article: null },

  // Conglomerates / diversified
  BRK:    { parent_id: 'berkshire',           main: 'Berkshire_Hathaway',         brands_article: 'List_of_assets_owned_by_Berkshire_Hathaway' },
  NWL:    { parent_id: 'newell-brands-inc',   main: 'Newell_Brands',              brands_article: null },
}

// ─── Helpers ──────────────────────────────────────────────────────────────

const UA = 'WhoOwnsThis/1.0 (ownership explorer; github.com/KunuBuilds/ownership-explorer)'

const slugify = (s) => s
  .toLowerCase()
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '')   // strip accents
  .replace(/[''`]/g, '')
  .replace(/&/g, 'and')
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-|-$/g, '')
  .slice(0, 100)

// Words/phrases that indicate a line is NOT a brand name, just formatting
const JUNK_PATTERNS = [
  /^see also$/i,
  /^references$/i,
  /^external links$/i,
  /^notes$/i,
  /^further reading$/i,
  /^history$/i,
  /^overview$/i,
  /^.*\[edit\].*$/i,
  /^contents$/i,
  /^main article:/i,
  /^category:/i,
  /^portal:/i,              // Wikipedia portal links
  /portal$/i,                // "Companies portal", "Lists portal"
  /^list of /i,              // "List of Cadbury brands", etc.
  /^bibliography$/i,
  /^sources$/i,
  /\s+portal$/i,             // catches "Companies portal" variants
  /^\s*$/,
]

const isJunk = (s) => JUNK_PATTERNS.some(p => p.test(s)) || s.length < 2 || s.length > 120

// Common strings indicating divested or former brands — we skip these
const FORMER_PATTERNS = [
  /^former brands$/i,
  /^divested$/i,
  /^sold in \d{4}$/i,
  /\(discontinued\)$/i,
  /\(sold\)$/i,
  /\(divested\)$/i,
]

const isFormerBrand = (s) => FORMER_PATTERNS.some(p => p.test(s))

async function fetchWikiHTML(articleTitle) {
  const url = `https://en.wikipedia.org/api/rest_v1/page/html/${articleTitle}`
  const res = await fetch(url, { headers: { 'User-Agent': UA, 'Accept': 'text/html' } })
  if (res.status === 404) return null
  if (!res.ok) throw new Error(`Wikipedia returned ${res.status} for ${articleTitle}`)
  return await res.text()
}

// ─── Parsers ──────────────────────────────────────────────────────────────

/**
 * Extracts brand names from a list article like "List of Procter & Gamble brands".
 * These are typically structured as bulleted lists grouped under category headings.
 */
function parseBrandsFromListArticle(html) {
  const $ = cheerio.load(html)
  const brands = []
  const seen = new Set()
  let inFormerSection = false

  // Remove infobox, navbox, reference lists that just confuse parsing
  $('.infobox, .navbox, .reference, .reflist, .sister-project, .hatnote, .mw-editsection').remove()

  // Find all list items in the main body
  $('h1, h2, h3, h4, ul li, ol li').each((_, el) => {
    const $el = $(el)
    const tag = el.tagName?.toLowerCase()

    // Track whether we're in a "former brands" section
    if (tag && ['h1', 'h2', 'h3', 'h4'].includes(tag)) {
      const heading = $el.text().trim()
      inFormerSection = /former|divested|discontinued/i.test(heading)
      return
    }

    if (inFormerSection) return

    // For list items, extract the brand name
    // The first link in a list item is usually the brand
    const firstLink = $el.find('a').first()
    const name = (firstLink.length ? firstLink.text() : $el.text())
      .trim()
	  .split(/\s+[–—]\s+/)[0]    // strip descriptions after em/en dash with spaces (not hyphens)
	  .split(/\s+-\s+/)[0]        // strip descriptions after hyphen with spaces around it
	  .split(/\s*\(/)[0]          // strip parentheticals
  	  .trim()

    if (!name || isJunk(name) || isFormerBrand(name)) return
    if (seen.has(name.toLowerCase())) return
    seen.add(name.toLowerCase())

    brands.push({
      name,
      wiki_link: firstLink.attr('href') ?? null,
    })
  })

  return brands
}

/**
 * Extracts brand names from the main article's "Brands" or "Products" section.
 * Finds the heading, then collects list items until the next heading.
 */
function parseBrandsFromMainArticle(html) {
  const $ = cheerio.load(html)
  const brands = []
  const seen = new Set()

  $('.infobox, .navbox, .reference, .reflist, .sister-project, .hatnote, .mw-editsection').remove()

  // Find headings that likely contain brand lists
  const brandHeadings = $('h2, h3, h4').filter((_, el) => {
    const text = $(el).text().toLowerCase()
    return /\b(brands?|products?|portfolio|subsidiaries|maisons?|marques)\b/.test(text)
      && !/former|divested|discontinued/.test(text)
  })

  brandHeadings.each((_, heading) => {
    let $next = $(heading).next()
    const stopTags = new Set(['H1', 'H2', 'H3', 'H4'])

    while ($next.length && !stopTags.has($next.prop('tagName'))) {
      $next.find('li').each((_, li) => {
        const $li = $(li)
        const firstLink = $li.find('a').first()
        const name = (firstLink.length ? firstLink.text() : $li.text())
          .trim()
		  .split(/\s+[–—]\s+/)[0]    // strip descriptions after em/en dash with spaces (not hyphens)
		  .split(/\s+-\s+/)[0]        // strip descriptions after hyphen with spaces around it
	  	  .split(/\s*\(/)[0]          // strip parentheticals
		  .trim()

        if (!name || isJunk(name) || isFormerBrand(name)) return
        if (seen.has(name.toLowerCase())) return
        seen.add(name.toLowerCase())

        brands.push({ name, wiki_link: firstLink.attr('href') ?? null })
      })
      $next = $next.next()
    }
  })

  return brands
}

// ─── Main scrape function ─────────────────────────────────────────────────

async function scrapeCompany(ticker, config, verbose) {
  const { parent_id, main, brands_article } = config

  if (verbose) console.log(`\n-> ${ticker.padEnd(8)} parent='${parent_id}'`)

  let brands = []
  let source_url = ''
  let source_title = ''

  // Strategy 1: Try the dedicated brands list article first
  if (brands_article) {
    if (verbose) console.log(`   trying list article: ${brands_article}`)
    const html = await fetchWikiHTML(brands_article)
    if (html) {
      brands = parseBrandsFromListArticle(html)
      source_url = `https://en.wikipedia.org/wiki/${brands_article}`
      source_title = decodeURIComponent(brands_article.replace(/_/g, ' '))
      if (verbose) console.log(`   -> ${brands.length} brands from list article`)
    }
  }

  // Strategy 2: Fall back to the main article's Brands section
  if (brands.length === 0) {
    if (verbose) console.log(`   trying main article: ${main}`)
    const html = await fetchWikiHTML(main)
    if (!html) {
      console.log(`-> ${ticker.padEnd(8)} FAIL  main article not found`)
      return { entities: [], ownership: [], sources: [] }
    }
    brands = parseBrandsFromMainArticle(html)
    source_url = `https://en.wikipedia.org/wiki/${main}`
    source_title = decodeURIComponent(main.replace(/_/g, ' '))
    if (verbose) console.log(`   -> ${brands.length} brands from main article`)
  }

  if (brands.length === 0) {
    console.log(`-> ${ticker.padEnd(8)} EMPTY no brands found`)
    return { entities: [], ownership: [], sources: [] }
  }

  // Build the output structure
  const source_id = `wiki-brands-${slugify(parent_id)}`
  const source = {
    id: source_id,
    title: `Wikipedia — ${source_title}`,
    url: source_url,
    credibility_tier: 'Secondary',
    published_at: new Date().toISOString().slice(0, 10),
    publisher: 'Wikipedia',
  }

  const entities = []
  const ownership = []
  const entitySeen = new Set()

  for (const brand of brands) {
    const brand_id = slugify(brand.name)
    if (!brand_id || brand_id.length < 2) continue
	if (brand_id === parent_id) continue  // skip self-references
    if (entitySeen.has(brand_id)) continue
    entitySeen.add(brand_id)

    entities.push({
      id: brand_id,
      name: brand.name,
      type: 'brand',
      cik: null,
      ticker: null,
      jurisdiction: null,
      flags: [],
    })

    ownership.push({
      parent_id,
      child_id: brand_id,
      source_id,
      region: null,
      acquired_date: null,
      divested_date: null,
      share_pct: null,
      notes: null,
    })
  }

  console.log(`-> ${ticker.padEnd(8)} OK    ${entities.length} brands`)
  return { entities, ownership, sources: [source] }
}

// ─── CLI ──────────────────────────────────────────────────────────────────

function parseArgs() {
  const args = { companies: null, out: 'scripts/wiki-brands.json', verbose: false, lookup: null, list: false }
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--companies') args.companies = argv[++i]
    else if (a === '--out') args.out = argv[++i]
    else if (a === '--verbose' || a === '-v') args.verbose = true
    else if (a === '--lookup') args.lookup = argv[++i]
    else if (a === '--list') args.list = true
    else if (a === '--help' || a === '-h') {
      console.log(`
Wikipedia Brand Scraper

Usage:
  node scripts/wiki-brands.mjs --companies MDLZ,KHC,PG --out scripts/brands.json
  node scripts/wiki-brands.mjs --lookup "Mondelez International"
  node scripts/wiki-brands.mjs --list

Flags:
  --companies   Comma-separated ticker list (required unless --list or --lookup)
  --out         Output path (default: scripts/wiki-brands.json)
  --verbose     Print detailed progress
  --lookup      Search Wikipedia for an article title
  --list        Show all configured companies
`)
      exit(0)
    }
  }
  return args
}

async function wikiSearch(query) {
  const url = `https://en.wikipedia.org/w/api.php?action=opensearch&search=${encodeURIComponent(query)}&limit=5&format=json`
  const res = await fetch(url, { headers: { 'User-Agent': UA } })
  return await res.json()
}

async function main() {
  const args = parseArgs()

  if (args.list) {
    console.log('Configured companies:\n')
    for (const [ticker, cfg] of Object.entries(WIKI_MAP)) {
      const src = cfg.brands_article ? `list article: ${cfg.brands_article}` : `main article: ${cfg.main}`
      console.log(`  ${ticker.padEnd(8)} ${cfg.parent_id.padEnd(30)} ${src}`)
    }
    exit(0)
  }

  if (args.lookup) {
    console.log(`Searching Wikipedia for "${args.lookup}"...\n`)
    const [_, titles, descriptions] = await wikiSearch(args.lookup)
    titles.forEach((t, i) => {
      console.log(`  ${i + 1}. ${t}`)
      if (descriptions[i]) console.log(`     ${descriptions[i]}`)
    })
    exit(0)
  }

  if (!args.companies) {
    console.error('Error: --companies is required (or use --list / --lookup).')
    console.error('Run with --help for usage.')
    exit(1)
  }

  const tickers = args.companies.split(',').map(t => t.trim().toUpperCase())
  const unknown = tickers.filter(t => !WIKI_MAP[t])
  if (unknown.length) {
    console.error(`Unknown tickers: ${unknown.join(', ')}`)
    console.error(`Run with --list to see configured companies.`)
    exit(1)
  }

  console.log(`Wikipedia Brand Scraper — ${tickers.length} compan${tickers.length === 1 ? 'y' : 'ies'}`)

  const out = { entities: [], ownership: [], sources: [] }
  let ok = 0

  for (const ticker of tickers) {
    try {
      const result = await scrapeCompany(ticker, WIKI_MAP[ticker], args.verbose)
      if (result.entities.length > 0) {
        out.entities.push(...result.entities)
        out.ownership.push(...result.ownership)
        out.sources.push(...result.sources)
        ok++
      }
      // Be polite — delay 500ms between companies
      await new Promise(r => setTimeout(r, 500))
    } catch (err) {
      console.log(`-> ${ticker.padEnd(8)} ERROR ${err.message}`)
    }
  }

  // Dedupe entities by ID (later entries win — doesn't matter since fields are same)
  const entityMap = new Map()
  for (const e of out.entities) entityMap.set(e.id, e)
  out.entities = Array.from(entityMap.values())

  writeFileSync(args.out, JSON.stringify(out, null, 2))
  console.log(`\nDone: ${ok}/${tickers.length} succeeded`)
  console.log(`Summary: ${out.entities.length} entities, ${out.ownership.length} edges, ${out.sources.length} sources`)
  console.log(`Output:  ${args.out}`)
}

main().catch(err => {
  console.error('Fatal:', err)
  exit(1)
})
