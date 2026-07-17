// scripts/test-alternatives-gen.mjs
//
// Exercises generate_alternative_candidates() for ONE category, then prints the
// top 20 pending candidates by score. The RPC does the writing (status='pending'
// only, idempotent via the unique pair index) — this script only calls it and reads.
//
// Usage:
//   node scripts/test-alternatives-gen.mjs --category food-alcoholic-beverages

import { serviceClient } from './_supabase.mjs'

function parseArgs() {
  const a = { category: null }
  for (let i = 2; i < process.argv.length; i++) {
    const f = process.argv[i]
    if (f === '--category') a.category = process.argv[++i]
    else if (f === '--help' || f === '-h') {
      console.log('node scripts/test-alternatives-gen.mjs --category <category_id>')
      process.exit(0)
    }
  }
  if (!a.category) { console.error('ERROR: --category <category_id> is required.'); process.exit(1) }
  return a
}

async function main() {
  const args = parseArgs()
  const sb = serviceClient()

  console.log(`Running generate_alternative_candidates(target_category => '${args.category}') ...`)
  const { data: summary, error } = await sb.rpc('generate_alternative_candidates', { target_category: args.category })
  if (error) { console.error('RPC error:', error.message); process.exit(1) }
  console.log('Summary:', JSON.stringify(summary))

  // Top 20 pending by score (deterministic tiebreak on id). Names via FK embeds.
  const { data: rows, error: rerr } = await sb
    .from('alternatives')
    .select('id, score, generated_reason, b:entities!alternatives_entity_id_fkey(name), a:entities!alternatives_alternative_id_fkey(name)')
    .eq('status', 'pending')
    .order('score', { ascending: false })
    .order('id', { ascending: true })
    .range(0, 19)
  if (rerr) { console.error('read error:', rerr.message); process.exit(1) }

  console.log(`\nTop ${rows?.length ?? 0} pending candidates by score:\n`)
  console.log(`${'brand'.padEnd(30)} ${'alternative'.padEnd(30)} ${'score'.padStart(6)}  reason`)
  console.log('-'.repeat(96))
  for (const r of rows ?? []) {
    const brand = (r.b?.name ?? '(?)').slice(0, 29).padEnd(30)
    const alt = (r.a?.name ?? '(?)').slice(0, 29).padEnd(30)
    console.log(`${brand} ${alt} ${String(r.score).padStart(6)}  ${r.generated_reason ?? ''}`)
  }
}

main().catch(e => { console.error(e); process.exit(1) })
