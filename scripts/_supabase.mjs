// scripts/_supabase.mjs
//
// Shared helpers for the QID scripts:
//   - loadEnv()          reads .env.local into process.env (dotenv isn't installed here)
//   - serviceClient()    a service-role Supabase client (bypasses RLS)
//   - fetchAll()         paginated read of a table with a deterministic .order('id')
//
// Env resolution accepts SUPABASE_URL or NEXT_PUBLIC_SUPABASE_URL, plus SUPABASE_SECRET_KEY.

import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'

export const PAGE_SIZE = 1000

// Minimal .env parser: KEY=VALUE per line, strips quotes, ignores comments/blanks.
// Does not overwrite anything already present in process.env.
export function loadEnv(path = '.env.local') {
  let text
  try { text = readFileSync(path, 'utf8') } catch { return }
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq === -1) continue
    const key = line.slice(0, eq).trim()
    if (key in process.env && process.env[key]) continue
    let val = line.slice(eq + 1).trim()
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1)
    }
    process.env[key] = val
  }
}

export function serviceClient() {
  loadEnv()
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SECRET_KEY
  if (!url || !key) {
    console.error('ERROR: need SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL) and SUPABASE_SECRET_KEY.')
    console.error('Set them in .env.local or export them in your shell.')
    process.exit(1)
  }
  return createClient(url, key, { auth: { persistSession: false } })
}

// Paginated read: walks the whole table 1000 rows at a time, ordered by id so
// pages don't overlap or skip. `build` receives the base query for extra filters.
export async function fetchAll(supabase, table, columns, build = q => q) {
  const out = []
  let from = 0
  for (;;) {
    const { data, error } = await build(
      supabase.from(table).select(columns)
    ).order('id').range(from, from + PAGE_SIZE - 1)
    if (error) throw error
    if (!data || data.length === 0) break
    out.push(...data)
    if (data.length < PAGE_SIZE) break
    from += PAGE_SIZE
  }
  return out
}
