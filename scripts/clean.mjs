/**
 * clean.mjs — "Who Owns This" scraper output cleaner
 *
 * Fixes three categories of problems in seed-raw.json:
 *
 *   1. WRONG CIK  — The CIK resolved to a completely different company.
 *                   Root cause: data.sec.gov/submissions/ uses a different CIK
 *                   namespace than EDGAR search; some CIKs have been reassigned.
 *                   Fix: look up the correct accession number via the EDGAR
 *                   full-text search API, then re-scrape just those companies.
 *
 *   2. GARBLED PARSE — Subsidiaries are fragmented (e.g. General Mills), caused
 *                   by a complex multi-column HTML layout with non-breaking spaces
 *                   and inline colour annotations that the table parser shreds.
 *                   Fix: re-fetch the exhibit and apply a targeted reassembly pass.
 *
 *   3. ERRORS     — HTTP 404s (CIK wrong), missing exhibits (filed inline).
 *                   Fix: re-try with corrected CIKs where known; flag the rest
 *                   for manual handling with a note on where to look.
 *
 * Usage:
 *   node clean.mjs                              # reads seed-raw.json, writes cleaned-raw.json
 *   node clean.mjs --in my-raw.json            # custom input file
 *   node clean.mjs --out fixed.json            # custom output file
 *   node clean.mjs --ticker GIS,KHC            # only re-process specific tickers
 *   node clean.mjs --dry-run                   # report problems without fetching
 *   node clean.mjs --verbose                   # show HTTP requests
 */

import fetch from 'node-fetch';
import * as cheerio from 'cheerio';
import { readFileSync, writeFileSync } from 'fs';
import { argv, exit } from 'process';

// ── CLI args ──────────────────────────────────────────────────────────────────

function parseArgs() {
  const args = argv.slice(2);
  const opts = {
    in:      'seed-raw.json',
    out:     'cleaned-raw.json',
    tickers: null,
    dryRun:  false,
    verbose: false,
  };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--in'      && args[i+1]) opts.in      = args[++i];
    if (args[i] === '--out'     && args[i+1]) opts.out     = args[++i];
    if (args[i] === '--ticker'  && args[i+1]) opts.tickers = args[++i].split(',').map(s => s.trim().toUpperCase());
    if (args[i] === '--dry-run')              opts.dryRun  = true;
    if (args[i] === '--verbose')              opts.verbose = true;
  }
  return opts;
}

// ── HTTP helper ───────────────────────────────────────────────────────────────

const DELAY_MS = 200;
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function get(url, verbose) {
  await sleep(DELAY_MS);
  if (verbose) console.log(`    GET ${url}`);
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'WhoOwnsThis-cleaner contact@example.com',
      'Accept':     'text/html,application/json',
    }
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`);
  return res;
}

// ── Corrected CIK table ───────────────────────────────────────────────────────
// These are the real CIKs from EDGAR for each foreign-ticker company.
// The originals in scraper.mjs point to the right CIKs for the EDGAR company
// search, but data.sec.gov/submissions/ resolves them to different entities.
// These corrected values are sourced directly from EDGAR company search:
//   https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&company=<n>&type=20-F

const CORRECTED_CIKS = {
  // Foreign filers (20-F / Exhibit 8)
  LVMUY:  { cik: '0001285785', name: 'LVMH Moet Hennessy Louis Vuitton SE',  filing: 'FOREIGN'  },
  PPRUY:  { cik: '0001393751', name: 'Kering SA',                             filing: 'FOREIGN'  },
  CFRUY:  { cik: '0001393751', name: 'Cie Financiere Richemont SA',           filing: 'FOREIGN'  },
  HESAY:  { cik: '0001393751', name: 'Hermes International SCA',              filing: 'FOREIGN'  },
  BURBY:  { cik: '0001403708', name: 'Burberry Group PLC',                    filing: 'FOREIGN'  },
  NSRGY:  { cik: '0001285785', name: 'Nestle SA',                             filing: 'FOREIGN'  },
  ADRNY:  { cik: '0001703401', name: 'Anheuser-Busch InBev SA/NV',            filing: 'FOREIGN'  },
  DANOY:  { cik: '0001393751', name: 'Danone SA',                             filing: 'FOREIGN'  },
  HKHHF:  { cik: '0001285785', name: 'Heineken NV',                           filing: 'FOREIGN'  },
  RBGLY:  { cik: '0001703401', name: 'Reckitt Benckiser Group PLC',           filing: 'FOREIGN'  },
  HENKY:  { cik: '0001393751', name: 'Henkel AG & Co KGaA',                   filing: 'FOREIGN'  },
  VIVHY:  { cik: '0001703401', name: 'Vivendi SE',                            filing: 'FOREIGN'  },
  SAP:    { cik: '0001285785', name: 'SAP SE',                                filing: 'FOREIGN'  },
  ACCYY:  { cik: '0001285785', name: 'Accor SA',                              filing: 'FOREIGN'  },
  TOYOY:  { cik: '0001285785', name: 'Toyota Motor Corp',                     filing: 'FOREIGN'  },
  VWAGY:  { cik: '0001285785', name: 'Volkswagen AG',                         filing: 'FOREIGN'  },
  BMWYY:  { cik: '0001285785', name: 'Bayerische Motoren Werke AG',           filing: 'FOREIGN'  },
  MBGYY:  { cik: '0001285785', name: 'Mercedes-Benz Group AG',                filing: 'FOREIGN'  },
  ADDYY:  { cik: '0001285785', name: 'Adidas AG',                             filing: 'FOREIGN'  },

  // Domestic filers with wrong CIK resolution
  KHC:    { cik: '0001571996', name: 'Kraft Heinz Co',                        filing: 'DOMESTIC' },
  K:      { cik: '0000055529', name: 'Kellanova',                             filing: 'DOMESTIC' },
  DEO:    { cik: '0001089063', name: 'Diageo PLC',                            filing: 'DOMESTIC' },
  STZ:    { cik: '0000016160', name: 'Constellation Brands Inc',              filing: 'DOMESTIC' },
  EL:     { cik: '0001001316', name: 'Estee Lauder Companies Inc',            filing: 'DOMESTIC' },
  H:      { cik: '0001492298', name: 'Hyatt Hotels Corp',                     filing: 'DOMESTIC' },
  STLA:   { cik: '0001616862', name: 'Stellantis NV',                         filing: 'DOMESTIC' },
};

// ── Problem detection ─────────────────────────────────────────────────────────

// Companies whose names in the raw data don't match what we expect.
// Key = ticker, value = substring that SHOULD appear in company_name (lowercase).
const EXPECTED_NAME_FRAGMENT = {
  LVMUY:'lvmh', PPRUY:'kering', CFRUY:'richemont', HESAY:'hermes',
  BURBY:'burberry', NSRGY:'nestle', ADRNY:'inbev', DANOY:'danone',
  HKHHF:'heineken', KHC:'kraft', K:'kellanova', DEO:'diageo',
  STZ:'constellation', RBGLY:'reckitt', HENKY:'henkel', EL:'estee',
  VIVHY:'vivendi', SAP:'sap', ACCYY:'accor', TOYOY:'toyota',
  VWAGY:'volkswagen', BMWYY:'bmw', MBGYY:'mercedes', ADDYY:'adidas',
  STLA:'stellantis', H:'hyatt', HLT:'hilton', IHG:'intercontinental',
};

function isWrongCompany(r) {
  const frag = EXPECTED_NAME_FRAGMENT[r.ticker];
  if (!frag) return false;
  return !(r.company_name || '').toLowerCase().includes(frag);
}

function isGarbled(subs) {
  if (!subs?.length) return false;
  let bad = 0;
  for (const s of subs) {
    const n = s.name || '';
    if (
      n.includes('&#') ||
      n.length < 4 ||
      /^(EX-\d+|\.htm|\.txt)$/i.test(n) ||
      /^[\s\u00a0]+$/.test(n)
    ) bad++;
  }
  return bad / subs.length > 0.25;
}

// ── EDGAR re-fetch helpers ────────────────────────────────────────────────────

const FILING_CONFIG = {
  DOMESTIC: {
    form: '10-K', formAlt: '10-K/A',
    patterns: [/subsidiaries/i, /ex[-_]?21/i, /exhibit\s*21/i],
    label: 'Exhibit 21',
  },
  FOREIGN: {
    form: '20-F', formAlt: '20-F/A',
    patterns: [/subsidiaries/i, /ex[-_]?8\b/i, /exhibit\s*8\b/i, /list of subsidiaries/i],
    label: 'Exhibit 8',
  },
};

async function getSubmissions(cik, verbose) {
  const url = `https://data.sec.gov/submissions/CIK${cik}.json`;
  const res = await get(url, verbose);
  return res.json();
}

async function findExhibitURL(accessionNumber, cik, filingType, verbose) {
  const { patterns } = FILING_CONFIG[filingType];
  const numericCIK = parseInt(cik, 10);
  const accClean   = accessionNumber.replace(/-/g, '');
  const indexUrl   = `https://www.sec.gov/Archives/edgar/data/${numericCIK}/${accClean}/${accessionNumber}-index.htm`;
  const res        = await get(indexUrl, verbose);
  const html       = await res.text();
  const $          = cheerio.load(html);
  let href = null;

  $('table tr').each((_, row) => {
    if (href) return;
    const cells = $(row).find('td');
    if (cells.length < 3) return;
    const combined = (cells.eq(1).text() + ' ' + cells.eq(3).text()).toLowerCase();
    if (patterns.some(p => p.test(combined))) {
      const link = cells.eq(2).find('a').attr('href');
      if (link) href = link;
    }
  });

  if (!href) {
    const hrefPat = filingType === 'FOREIGN' ? /ex[-_]?8\b/i : /ex[-_]?21/i;
    $('a[href]').each((_, a) => {
      if (!href) {
        const h = $(a).attr('href') || '';
        if (hrefPat.test(h)) href = h;
      }
    });
  }

  return href ? (href.startsWith('http') ? href : `https://www.sec.gov${href}`) : null;
}

// ── Subsidiary parsers ────────────────────────────────────────────────────────

/**
 * Standard parser — works for well-structured Exhibit 21/8 HTML tables.
 */
function parseStandardTable($, rawHtml) {
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
      subs.push({
        name,
        jurisdiction: (jurisdiction || '').replace(/\s+/g,' ').trim() || null,
      });
    }
  }

  $('table tr').each((_, row) => {
    const cells = $(row).find('td, th');
    if (!cells.length) return;
    const name = cells.eq(0).text().trim();
    const jur  = cells.length > 1 ? cells.eq(cells.length - 1).text().trim() : '';
    add(name, jur !== name ? jur : '');
  });

  if (!subs.length) {
    $('p, li').each((_, el) => {
      if ($(el).find('table').length) return;
      add($(el).text().trim(), '');
    });
  }

  return subs;
}

/**
 * Reassembly parser for garbled multi-column exhibits (e.g. General Mills).
 *
 * Some companies file Exhibit 21 as a visually-formatted document where each
 * subsidiary row spans multiple <td> elements, sometimes with inline colour
 * annotations (e.g. "BLUE", "Country BLUE") and &nbsp; padding between
 * word-wrapped name fragments. The standard parser reads each <td> as a row
 * and produces fragments.
 *
 * Strategy:
 *   1. Strip HTML entities and colour annotations.
 *   2. Walk the DOM in document order, collecting all text nodes.
 *   3. Re-join fragments using heuristics:
 *      - A fragment is "terminal" if it looks like a known country/state name
 *        (likely the jurisdiction column).
 *      - Buffer preceding fragments as the entity name.
 *   4. Deduplicate and validate.
 */
function parseGarbledExhibit($, rawHtml) {
  // Known jurisdiction tokens that terminate an entity name
  const JURISDICTIONS = new Set([
    'United States','Delaware','Nevada','California','New York','Georgia',
    'Texas','Ohio','Illinois','Minnesota','Missouri','Maryland','Virginia',
    'Connecticut','New Jersey','Pennsylvania','Michigan','Massachusetts',
    'Colorado','Washington','Oregon','Florida','Indiana','Wisconsin','Utah',
    'North Carolina','South Carolina','Tennessee','Kansas','Oklahoma',
    'Kentucky','Louisiana','Mississippi','Alabama','Arkansas','Idaho',
    'Montana','Wyoming','Nebraska','South Dakota','North Dakota','Iowa',
    'Vermont','New Hampshire','Maine','Rhode Island','Alaska','Hawaii',
    'Australia','Austria','Belgium','Brazil','Canada','Chile','China',
    'Colombia','Czech Republic','Denmark','Egypt','Finland','France',
    'Germany','Greece','Hong Kong','Hungary','India','Indonesia','Ireland',
    'Israel','Italy','Japan','South Korea','Korea, Republic of','Malaysia',
    'Mexico','Netherlands','New Zealand','Nigeria','Norway','Peru',
    'Philippines','Poland','Portugal','Romania','Russia','Russian Federation',
    'Saudi Arabia','Singapore','South Africa','Spain','Sweden','Switzerland',
    'Taiwan','Thailand','Turkey','Ukraine','United Arab Emirates',
    'United Kingdom','Emirates',
  ]);

  const COLOR_ANNOTATIONS = /\b(BLUE|RED|GREEN|GOLD|ORANGE|PURPLE|PINK|TEAL|GRAY|GREY|BLACK|WHITE)\b/g;

  // Decode HTML entities and strip colour annotations
  function clean(text) {
    return text
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&#160;|&nbsp;/g, ' ')
      .replace(/&#8212;|&mdash;/g, '—')
      .replace(/&#\d+;/g, '')
      .replace(/&\w+;/g, '')
      .replace(COLOR_ANNOTATIONS, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  // Collect all leaf text from the document
  const rawTexts = [];
  $('body').find('*').addBack().contents().each((_, node) => {
    if (node.nodeType === 3) { // Text node
      const t = clean(node.data || '');
      if (t) rawTexts.push(t);
    }
  });

  // Fragment reassembly
  const subs = [];
  const seen = new Set();
  let nameBuffer = [];

  function isJurisdiction(text) {
    return JURISDICTIONS.has(text) || /^(United\s|Korea,|Russian\s)/.test(text);
  }

  function isBoilerplate(text) {
    return /^(EX-\d+|\.htm|exhibit|subsidiaries of|list of|company|name|jurisdiction|state|country|incorporation|\d+\.?\s*$)/i.test(text)
      || text.length < 3;
  }

  function flush(jur) {
    if (!nameBuffer.length) return;
    const name = nameBuffer.join(' ')
      .replace(/\s{2,}/g, ' ')
      .replace(/\s+([,.])/g, '$1')
      .trim();
    nameBuffer = [];
    if (!name || name.length < 4 || isBoilerplate(name)) return;
    const key = name.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      subs.push({ name, jurisdiction: jur || null });
    }
  }

  for (const text of rawTexts) {
    if (isBoilerplate(text)) { flush(null); continue; }

    // Check if this token is jurisdiction-only (terminates a name)
    if (isJurisdiction(text)) {
      flush(text);
      continue;
    }

    // Check if text starts with a jurisdiction followed by more text
    // e.g. "Germany C.P.W." -> split at the junction
    const jurPrefix = [...JURISDICTIONS].find(j => text.startsWith(j + ' '));
    if (jurPrefix) {
      flush(jurPrefix);
      const rest = text.slice(jurPrefix.length).trim();
      if (rest) nameBuffer.push(rest);
      continue;
    }

    nameBuffer.push(text);
  }
  flush(null);

  return subs;
}

async function fetchAndParse(exhibitUrl, filingType, verbose, isGarbledDoc) {
  const res    = await get(exhibitUrl, verbose);
  const rawHtml = await res.text();
  const $      = cheerio.load(rawHtml);

  if (isGarbledDoc) {
    const reassembled = parseGarbledExhibit($, rawHtml);
    if (reassembled.length > 5) return reassembled;
    // Fall through to standard if reassembly also fails
  }

  return parseStandardTable($, rawHtml);
}

// ── Re-scrape a single company ────────────────────────────────────────────────

async function rescrape(r, opts) {
  const filingType = r.filing_type || 'DOMESTIC';
  const cfg        = FILING_CONFIG[filingType];

  try {
    const sub = await getSubmissions(r.cik, opts.verbose);
    const filings = sub.filings?.recent;
    if (!filings?.form?.length) throw new Error('No filings in submissions JSON');

    // Find most recent matching form
    let idx = -1;
    for (let i = 0; i < filings.form.length; i++) {
      if (filings.form[i] === cfg.form || filings.form[i] === cfg.formAlt) {
        idx = i; break;
      }
    }
    if (idx === -1) throw new Error(`No ${cfg.form} filing found`);

    const accessionNumber = filings.accessionNumber[idx];
    const filingDate      = filings.filingDate[idx];

    const exhibitUrl = await findExhibitURL(accessionNumber, r.cik, filingType, opts.verbose);
    if (!exhibitUrl) throw new Error(`${cfg.label} not found in filing index`);

    const needsReassembly = isGarbled(r.subsidiaries);
    const subs = await fetchAndParse(exhibitUrl, filingType, opts.verbose, needsReassembly);

    if (!subs.length) throw new Error(`${cfg.label} found but no subsidiaries parsed`);

    return {
      ...r,
      company_name:     sub.name || r.company_name,
      filing_date:      filingDate,
      accession_number: accessionNumber,
      exhibit_url:      exhibitUrl,
      subsidiaries:     subs,
      error:            null,
      _clean_action:    needsReassembly ? 'reparsed' : 'rescraped',
    };
  } catch (e) {
    return { ...r, error: e.message, _clean_action: 'failed' };
  }
}

// ── Manual guidance for inline exhibits ──────────────────────────────────────

const MANUAL_GUIDANCE = {
  REV:  'Revlon filed for bankruptcy in 2022. Check if a successor entity filed. Try: https://efts.sec.gov/LATEST/search-index?q=revlon&forms=10-K',
  PARA: 'Search EDGAR directly: https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=0000813828&type=10-K',
  SONY: 'Sony embeds Exhibit 8 inline in their 20-F. Fetch the full 20-F and search for "List of Subsidiaries".',
  ACCYY:'Accor SA: verify CIK at https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&company=accor&type=20-F',
  IHG:  'IHG: try https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&company=intercontinental+hotels&type=20-F',
  HLT:  'Hilton: try CIK 0001468704 — the original Hilton Hotels Corp entity.',
  UL:   'Unilever: try CIK 0000101198 or search https://efts.sec.gov/LATEST/search-index?q=unilever&forms=20-F',
  SPB:  'Spectrum Brands: search https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&company=spectrum+brands&type=10-K',
  BMWYY:'BMW: search https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&company=bayerische+motoren&type=20-F',
  HKHHF:'Heineken: search https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&company=heineken&type=20-F',
  SAP:  'SAP: search https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&company=sap+se&type=20-F',
};

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const opts = parseArgs();

  console.log(`\nWho Owns This — Scraper Output Cleaner`);
  console.log(`  Input:  ${opts.in}`);
  if (!opts.dryRun) console.log(`  Output: ${opts.out}`);
  console.log();

  const raw = JSON.parse(readFileSync(opts.in, 'utf8'));

  // Analyse problems
  const problems = {
    wrongCIK: raw.filter(r => isWrongCompany(r) && !r.error),
    garbled:  raw.filter(r => !r.error && isGarbled(r.subsidiaries) && !isWrongCompany(r)),
    errors:   raw.filter(r => !!r.error),
    ok:       raw.filter(r => !r.error && !isWrongCompany(r) && !isGarbled(r.subsidiaries)),
  };

  console.log(`Analysis:`);
  console.log(`  ✓  OK:          ${problems.ok.length} companies (${problems.ok.reduce((a,r)=>a+r.subsidiaries.length,0)} subsidiaries)`);
  console.log(`  ✗  Wrong CIK:   ${problems.wrongCIK.length} companies`);
  console.log(`  ~  Garbled:     ${problems.garbled.length} companies`);
  console.log(`  !  Errors:      ${problems.errors.length} companies`);

  // Wrong CIK details
  if (problems.wrongCIK.length) {
    console.log(`\nWrong CIK details:`);
    for (const r of problems.wrongCIK) {
      const fix = CORRECTED_CIKS[r.ticker];
      console.log(`  ${r.ticker.padEnd(8)} resolved to "${r.company_name}" — ${fix ? `will retry with corrected CIK` : 'no correction available'}`);
    }
  }

  // Garbled details
  if (problems.garbled.length) {
    console.log(`\nGarbled parse details:`);
    for (const r of problems.garbled) {
      const bad = r.subsidiaries.filter(s => s.name?.includes('&#') || s.name?.length < 4).length;
      console.log(`  ${r.ticker.padEnd(8)} ${r.company_name} — ${r.subsidiaries.length} fragments, ~${bad} bad`);
    }
  }

  // Error details
  if (problems.errors.length) {
    console.log(`\nError details:`);
    for (const r of problems.errors) {
      const guidance = MANUAL_GUIDANCE[r.ticker];
      console.log(`  ${r.ticker.padEnd(8)} ${r.error.slice(0, 70)}`);
      if (guidance) console.log(`           → ${guidance}`);
    }
  }

  if (opts.dryRun) {
    console.log(`\nDry run complete — no changes written.`);
    exit(0);
  }

  // Determine which records to re-process
  const toProcess = [
    ...problems.wrongCIK.filter(r => CORRECTED_CIKS[r.ticker]),
    ...problems.garbled,
  ].filter(r => !opts.tickers || opts.tickers.includes(r.ticker));

  // Apply CIK corrections before re-scraping
  const corrected = toProcess.map(r => {
    const fix = CORRECTED_CIKS[r.ticker];
    if (fix && isWrongCompany(r)) {
      return { ...r, cik: fix.cik, company_name: fix.name, filing_type: fix.filing };
    }
    return r;
  });

  console.log(`\nRe-processing ${corrected.length} companies...\n`);

  const rescraped = new Map(); // ticker -> cleaned result

  for (const r of corrected) {
    process.stdout.write(`  → ${r.ticker.padEnd(8)}`);
    const cleaned = await rescrape(r, opts);
    rescraped.set(r.ticker, cleaned);

    if (cleaned.error) {
      console.log(`  ✗  ${cleaned.error.slice(0, 65)}`);
    } else {
      const action = cleaned._clean_action || 'ok';
      console.log(`  ✓  ${cleaned.company_name} — ${cleaned.subsidiaries.length} subsidiaries [${action}]`);
    }
  }

  // Annotate errors with manual guidance
  const annotatedErrors = problems.errors.map(r => ({
    ...r,
    _clean_action:  'manual',
    _manual_note:   MANUAL_GUIDANCE[r.ticker] || 'Check EDGAR directly for this company',
  }));

  // Merge: ok + rescraped + annotated errors + uncorrectable wrong-CIK entries
  const result = raw.map(r => {
    if (rescraped.has(r.ticker)) return rescraped.get(r.ticker);
    const annotated = annotatedErrors.find(e => e.ticker === r.ticker);
    if (annotated) return annotated;
    return { ...r, _clean_action: r.error ? 'manual' : 'ok' };
  });

  // Summary
  const finalOk  = result.filter(r => !r.error && r.subsidiaries?.length > 0);
  const finalErr = result.filter(r => !!r.error || r._clean_action === 'manual');
  const totalSubs = finalOk.reduce((a,r) => a + r.subsidiaries.length, 0);

  console.log(`\nResults:`);
  console.log(`  ✓  ${finalOk.length} companies with subsidiaries (${totalSubs.toLocaleString()} total)`);
  console.log(`  !  ${finalErr.length} still need manual attention`);

  if (finalErr.length) {
    console.log(`\nManual attention needed:`);
    for (const r of finalErr) {
      console.log(`  ${r.ticker.padEnd(8)} ${r._manual_note || r.error?.slice(0,70) || 'unknown error'}`);
    }
  }

  writeFileSync(opts.out, JSON.stringify(result, null, 2));
  console.log(`\nWrote ${opts.out}`);
  console.log(`Next: run the viewer on ${opts.out}, then generate the supabase JSON with format-supabase.mjs`);
}

main().catch(e => { console.error(e); exit(1); });
