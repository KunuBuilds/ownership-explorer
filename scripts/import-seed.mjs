// scripts/import-seed.mjs
import { readFileSync } from 'fs';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  'https://hwjizsosgdxufdqickub.supabase.co',   // ← paste your Supabase URL
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imh3aml6c29zZ2R4dWZkcWlja3ViIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NTI0NTgzNCwiZXhwIjoyMDkwODIxODM0fQ.RC53tpw1u9t6Ppd-LUo-tJd5QvmtZdXGGoc73sNEmHE'                                  // ← paste your service role key
);

const data = JSON.parse(readFileSync('./scripts/seed-supabase.json', 'utf8'));
console.log(`Importing ${data.entities.length} entities, ${data.ownership.length} edges, ${data.sources.length} sources...`);

// ── Entities: id is the slug itself ──────────────────────────────────────
const entityRows = data.entities.map(e => ({
  id:           e.slug,
  name:         e.name,
  type:         e.type,
  cik:          e.cik || null,
  ticker:       e.ticker || null,
  jurisdiction: e.jurisdiction || null,
}));

const { error: e1 } = await supabase
  .from('entities')
  .upsert(entityRows, { onConflict: 'id' });
if (e1) { console.error('entities:', e1); process.exit(1); }
console.log(`✓ ${entityRows.length} entities upserted`);

// ── Sources: dedupe by id before upserting ───────────────────────────────
const sourceMap = new Map();
for (const s of data.sources) sourceMap.set(s.id, s);
const sourceRows = [...sourceMap.values()];

const { error: e2 } = await supabase
  .from('sources')
  .upsert(sourceRows, { onConflict: 'id' });
if (e2) { console.error('sources:', e2); process.exit(1); }
console.log(`✓ ${sourceRows.length} sources upserted (${data.sources.length - sourceRows.length} duplicates removed)`);

// ── Ownership: parent_id/child_id are the slugs directly ────────────────
const edgeMap = new Map();
for (const o of data.ownership) {
  const edge = {
    parent_id:        o.parent_slug,
    child_id:         o.child_slug,
    ownership_pct:    o.ownership_pct,
    acquisition_date: o.acquisition_date,
    source_id:        o.source_id,
    notes:            o.notes,
  };
  edgeMap.set(`${edge.parent_id}-${edge.child_id}`, edge);
}
const dedupedEdges = [...edgeMap.values()];

// Batch to avoid request size limits
const BATCH_SIZE = 1000;
let inserted = 0;
for (let i = 0; i < dedupedEdges.length; i += BATCH_SIZE) {
  const batch = dedupedEdges.slice(i, i + BATCH_SIZE);
  const { error } = await supabase
    .from('ownership')
    .upsert(batch, { onConflict: 'parent_id,child_id' });
  if (error) { console.error(`ownership batch ${i}:`, error); process.exit(1); }
  inserted += batch.length;
  process.stdout.write(`\r  ownership: ${inserted}/${dedupedEdges.length} edges`);
}
console.log(`\n✓ ${inserted} ownership edges upserted (${data.ownership.length - dedupedEdges.length} duplicates removed)`);

console.log('\nDone.');