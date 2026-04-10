import { createClient } from '@supabase/supabase-js'

// These environment variables are set in Vercel dashboard and .env.local
const supabaseUrl  = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseAnon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

// Single client instance for the whole app
export const supabase = createClient(supabaseUrl, supabaseAnon)

// ── Types matching the database schema ───────────────────────────────────────

export type EntityType = 'conglomerate' | 'subsidiary' | 'brand' | 'product'
export type SourceType = 'primary' | 'secondary' | 'filing'

export interface Entity {
  id:           string
  name:         string
  type:         EntityType
  category:     string | null
  hq_country:   string | null
  founded_date: string | null
  flags:        string[]
}

export interface Ownership {
  id:                    number
  parent_id:             string
  child_id:              string
  share_pct:             number | null
  region:                string | null
  acquired_date:         string | null
  divested_date:         string | null
  acquisition_price_usd: number | null
  flags:                 string[]
}

export interface Source {
  id:             string
  title:          string
  publisher:      string | null
  url:            string | null
  published_date: string | null
  source_type:    SourceType | null
}

export interface OwnershipSource {
  ownership_id: number
  source_id:    string
  note:         string | null
}

export interface Category {
  id:          string
  name:        string
  parent_id:   string | null
  level:       1 | 2 | 3
  icon:        string | null
  description: string | null
  sort_order:  number
}
