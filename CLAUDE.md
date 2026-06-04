# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with this repository.

## Commands

```bash
npm run dev       # Start dev server at localhost:3000
npm run build     # Production build
npm run lint      # ESLint via Next.js
```

There are no automated tests. TypeScript checking runs as part of `next build`.

> **In flight:** see `HANDOFF-entity-page-holdings.md` (repo root) for the current entity-page work — cascade categories, grouped/redesigned Holdings, brand-logo backfill. Check it before touching `app/entity/[id]/`.

## Environment

Copy `.env.example` to `.env.local` and fill in:

```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=   # public, used client-side
SUPABASE_SECRET_KEY=              # service role key — admin API routes + ingestion scripts only
ADMIN_PASSWORD=                   # shared secret for the /admin/* UI
```

Never expose `SUPABASE_SECRET_KEY` as a `NEXT_PUBLIC_` var. `.env.local` is gitignored — keep it that way.

## Architecture

**Next.js 14 App Router** app deployed on Vercel. Supabase is the only *runtime* external dependency
(it is both the database and the auth layer). Data-ingestion scripts additionally call SEC EDGAR,
Wikipedia, and Wikidata — see **Data ingestion**.

### Data layer (`lib/`)

- `lib/supabase.ts` — single Supabase client instance + all TypeScript types for the DB schema
- `lib/data.ts` — **all DB queries live here**. Server components and API routes import from this file only; nothing else calls Supabase directly. Functions prefixed `get*` run at build time for SSG.
- `lib/graph.ts` — pure, side-effect-free functions for traversing the ownership graph (no DB calls). Works on both server and client.

### Database schema

Tables in Supabase (see `supabase/schema.sql`):

- `entities` — every company, brand, subsidiary, legal entity, or product. `type` is one of
  `conglomerate | subsidiary | brand | product | legal-entity`. Legal entities are infrastructure
  (SEC Exhibit 21 filers) that sit *underneath* consumer brands.
  - **Note:** the `EntityType` union in `lib/supabase.ts` historically omitted `legal-entity`; make
    sure it includes all five before relying on exhaustive `type` switches/comparisons.
  - `entities.category` is a **legacy** single-string field, superseded by `entity_categories`.
    Prefer the cascade (below); the legacy field still appears on some surfaces and is being phased out.
- `ownership` — directed edge list (parent→child). `divested_date IS NULL` means currently owned.
  `share_pct NULL` means assumed 100%. The field is `share_pct` — **never** `ownership_percentage`.
- `categories` — three-level self-referential taxonomy (level 1=sector, 2=category, 3=subcategory)
- `entity_categories` — many-to-many entity↔category; includes `is_primary` flag
- `legal_entity_brands` — junction mapping legal entities to the consumer brands they roll up to
- `sources` + `ownership_sources` — citation tracking per ownership edge
- `alternatives` — related/alternative entities (directional flag)
- `submissions` — user-submitted corrections/suggestions surfaced in `/admin`

Row Level Security is enabled on all tables: public reads, authenticated-only writes. Admin API routes
bypass RLS by using `SUPABASE_SECRET_KEY` (service role).

### Admin authentication

All `/admin/*` pages use a client-side password gate that stores the password in `sessionStorage`. The
password is sent as `x-admin-password` header to all `/api/admin/*` routes. There is no Supabase auth —
it's a single shared `ADMIN_PASSWORD` env var. Admin pages render on a **forced light background**, not
the public dark theme.

### Rendering strategy

- **Home page (`/`)** — server component fetches full `GraphSnapshot` at request time, passes it to `<ExploreClient>` (client component with search/filter UI)
- **Entity pages (`/entity/[id]`)** — server-rendered with `generateStaticParams` pre-building a seed list; `dynamicParams = true` means all other IDs also SSR on first request
- **Categories (`/categories/[[...slug]]`)** — server component
- **Timeline (`/timeline`)** — server component passes `GraphSnapshot` to `<TimelineClient>`
- **Admin pages** — all `'use client'` components; they call `/api/admin/*` routes directly

### API routes

All admin writes go through `/api/admin/*` and require `x-admin-password`:

| Route | Purpose |
|---|---|
| `POST /api/admin/auth` | Validate the admin password |
| `GET/PATCH /api/admin` | List/update user submissions |
| `GET/POST /api/admin/add` | Create entities, link ownership edges; entity search autocomplete |
| `GET/POST /api/admin/entities` | Entity management (reparent, type changes) |
| `GET/POST /api/admin/actions` | Bulk entity operations |
| `GET/POST /api/admin/categorize` | Category assignment workflow |

### Entity ID convention

IDs are URL-safe slugs derived from the entity name: lowercase, spaces/punctuation replaced with `-`,
**accents/non-ASCII stripped to plain ASCII**. If a slug collides, a 6-character UUID suffix is
appended. Keep this convention when inserting entities manually.

### Category inheritance

A child entity inherits its parent's categories **unless it has any explicit assignment** — any explicit
category stops *all* ancestor inheritance (all-or-nothing per entity). Resolution lives in Postgres RPCs:

- `entity_effective_categories(target_entity_id)` — explicit + inherited for one entity
- `entities_in_category(category_id)` — cascade-aware membership
- `category_effective_counts()` — counts that walk both the ownership tree and the category tree
- `entity_descendants(id)` — ownership-tree descendants

The admin UI distinguishes explicit assignments (editable) from inherited ones (read-only hints).
Public surfaces are migrating from explicit-only queries to these cascade RPCs.

## Data ingestion

ESM scripts in the **repo root**, run with `node <script>.mjs` (Node 18+):

- `scraper.mjs` — SEC EDGAR Exhibit 21 / 20-F subsidiary lists → JSON
- `wiki-brands.mjs` — Wikipedia brand-portfolio lists → JSON (same shape as the EDGAR output)
- `fetch-logos.mjs` — backfills `entities.logo_url` from Wikidata P154 (keys off `wikidata_qid`)
- `import-seed.mjs` — ingests the JSON above into Supabase

Scripts that write to the DB use `SUPABASE_SECRET_KEY`. **Validate before importing:** ownership edges
where `parent_id === child_id` (self-loops) break the Vercel build. Supabase webhooks trigger Vercel
rebuilds on table changes, so a bad import can fail production.

## Gotchas

- **Supabase 1,000-row cap.** `getAllEntities()` / `getAllOwnership()` must paginate in a `while` loop
  with an `.order('id')` tiebreaker; a single un-paginated query silently truncates at 1,000 rows.
- **Recursive CTEs need the keyword.** Postgres requires `WITH RECURSIVE` explicitly — omitting it errors.
- **API ↔ frontend field names must match.** A `category_name` vs `name` mismatch previously crashed a
  `.localeCompare`. When changing an API response shape, update the TS interface in the same change.
- **No browser storage in artifacts** is irrelevant here, but note the admin gate uses `sessionStorage`.
- **Windows/PowerShell:** kill stuck Node with **Ctrl+Break** (Ctrl+C doesn't stop it); git writes
  warnings to stderr in red (not errors); a stray `$env:` var can shadow `.env.local` for that session.
