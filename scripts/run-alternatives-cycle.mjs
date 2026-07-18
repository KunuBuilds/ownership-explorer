// scripts/run-alternatives-cycle.mjs
//
// One weekly "staged alternatives" cycle, driven by .github/workflows/weekly-alternatives.yml:
//   1. generate_alternative_candidates() across all categories (capture inserted count)
//   2. if any inserted AND an Anthropic key is present, run enrich-alternatives.mjs --limit 200
//      (cost ceiling); kept/rejected are measured from DB deltas, not stdout
//   3. append a comment to the single rolling GitHub issue "Alternatives review queue"
//      (found by title / created if absent)
//
// Degradation: if enrichment fails (API error / missing key), still post the comment with
// generation counts + "enrichment skipped" and exit 0 — generation succeeded. Only a
// generation failure exits non-zero.
//
// Env: SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL), SUPABASE_SECRET_KEY, ANTHROPIC_API_KEY,
//      GITHUB_TOKEN + GITHUB_REPOSITORY (both auto-provided inside GitHub Actions).

import { spawn } from 'node:child_process'
import { serviceClient } from './_supabase.mjs'

const ISSUE_TITLE = 'Alternatives review queue'
const ADMIN_URL = 'https://ownership-explorer.vercel.app/admin/alternatives'
const ENRICH_LIMIT = 200

const sb = serviceClient()

async function count(build) {
  const { count, error } = await build(sb.from('alternatives').select('id', { count: 'exact', head: true }))
  if (error) throw error
  return count ?? 0
}

function runEnrich() {
  return new Promise(resolve => {
    const p = spawn(process.execPath, ['scripts/enrich-alternatives.mjs', '--limit', String(ENRICH_LIMIT)], {
      stdio: 'inherit', env: process.env,
    })
    p.on('close', code => resolve(code ?? 1))
    p.on('error', () => resolve(1))
  })
}

async function postIssueComment(body) {
  const repo = process.env.GITHUB_REPOSITORY
  const token = process.env.GITHUB_TOKEN
  if (!repo || !token) {
    console.log('No GITHUB_REPOSITORY/GITHUB_TOKEN — skipping issue post. Comment body:\n' + body)
    return
  }
  const [owner, name] = repo.split('/')
  const gh = (path, opts = {}) => fetch(`https://api.github.com${path}`, {
    ...opts,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'ownership-explorer-alternatives-bot',
      ...(opts.headers ?? {}),
    },
  })

  // Find the rolling issue by title among open issues (immediately consistent, unlike search).
  let number = null
  const listRes = await gh(`/repos/${owner}/${name}/issues?state=open&per_page=100`)
  if (listRes.ok) {
    const issues = await listRes.json()
    const hit = issues.find(i => i.title === ISSUE_TITLE && !i.pull_request)
    if (hit) number = hit.number
  }
  if (!number) {
    const createRes = await gh(`/repos/${owner}/${name}/issues`, {
      method: 'POST',
      body: JSON.stringify({ title: ISSUE_TITLE, body: 'Rolling log of the weekly alternative-candidate cycle. See comments below.' }),
    })
    if (!createRes.ok) throw new Error(`create issue failed: ${createRes.status} ${await createRes.text()}`)
    number = (await createRes.json()).number
  }
  const commentRes = await gh(`/repos/${owner}/${name}/issues/${number}/comments`, {
    method: 'POST', body: JSON.stringify({ body }),
  })
  if (!commentRes.ok) throw new Error(`comment failed: ${commentRes.status} ${await commentRes.text()}`)
  console.log(`Posted comment to issue #${number}.`)
}

async function main() {
  const date = new Date().toISOString().slice(0, 10)

  // ── 1. Generation (all categories) ──────────────────────────────────────
  const gen = await sb.rpc('generate_alternative_candidates', { target_category: null })
  if (gen.error) {
    console.error('Generation FAILED:', gen.error.message)
    process.exit(1) // only a generation failure is fatal
  }
  const inserted = Number(gen.data?.[0]?.pairs_inserted ?? 0)
  const brands = Number(gen.data?.[0]?.brands_processed ?? 0)
  console.log(`Generation: ${inserted} candidates inserted (${brands} brands scanned).`)

  // ── 2. Enrichment (bounded, best-effort) ────────────────────────────────
  let kept = 0, rejected = 0, enrichmentSkipped = false
  if (inserted > 0) {
    if (!process.env.ANTHROPIC_API_KEY) {
      enrichmentSkipped = true
      console.warn('Enrichment skipped: ANTHROPIC_API_KEY not set.')
    } else {
      const rej0 = await count(q => q.eq('status', 'rejected'))
      const keep0 = await count(q => q.eq('status', 'pending').eq('llm_verdict', 'keep'))
      const code = await runEnrich()
      const rej1 = await count(q => q.eq('status', 'rejected'))
      const keep1 = await count(q => q.eq('status', 'pending').eq('llm_verdict', 'keep'))
      kept = keep1 - keep0
      rejected = rej1 - rej0
      if (code !== 0) { enrichmentSkipped = true; console.warn(`Enrichment exited ${code} — treating as skipped.`) }
    }
  }

  // ── 3. Current pending total ────────────────────────────────────────────
  const pending = await count(q => q.eq('status', 'pending'))

  // ── 4. Comment body ─────────────────────────────────────────────────────
  let body
  if (inserted === 0) {
    // One-liner keeps the cron visibly alive (and the Supabase project warm).
    body = `**${date}** — no new candidates. ${pending} pending review. ${ADMIN_URL}`
  } else {
    const lines = [
      `### Weekly alternatives cycle — ${date}`,
      '',
      `- Candidates generated: **${inserted}** (${brands} brands scanned)`,
    ]
    if (enrichmentSkipped) lines.push('- Enrichment: ⚠️ skipped (API error)')
    else lines.push(`- Kept by Sonnet: **${kept}**`, `- Rejected by Sonnet: **${rejected}**`)
    lines.push(`- Pending review now: **${pending}**`, '', `Review: ${ADMIN_URL}`)
    body = lines.join('\n')
  }

  try {
    await postIssueComment(body)
  } catch (err) {
    // Posting is not the pass/fail criterion — log loudly, stay green.
    console.error('Issue comment failed:', err.message)
  }

  process.exit(0)
}

main().catch(err => { console.error(err); process.exit(1) })
