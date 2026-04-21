/**
 * EDGAR Scraper -- "Who Owns This" seed tool
 *
 * Fetches subsidiary lists from SEC annual filings and outputs JSON structured
 * for the Who Owns This Supabase schema:
 *   entities[]  -> `entities` table rows
 *   ownership[] -> `ownership` edge list rows
 *   sources[]   -> `sources` table rows
 *
 * Supports two filing types automatically:
 *   10-K  (domestic filers)  -> Exhibit 21  "Subsidiaries of the Registrant"
 *   20-F  (foreign filers)   -> Exhibit 8   "List of Subsidiaries"
 *
 * CIK resolution strategy (v2):
 *   Previously the scraper called data.sec.gov/submissions/CIK{n}.json to look
 *   up filing history. That API uses a different CIK namespace and silently
 *   returned wrong companies (e.g. LVMUY -> Sterling Bancorp).
 *
 *   Now ALL CIK resolution and filing lookup goes through the EDGAR company
 *   search endpoint (/cgi-bin/browse-edgar), which is what the EDGAR website
 *   itself uses. This endpoint:
 *     - Returns the correct entity for any CIK or company name query
 *     - Lists recent filings with accession numbers directly in the Atom feed
 *     - Never maps the same CIK to a different company
 *
 * Usage:
 *   node scraper.mjs                              # scrape all pre-seeded companies
 *   node scraper.mjs --companies KHC,LVMUY        # by ticker
 *   node scraper.mjs --cik 0001571996             # by CIK (assumes 10-K)
 *   node scraper.mjs --cik 0001070154 --foreign   # by CIK, force 20-F mode
 *   node scraper.mjs --out results.json           # write output to file
 *   node scraper.mjs --verbose                    # show each HTTP request
 *   node scraper.mjs --list                       # print all pre-seeded tickers
 *
 * Finding a CIK:
 *   https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&company=<name>&type=10-K
 *   https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&company=<name>&type=20-F
 */

import fetch from 'node-fetch';
import * as cheerio from 'cheerio';
import { writeFileSync } from 'fs';
import { argv, exit } from 'process';

// ---- Filing type definitions -------------------------------------------------

const FILING = {
  DOMESTIC: {
    form:         '10-K',
    formAlt:      '10-K/A',
    exhibitLabel: 'Exhibit 21',
    patterns:     [/subsidiaries/i, /ex[-_]?21/i, /exhibit\s*21/i],
    sourcePrefix: 'sec-ex21',
  },
  FOREIGN: {
    form:         '20-F',
    formAlt:      '20-F/A',
    exhibitLabel: 'Exhibit 8',
    // Word boundary after "8" avoids matching exhibit 8.1, exhibit 81, etc.
    patterns:     [/subsidiaries/i, /ex[-_]?8\b/i, /exhibit\s*8\b/i, /list of subsidiaries/i],
    sourcePrefix: 'sec-ex8',
  },
};

// ---- Pre-seeded company map --------------------------------------------------
// The `cik` field is used directly with the EDGAR company search endpoint
// (/cgi-bin/browse-edgar?CIK=...) which is authoritative and never misroutes.
// The `name` field is only used as a display label -- the actual name is always
// taken from the EDGAR search result.
//
// To find a CIK:
//   Domestic: https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&company=<n>&type=10-K
//   Foreign:  https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&company=<n>&type=20-F

const CIK_MAP = {

  // == Luxury / Fashion -- Foreign (20-F / Exhibit 8) ========================
  // Deregistered in 2003: LVMUY:  { cik: '0000824046', name: 'LVMH MOET HENNESSY LOUIS VUITTON',      filing: 'FOREIGN' }, // Louis Vuitton, Dior, Bulgari, Tiffany, Sephora, TAG Heuer
  // Never registered PPRUY:  { cik: '0001393751', name: 'Kering SA',                             filing: 'FOREIGN'  }, // Gucci, Saint Laurent, Bottega Veneta, Balenciaga, Alexander McQueen
  // Never registered CFRUY:  { cik: '0001285785', name: 'Cie Financiere Richemont SA',           filing: 'FOREIGN'  }, // Cartier, IWC, Van Cleef & Arpels, // Dunhill, Piaget
  // Never registered HESAY:  { cik: '0001467373', name: 'Hermes International SCA',              filing: 'FOREIGN'  },
  BURBY:  { cik: '0001403708', name: 'Burberry Group PLC',                    filing: 'FOREIGN'  },

  // == Luxury / Fashion -- Domestic (10-K / Exhibit 21) ======================
  TPR:    { cik: '0001116132', name: 'Tapestry Inc',                          filing: 'DOMESTIC' }, // Coach, Kate Spade, Stuart Weitzman
  CPRI:   { cik: '0001530721', name: 'Capri Holdings Ltd',                    filing: 'DOMESTIC' }, // Versace, Jimmy Choo, Michael Kors
  PVH:    { cik: '0000078239', name: 'PVH Corp',                              filing: 'DOMESTIC' }, // Calvin Klein, Tommy Hilfiger
  RL:     { cik: '0001037038', name: 'Ralph Lauren Corp',                     filing: 'DOMESTIC' },
  HBI:    { cik: '0001359841', name: 'Hanesbrands Inc',                       filing: 'DOMESTIC' }, // Champion, Bonds

  // == Food & Beverage -- Foreign ============================================
  // Never registered NSRGY:  { cik: '0001285785', name: 'Nestle SA',                             filing: 'FOREIGN'  }, // KitKat, Nespresso, Purina, Gerber, Maggi, San Pellegrino
  ADRNY:  { cik: '0001703401', name: 'Anheuser-Busch InBev SA/NV',            filing: 'FOREIGN'  }, // Budweiser, Corona, Stella Artois, Becks, Leffe, Hoegaarden
  DANOY:  { cik: '0001285785', name: 'Danone SA',                             filing: 'FOREIGN'  }, // Evian, Activia, Alpro, Aptamil, Volvic
  HKHHF:  { cik: '0001285785', name: 'Heineken NV',                           filing: 'FOREIGN'  }, // Heineken, Amstel, Dos Equis, Tecate, Tiger, Sol
  MDLZ:   { cik: '0001103982', name: 'Mondelez International, Inc.',          filing: 'DOMESTIC' }, // Oreo, Cadbury, Toblerone, Trident, Ritz, belVita

  // == Food & Beverage -- Domestic ===========================================
  KHC:    { cik: '0001637459', name: 'Kraft Heinz Co', 						 filing: 'DOMESTIC' }, // Lunchables, Heinz, Jell-O, Oscar Mayer, Velveeta, Philadelphia
  PG:     { cik: '0000080424', name: 'Procter & Gamble Co',                   filing: 'DOMESTIC' }, // Tide, Gillette, Pampers, Oral-B, Bounty, Febreze
  UL:     { cik: '0000101198', name: 'Unilever PLC',                          filing: 'DOMESTIC' }, // Dove, Hellmanns, Vaseline, Axe, Lipton
  GIS:    { cik: '0000040704', name: 'General Mills Inc',                     filing: 'DOMESTIC' }, // Cheerios, Betty Crocker, Pillsbury, Nature Valley, Yoplait
  K:      { cik: '0000055067', name: 'KELLANOVA', filing: 'DOMESTIC' }, // Pringles, Pop-Tarts, Cheez-It, Eggo, Special K
  CAG:    { cik: '0000023217', name: 'Conagra Brands Inc',                    filing: 'DOMESTIC' }, // Birds Eye, Healthy Choice, Slim Jim, Vlasic, Hunts
  CPB:    { cik: '0000016732', name: 'Campbell Soup Co',                      filing: 'DOMESTIC' }, // Pepperidge Farm, Snyders, Kettle Brand, Pace, V8
  MKC:    { cik: '0000063754', name: 'McCormick & Co',                        filing: 'DOMESTIC' }, // McCormick, Franks RedHot, Frenchs, Cholula
  DEO:    { cik: '0000835403', name: 'DIAGEO PLC', filing: 'FOREIGN' }, // Johnnie Walker, Guinness, Smirnoff, Baileys, Tanqueray
  STZ:    { cik: '0000016918', name: '', filing: 'DOMESTIC' }, // Corona, Robert Mondavi, Kim Crawford, Meiomi
  SAM:    { cik: '0000949870', name: 'Boston Beer Co',                        filing: 'DOMESTIC' }, // Samuel Adams, Truly, Twisted Tea, Angry Orchard
  TAP:    { cik: '0000024545', name: 'Molson Coors Beverage Co',              filing: 'DOMESTIC' }, // Coors, Miller, Blue Moon, Leinenkugels

  // == Consumer / Home -- Foreign ============================================
  RBGLY:  { cik: '0001703401', name: 'Reckitt Benckiser Group PLC',           filing: 'FOREIGN'  }, // Lysol, Durex, Mucinex, Clearasil, Nurofen, Dettol
  HENKY:  { cik: '0001393751', name: 'Henkel AG & Co KGaA',                   filing: 'FOREIGN'  }, // Schwarzkopf, Persil, Dial, Loctite, Fa

  // == Consumer / Home -- Domestic ===========================================
  CL:     { cik: '0000021665', name: 'Colgate-Palmolive Co',                  filing: 'DOMESTIC' }, // Colgate, Hills Pet, Toms of Maine, Palmolive, Speed Stick
  CHD:    { cik: '0000313927', name: 'Church & Dwight Co',                    filing: 'DOMESTIC' }, // Arm & Hammer, OxiClean, Trojan, Vitafusion, Waterpik
  EL:     { cik: '0001001250', name: 'ESTEE LAUDER COMPANIES INC', filing: 'DOMESTIC' }, // MAC, Clinique, La Mer, Jo Malone, Bobbi Brown, Aveda
  REV:    { cik: '0000887921', name: 'Revlon Inc',                            filing: 'DOMESTIC' }, // Elizabeth Arden, American Crew
  NWL:    { cik: '0000814453', name: 'Newell Brands Inc',                     filing: 'DOMESTIC' }, // Rubbermaid, Sharpie, Coleman, Yankee Candle, Elmers, Graco
  SPB:    { cik: '0001539838', name: 'Spectrum Brands Holdings Inc',          filing: 'DOMESTIC' }, // Remington, Rayovac, Black+Decker HHI

  // == Media & Entertainment -- Foreign =====================================
  SONY:   { cik: '0000313838', name: 'Sony Group Corp',                       filing: 'FOREIGN'  }, // PlayStation, Columbia Pictures, Epic Records, Sony Music
  VIVHY:  { cik: '0001393818', name: 'Vivendi SE',                            filing: 'FOREIGN'  }, // Universal Music Group, Canal+, Gameloft

  // == Media & Entertainment -- Domestic ====================================
  CMCSA:  { cik: '0001166691', name: 'Comcast Corp',                          filing: 'DOMESTIC' }, // NBCUniversal, Peacock, Sky, DreamWorks, Universal Parks
  WBD:    { cik: '0001437107', name: 'Warner Bros Discovery Inc',             filing: 'DOMESTIC' }, // HBO, CNN, DC, TBS, Discovery, Food Network
  PARA:   { cik: '0000813828', name: 'Paramount Global',                      filing: 'DOMESTIC' }, // CBS, MTV, Nickelodeon, BET, Comedy Central, Paramount+
  FOXA:   { cik: '0001754301', name: 'Fox Corp',                              filing: 'DOMESTIC' }, // Fox News, Fox Sports, Tubi
  NYT:    { cik: '0000071691', name: 'New York Times Co',                     filing: 'DOMESTIC' }, // The Athletic, Wordle, Wirecutter, Cooking

  // == Tech -- Foreign =======================================================
  SAP:    { cik: '0001285785', name: 'SAP SE',                                filing: 'FOREIGN'  }, // Qualtrics, Concur, Ariba

  // == Tech -- Domestic ======================================================
  GOOGL:  { cik: '0001652044', name: 'Alphabet Inc',                          filing: 'DOMESTIC' }, // Google, YouTube, Waymo, DeepMind, Fitbit
  META:   { cik: '0001326801', name: 'Meta Platforms Inc',                    filing: 'DOMESTIC' }, // Facebook, Instagram, WhatsApp, Oculus/Meta Quest
  MSFT:   { cik: '0000789019', name: 'Microsoft Corp',                        filing: 'DOMESTIC' }, // LinkedIn, GitHub, Activision Blizzard, Nuance
  AMZN:   { cik: '0001018724', name: 'Amazon Com Inc',                        filing: 'DOMESTIC' }, // Whole Foods, Twitch, MGM, Ring, Zappos, Audible
  AAPL:   { cik: '0000320193', name: 'Apple Inc',                             filing: 'DOMESTIC' },

  // == Hotels & Travel -- Foreign ============================================
  ACCYY:  { cik: '0001285785', name: 'Accor SA',                              filing: 'FOREIGN'  }, // Sofitel, Novotel, Ibis, Fairmont, Raffles, Mercure, Pullman

  // == Hotels & Travel -- Domestic ===========================================
  MAR:    { cik: '0001048286', name: 'Marriott International Inc',            filing: 'DOMESTIC' }, // Ritz-Carlton, W Hotels, Westin, Sheraton, Courtyard
  HLT:    { cik: '0001468704', name: 'Hilton Worldwide Holdings Inc',         filing: 'DOMESTIC' }, // Waldorf Astoria, DoubleTree, Hampton, Conrad, Curio
  H:      { cik: '0001468174', name: 'Hyatt Hotels Corp', filing: 'DOMESTIC' }, // Park Hyatt, Andaz, Alila, Thompson Hotels
  IHG:    { cik: '0000858446', name: 'INTERCONTINENTAL HOTELS GROUP PLC /NEW/', filing: 'FOREIGN' }, // Holiday Inn, Crowne Plaza, Kimpton, Six Senses

  // == Autos -- Foreign ======================================================
  TOYOY:  { cik: '0001467373', name: 'Toyota Motor Corp',                     filing: 'FOREIGN'  }, // Lexus, Daihatsu, Hino
  VWAGY:  { cik: '0001285785', name: 'Volkswagen AG',                         filing: 'FOREIGN'  }, // Audi, Porsche, Lamborghini, Bentley, SEAT, Skoda, MAN, Scania
  BMWYY:  { cik: '0001285785', name: 'Bayerische Motoren Werke AG',           filing: 'FOREIGN'  }, // BMW, MINI, Rolls-Royce
  MBGYY:  { cik: '0001285785', name: 'Mercedes-Benz Group AG',                filing: 'FOREIGN'  }, // Mercedes-Benz, AMG, Maybach

  // == Autos -- Domestic =====================================================
  F:      { cik: '0000037996', name: 'Ford Motor Co',                         filing: 'DOMESTIC' }, // Lincoln
  GM:     { cik: '0001467858', name: 'General Motors Co',                     filing: 'DOMESTIC' }, // Chevrolet, GMC, Buick, Cadillac, OnStar
  STLA:   { cik: '0001605484', name: 'Stellantis N.V.', filing: 'FOREIGN' }, // Jeep, Dodge, Ram, Alfa Romeo, Maserati, Fiat, Peugeot, Citroen

  // == Sports & Apparel -- Foreign ===========================================
  ADDYY:  { cik: '0001285785', name: 'Adidas AG',                             filing: 'FOREIGN'  }, // Adidas

  // == Sports & Apparel -- Domestic ==========================================
  NKE:    { cik: '0000320187', name: 'Nike Inc',                              filing: 'DOMESTIC' }, // Converse
  LULU:   { cik: '0001397187', name: 'Lululemon Athletica Inc',               filing: 'DOMESTIC' },
  UA:     { cik: '0001336917', name: 'Under Armour Inc',                      filing: 'DOMESTIC' },
  VFC:    { cik: '0000103379', name: 'VF Corp',                               filing: 'DOMESTIC' }, // Vans, Supreme, The North Face, Timberland, Dickies

  // == Finance & Insurance -- Domestic =======================================
  BRK:    { cik: '0001067983', name: 'Berkshire Hathaway Inc',                filing: 'DOMESTIC' }, // GEICO, BNSF, Dairy Queen, Pilot, Sees Candies, NetJets
  AIG:    { cik: '0000005272', name: 'American International Group Inc',      filing: 'DOMESTIC' },
};

// ---- CLI args ---------------------------------------------------------------

function parseArgs() {
  const args = argv.slice(2);
  const opts = { tickers: null, cik: null, foreign: false, out: null, verbose: false, list: false, lookup: null };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--companies' && args[i+1]) opts.tickers = args[++i].split(',').map(s => s.trim().toUpperCase());
    if (args[i] === '--cik'       && args[i+1]) opts.cik     = args[++i].padStart(10, '0');
    if (args[i] === '--foreign')                opts.foreign = true;
    if (args[i] === '--out'       && args[i+1]) opts.out     = args[++i];
    if (args[i] === '--verbose')                opts.verbose = true;
    if (args[i] === '--list')                   opts.list    = true;
    if (args[i] === '--lookup'    && args[i+1]) {
      const name = args[++i];
      const nextIsForm = args[i+1] && /^(10-K|20-F)$/i.test(args[i+1]);
      const form = nextIsForm ? args[++i].toUpperCase() : null;
      opts.lookup = { name, form };
    }
  }
  return opts;
}

// ---- HTTP helper ------------------------------------------------------------

const DELAY_MS = 200; // SEC asks for max 10 req/sec; 200ms gives comfortable headroom
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function get(url, verbose) {
  await sleep(DELAY_MS);
  if (verbose) console.log(`    GET ${url}`);
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'WhoOwnsThis-scraper contact@example.com',
      'Accept':     'text/html,application/json,application/atom+xml',
    }
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`);
  return res;
}

// ---- EDGAR company search ---------------------------------------------------
//
// The EDGAR company search endpoint (/cgi-bin/browse-edgar) is authoritative:
// it always maps a CIK to exactly the right entity. The old approach used the
// data.sec.gov/submissions/ API which silently maps some CIKs to wrong companies.
//
// We use two modes:
//   A) CIK known  -> browse-edgar?CIK=<n>&type=<form>  (direct lookup)
//   B) CIK unknown -> browse-edgar?company=<name>&type=<form>  (name search)
//
// Both return an Atom feed. We parse:
//   - The company name and CIK from the <company-info> element
//   - The most recent filing accession number from the first <entry>

// ---- CIK lookup (--lookup) --------------------------------------------------

/**
 * Search EDGAR by company name and print all matching companies with their
 * CIKs, most recent filing date, and a ready-to-paste CIK_MAP entry.
 * Searches both 10-K and 20-F unless a form is specified.
 *
 * Usage:
 *   node scraper.mjs --lookup "kraft heinz"
 *   node scraper.mjs --lookup lvmh 20-F
 *   node scraper.mjs --lookup "bayerische motoren" 20-F
 */
async function runLookup({ name, form }, verbose) {
  const forms = form ? [form] : ['10-K', '20-F'];
  const found  = new Map(); // cik -> best result

  for (const f of forms) {
    const params = new URLSearchParams({
      action: 'getcompany', company: name, type: f,
      dateb: '', owner: 'include', count: '40',
      search_text: '', output: 'atom',
    });
    const url = `${EDGAR_BROWSE}?${params}`;
    let xml;
    try {
      const res = await get(url, verbose);
      xml = await res.text();
    } catch (e) {
      console.log(`  EDGAR search error for ${f}: ${e.message}`);
      continue;
    }

    const $ = cheerio.load(xml, { xmlMode: true });

    // Each <entry> in the feed is one filing from one company.
    // We want one row per unique CIK, keeping the most recent filing.
    $('entry').each((_, entry) => {
      const companyName = $(entry).find('company-name').text().trim()
        || $(entry).find('conformed-name').text().trim()
        || $(entry).find('entity-name').text().trim();
      const cik = $(entry).find('cik').text().trim().padStart(10, '0');
      const formType   = $(entry).find('filing-type').text().trim();
      const filingDate = $(entry).find('filing-date').text().trim()
        || $(entry).find('updated').text().trim().slice(0, 10);
      const accession  = $(entry).find('accession-number').text().trim();

      if (!cik || cik === '0000000000') return;

      const existing = found.get(cik);
      if (!existing || filingDate > existing.filingDate) {
        found.set(cik, { cik, companyName, formType, filingDate, accession });
      }
    });

    // Also check the feed-level company block (returned when a CIK is searched directly)
    const feedName = $('company-name').first().text().trim()
      || $('conformed-name').first().text().trim();
    const feedCIK  = $('cik').first().text().trim().padStart(10, '0');
    if (feedCIK && feedCIK !== '0000000000' && feedName && !found.has(feedCIK)) {
      const firstEntry = $('entry').first();
      found.set(feedCIK, {
        cik:         feedCIK,
        companyName: feedName,
        formType:    firstEntry.find('filing-type').text().trim() || f,
        filingDate:  firstEntry.find('filing-date').text().trim() || '?',
        accession:   firstEntry.find('accession-number').text().trim() || '?',
      });
    }
  }

  if (found.size === 0) {
    console.log(`\n  No results for "${name}"`);
    console.log(`  Try a shorter or different search term.`);
    console.log(`  Manual search: https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&company=${encodeURIComponent(name)}&type=10-K`);
    return;
  }

  // Sort by filing date descending so the most recently active company is first
  const results = [...found.values()].sort((a, b) => b.filingDate.localeCompare(a.filingDate));

  console.log(`\n  Results for "${name}" (${results.length} match${results.length === 1 ? '' : 'es'}):\n`);
  console.log(`  ${'CIK'.padEnd(12)} ${'Form'.padEnd(6)} ${'Filed'.padEnd(12)} Company name`);
  console.log(`  ${'-'.repeat(11)} ${'-'.repeat(5)} ${'-'.repeat(11)} ${'-'.repeat(42)}`);
  for (const r of results) {
    console.log(`  ${r.cik.padEnd(12)} ${(r.formType||'?').padEnd(6)} ${(r.filingDate||'?').padEnd(12)} ${r.companyName}`);
  }

  // Suggest a CIK_MAP entry for the top (most recently active) result
  const top = results[0];
  const filingType = top.formType?.startsWith('20') ? 'FOREIGN' : 'DOMESTIC';
  console.log(`\n  Suggested CIK_MAP entry (verify the company name is correct above):`);
  console.log(`  TICKER: { cik: '${top.cik}', name: '${top.companyName}', filing: '${filingType}' },\n`);
}

const EDGAR_BROWSE = 'https://www.sec.gov/cgi-bin/browse-edgar';

/**
 * Query the EDGAR company search and return the most recent filing of the
 * given form type for a company identified by CIK or name.
 *
 * Returns: {
 *   cik:             '0001285785',
 *   company_name:    'LVMH MOET HENNESSY LOUIS VUITTON',
 *   accession_number: '0001285785-24-000012',
 *   filing_date:     '2024-03-15',
 * }
 * or null if nothing found.
 */
async function edgarSearch({ cik, name, filingType }, verbose) {
  const { form, formAlt } = FILING[filingType];

  // Build the query URL. Using &output=atom gives us a machine-readable feed.
  const params = new URLSearchParams({
    action:      'getcompany',
    type:        form,
    dateb:       '',
    owner:       'include',
    count:       '10',
    search_text: '',
    output:      'atom',
  });
  if (cik)  params.set('CIK',     cik);
  else      params.set('company', name);

  const url = `${EDGAR_BROWSE}?${params}`;
  let xml;
  try {
    const res = await get(url, verbose);
    xml = await res.text();
  } catch (e) {
    if (verbose) console.log(`    EDGAR search failed: ${e.message}`);
    return null;
  }

  const $ = cheerio.load(xml, { xmlMode: true });

  // Extract company name and CIK from the feed header
  const resolvedName = $('company-name').first().text().trim()
    || $('conformed-name').first().text().trim();
  const resolvedCIK  = $('cik').first().text().trim().padStart(10, '0')
    || $('assigned-sic').parent().find('cik').text().trim().padStart(10, '0');

  if (!resolvedName && !resolvedCIK) {
    if (verbose) console.log(`    No results in EDGAR Atom feed`);
    return null;
  }

  // Find the first filing entry that matches our form type
  let accessionNumber = null;
  let filingDate      = null;

  $('entry').each((_, entry) => {
    if (accessionNumber) return;
    const formType = $(entry).find('filing-type').text().trim();
    if (formType === form || formType === formAlt) {
      // Accession number is in the <accession-number> tag or can be parsed from the <id>
      accessionNumber = $(entry).find('accession-number').text().trim();
      if (!accessionNumber) {
        // Fallback: extract from the entry <id> URL
        const id = $(entry).find('id').text().trim();
        const m  = id.match(/accession-number=([0-9-]+)/);
        if (m) accessionNumber = m[1];
      }
      filingDate = $(entry).find('filing-date').text().trim()
        || $(entry).find('updated').text().trim().slice(0, 10);
    }
  });

  if (!accessionNumber) {
    if (verbose) console.log(`    No ${form} entries in Atom feed (company may not file this form type)`);
    return null;
  }

  return {
    cik:              resolvedCIK || cik,
    company_name:     resolvedName,
    accession_number: accessionNumber,
    filing_date:      filingDate,
  };
}

/**
 * If edgarSearch finds no filing for the configured form type, retry with
 * the other type (some companies switch between 10-K and 20-F over time).
 */
async function edgarSearchWithFallback(target, verbose) {
  const primaryResult = await edgarSearch(target, verbose);
  if (primaryResult) return { ...primaryResult, filing_type: target.filingType };

  const altType = target.filingType === 'DOMESTIC' ? 'FOREIGN' : 'DOMESTIC';
  if (verbose) console.log(`    No ${FILING[target.filingType].form} found, trying ${FILING[altType].form}...`);

  const fallbackResult = await edgarSearch({ ...target, filingType: altType }, verbose);
  if (fallbackResult) {
    console.log(`  note: switched from ${FILING[target.filingType].form} to ${FILING[altType].form}`);
    return { ...fallbackResult, filing_type: altType };
  }

  return null;
}

// ---- Filing index + exhibit -------------------------------------------------

/**
 * Fetch the filing index page for an accession number and find the exhibit URL.
 * The index is an HTML table; we match rows against the exhibit patterns.
 */
async function findExhibitURL(accessionNumber, cik, filingType, verbose) {
  const { patterns, exhibitLabel } = FILING[filingType];
  const numericCIK = parseInt(cik, 10);
  const accClean   = accessionNumber.replace(/-/g, '');
  const indexUrl   = `https://www.sec.gov/Archives/edgar/data/${numericCIK}/${accClean}/${accessionNumber}-index.htm`;

  let html;
  try {
    const res = await get(indexUrl, verbose);
    html = await res.text();
  } catch (e) {
    if (verbose) console.log(`    Could not fetch filing index: ${e.message}`);
    return null;
  }

  const $ = cheerio.load(html);
  let href = null;

  // Primary: structured document table (Seq | Description | Document | Type | Size)
  $('table tr').each((_, row) => {
    if (href) return;
    const cells = $(row).find('td');
    if (cells.length < 3) return;
    const desc     = cells.eq(1).text().toLowerCase();
    const type     = cells.eq(3).text().toLowerCase();
    const combined = desc + ' ' + type;
    if (patterns.some(p => p.test(combined))) {
      const link = cells.eq(2).find('a').attr('href');
      if (link) href = link;
    }
  });

  // Fallback: any link with ex-21 or ex-8 in the href
  if (!href) {
    const hrefPat = filingType === 'FOREIGN' ? /ex[-_]?8\b/i : /ex[-_]?21/i;
    $('a[href]').each((_, a) => {
      if (!href) {
        const h = $(a).attr('href') || '';
        if (hrefPat.test(h)) href = h;
      }
    });
  }

  if (!href) {
    if (verbose) console.log(`    ${exhibitLabel} not found in filing index`);
    return null;
  }

  return href.startsWith('http') ? href : `https://www.sec.gov${href}`;
}

/**
 * Download and parse an exhibit document (Ex 21 or Ex 8).
 * Returns [{ name, jurisdiction }].
 */
async function parseExhibit(url, verbose) {
  const res = await get(url, verbose);
  const raw = await res.text();
  const $   = cheerio.load(raw);
  const subs = [];
  const seen = new Set();

  function add(name, jurisdiction) {
    name = (name || '').replace(/\s+/g, ' ').trim();
    if (!name || name.length < 3 || name.length > 300) return;
    if (/^(name|entity|subsidiary|subsidiaries|jurisdiction|state|country|incorporation|exhibit|page|\d+\.?\s*)$/i.test(name)) return;
    if (/^\d+$/.test(name)) return;
    const key = name.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      subs.push({ name, jurisdiction: (jurisdiction || '').trim() || null });
    }
  }

  // Strategy 1: HTML table rows (most common)
  $('table tr').each((_, row) => {
    const cells = $(row).find('td, th');
    if (!cells.length) return;
    const name = cells.eq(0).text().trim();
    const jur  = cells.length > 1 ? cells.eq(cells.length - 1).text().trim() : '';
    add(name, jur !== name ? jur : '');
  });

  // Strategy 2: Paragraph / list items (text-heavy filings)
  if (subs.length === 0) {
    $('p, li').each((_, el) => {
      if ($(el).find('table').length) return;
      add($(el).text().trim(), '');
    });
  }

  // Strategy 3: Plain-text line parsing (older filings)
  if (subs.length === 0) {
    const lines = raw
      .replace(/<[^>]+>/g, ' ')
      .split('\n')
      .map(l => l.trim())
      .filter(l => l.length > 3);
    const twoCol = lines.filter(l => /\s{3,}/.test(l)).length > lines.length * 0.3;
    for (const line of lines) {
      if (twoCol && /\s{3,}/.test(line)) {
        const parts = line.split(/\s{3,}/);
        add(parts[0], parts[parts.length - 1]);
      } else {
        add(line, '');
      }
    }
  }

  return subs;
}

// ---- Core scrape function ---------------------------------------------------

async function scrapeCompany({ cik, name, ticker, filingType }, verbose) {
  const result = {
    ticker:           ticker || null,
    cik,
    company_name:     name,
    filing_type:      filingType,
    filing_date:      null,
    accession_number: null,
    exhibit_url:      null,
    subsidiaries:     [],
    error:            null,
  };

  try {
    // 1. Resolve via EDGAR company search (always authoritative)
    if (verbose) console.log(`  EDGAR search: CIK=${cik || 'none'} name="${name}" type=${FILING[filingType].form}`);

    const filing = await edgarSearchWithFallback({ cik, name, filingType }, verbose);

    if (!filing) {
      throw new Error(
        `No ${FILING[filingType].form} filing found on EDGAR for "${name || cik}". `
        + `Verify the CIK at: https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany`
        + `&company=${encodeURIComponent(name || '')}&type=${FILING[filingType].form}`
      );
    }

    result.cik              = filing.cik || cik;
    result.company_name     = filing.company_name || name;
    result.filing_type      = filing.filing_type;
    result.accession_number = filing.accession_number;
    result.filing_date      = filing.filing_date;
    filingType              = filing.filing_type;

    if (verbose) {
      console.log(`  Resolved: ${result.company_name} (CIK ${result.cik})`);
      console.log(`  ${FILING[filingType].form}: ${result.filing_date} (${result.accession_number})`);
    }

    // 2. Find exhibit URL in the filing index
    const exhibitUrl = await findExhibitURL(
      result.accession_number, result.cik, filingType, verbose
    );
    if (!exhibitUrl) {
      throw new Error(
        `${FILING[filingType].exhibitLabel} not found in filing index. `
        + `Some companies embed the subsidiary list inline in the main filing body `
        + `rather than as a separate exhibit -- manual extraction required. `
        + `View the filing at: https://www.sec.gov/cgi-bin/browse-edgar`
        + `?action=getcompany&CIK=${result.cik}&type=${FILING[filingType].form}`
      );
    }
    result.exhibit_url = exhibitUrl;

    // 3. Parse the exhibit
    result.subsidiaries = await parseExhibit(exhibitUrl, verbose);
    if (result.subsidiaries.length === 0) {
      throw new Error(
        `${FILING[filingType].exhibitLabel} found but no subsidiaries could be parsed. `
        + `The document may be a scanned PDF or use an unusual layout.`
      );
    }

  } catch (e) {
    result.error = e.message;
  }

  return result;
}

// ---- Schema formatter -------------------------------------------------------

function slugify(str = '') {
  return str.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function formatForSupabase(results) {
  const entities  = [];
  const ownership = [];
  const sources   = [];
  const entitySet = new Set();

  for (const r of results) {
    if (r.error || !r.subsidiaries.length) continue;

    const ft         = FILING[r.filing_type];
    const parentSlug = slugify(r.company_name);

    if (!entitySet.has(parentSlug)) {
      entitySet.add(parentSlug);
      entities.push({
        slug:    parentSlug,
        name:    r.company_name,
        type:    'conglomerate',
        cik:     r.cik,
        ticker:  r.ticker || null,
      });
    }

    const sourceId = `${ft.sourcePrefix}-${r.accession_number}`;
    sources.push({
      id:               sourceId,
      title:            `${r.company_name} -- ${ft.exhibitLabel}, ${ft.form} filed ${r.filing_date}`,
      url:              r.exhibit_url,
      credibility_tier: 'Primary',
      published_at:     r.filing_date,
      publisher:        'SEC EDGAR',
    });

    for (const sub of r.subsidiaries) {
      const childSlug = slugify(sub.name);
      if (!entitySet.has(childSlug)) {
        entitySet.add(childSlug);
        entities.push({
          slug:         childSlug,
          name:         sub.name,
          type:         'subsidiary',
          jurisdiction: sub.jurisdiction || null,
        });
      }
      ownership.push({
        parent_slug:      parentSlug,
        child_slug:       childSlug,
        ownership_pct:    null,
        acquisition_date: null,
        source_id:        sourceId,
        notes:            sub.jurisdiction ? `Incorporated in ${sub.jurisdiction}` : null,
      });
    }
  }

  return { entities, ownership, sources };
}

// ---- Entry point ------------------------------------------------------------

async function main() {
  const opts = parseArgs();

  if (opts.lookup) {
    await runLookup(opts.lookup, opts.verbose);
    exit(0);
  }

  if (opts.list) {
    const domesticEntries = Object.entries(CIK_MAP).filter(([, v]) => v.filing === 'DOMESTIC');
    const foreignEntries  = Object.entries(CIK_MAP).filter(([, v]) => v.filing === 'FOREIGN');

    console.log(`\nPre-seeded companies (${Object.keys(CIK_MAP).length} total)\n`);
    console.log(`  10-K filers (Exhibit 21) -- ${domesticEntries.length} companies:`);
    for (const [ticker, { cik, name }] of domesticEntries)
      console.log(`    ${ticker.padEnd(8)} CIK ${cik}  ${name}`);

    console.log(`\n  20-F filers (Exhibit 8)  -- ${foreignEntries.length} companies:`);
    for (const [ticker, { cik, name }] of foreignEntries)
      console.log(`    ${ticker.padEnd(8)} CIK ${cik}  ${name}`);

    exit(0);
  }

  // Build target list
  let targets;
  if (opts.cik) {
    const filingType = opts.foreign ? 'FOREIGN' : 'DOMESTIC';
    targets = [{ cik: opts.cik, name: opts.cik, ticker: null, filingType }];
  } else if (opts.tickers) {
    targets = opts.tickers.map(t => {
      if (CIK_MAP[t]) return { ...CIK_MAP[t], ticker: t, filingType: CIK_MAP[t].filing };
      console.warn(`  Warning: ticker "${t}" not in CIK_MAP -- will search EDGAR by name (10-K mode)`);
      return { cik: null, name: t, ticker: t, filingType: 'DOMESTIC' };
    });
  } else {
    targets = Object.entries(CIK_MAP).map(([ticker, v]) => ({
      ...v, ticker, filingType: v.filing,
    }));
  }

  const domesticCount = targets.filter(t => t.filingType === 'DOMESTIC').length;
  const foreignCount  = targets.filter(t => t.filingType === 'FOREIGN').length;
  console.log(`\nEDGAR Scraper v2 -- ${targets.length} companies (${domesticCount} x 10-K/Ex21, ${foreignCount} x 20-F/Ex8)\n`);
  console.log(`CIK resolution: EDGAR company search endpoint (browse-edgar)\n`);

  const results = [];
  for (const target of targets) {
    const label   = (target.ticker || target.name || target.cik).padEnd(8);
    const typeTag = target.filingType === 'FOREIGN' ? '[20-F]' : '[10-K]';
    process.stdout.write(`-> ${label} ${typeTag}  `);

    const result = await scrapeCompany(target, opts.verbose);
    results.push(result);

    if (result.error) {
      console.log(`WARN  ${result.error.split('.')[0]}`);
    } else {
      console.log(`OK    ${result.company_name} -- ${result.subsidiaries.length} subsidiaries (${result.filing_date})`);
    }
  }

  const ok     = results.filter(r => !r.error && r.subsidiaries.length);
  const totalS = ok.reduce((a, r) => a + r.subsidiaries.length, 0);
  const supa   = formatForSupabase(results);

  console.log(
    `\nDone: ${ok.length}/${results.length} succeeded`
    + ` -- ${totalS} subsidiaries`
    + ` -- ${supa.entities.length} entities, ${supa.ownership.length} edges, ${supa.sources.length} sources`
  );

  const failed = results.filter(r => r.error);
  if (failed.length) {
    console.log(`\nFailed (${failed.length}):`);
    for (const r of failed)
      console.log(`  ${(r.ticker || r.cik || '').padEnd(8)}  ${r.error.split('.')[0]}`);
  }

  const rawJson  = JSON.stringify(results, null, 2);
  const supaJson = JSON.stringify(supa, null, 2);

  if (opts.out) {
    const base     = opts.out.replace(/\.json$/, '');
    const rawFile  = `${base}-raw.json`;
    const supaFile = `${base}-supabase.json`;
    writeFileSync(rawFile,  rawJson);
    writeFileSync(supaFile, supaJson);
    console.log(`\nRaw output    -> ${rawFile}`);
    console.log(`Supabase JSON -> ${supaFile}`);
  } else {
    console.log('\n-- Supabase-ready output ----------------------------------------\n');
    console.log(supaJson);
  }
}

main().catch(e => { console.error(e); exit(1); });
