/**
 * format-supabase.mjs
 *
 * Converts a cleaned-raw.json (output of clean.mjs) into the three-array
 * Supabase-ready format used by import-seed.mjs.
 *
 * Usage:
 *   node format-supabase.mjs                             # cleaned-raw.json -> cleaned-supabase.json
 *   node format-supabase.mjs --in fixed.json             # custom input
 *   node format-supabase.mjs --out ready.json            # custom output
 *   node format-supabase.mjs --skip-errors               # omit companies that errored
 */

import { readFileSync, writeFileSync } from 'fs';
import { argv, exit } from 'process';

function parseArgs() {
  const args = argv.slice(2);
  const opts = { in: 'cleaned-raw.json', out: 'cleaned-supabase.json', skipErrors: false };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--in'          && args[i+1]) opts.in         = args[++i];
    if (args[i] === '--out'         && args[i+1]) opts.out        = args[++i];
    if (args[i] === '--skip-errors')              opts.skipErrors  = true;
  }
  return opts;
}

function slugify(str = '') {
  return str.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

const EXHIBIT_LABEL = { DOMESTIC: 'Exhibit 21', FOREIGN: 'Exhibit 8' };
const FORM_LABEL    = { DOMESTIC: '10-K',        FOREIGN: '20-F'      };
const SOURCE_PREFIX = { DOMESTIC: 'sec-ex21',    FOREIGN: 'sec-ex8'   };

function format(results, opts) {
  const entities  = [];
  const ownership = [];
  const sources   = [];
  const entitySet = new Set();

  for (const r of results) {
    if (r.error && opts.skipErrors) continue;
    if (!r.subsidiaries?.length) continue;

    const ft         = r.filing_type || 'DOMESTIC';
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

    const sourceId = `${SOURCE_PREFIX[ft]}-${r.accession_number}`;
    sources.push({
      id:               sourceId,
      title:            `${r.company_name} — ${EXHIBIT_LABEL[ft]}, ${FORM_LABEL[ft]} filed ${r.filing_date}`,
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

const opts    = parseArgs();
const results = JSON.parse(readFileSync(opts.in, 'utf8'));
const output  = format(results, opts);

console.log(`\nFormat summary:`);
console.log(`  Input:      ${results.length} companies`);
console.log(`  Entities:   ${output.entities.length}`);
console.log(`  Ownership:  ${output.ownership.length} edges`);
console.log(`  Sources:    ${output.sources.length}`);

const skipped = results.filter(r => r.error || !r.subsidiaries?.length);
if (skipped.length) {
  console.log(`  Skipped:    ${skipped.length} (errors or no subsidiaries)`);
  for (const r of skipped) {
    console.log(`    ${(r.ticker||'?').padEnd(8)} ${r.error ? '✗ error' : '~ no data'}`);
  }
}

writeFileSync(opts.out, JSON.stringify(output, null, 2));
console.log(`\nWrote ${opts.out}\n`);
