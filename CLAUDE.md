# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with this repository.

## Commands

```bash
npm run dev       # Start dev server at localhost:3000
npm run build     # Production build
npm run lint      # ESLint via Next.js
```

There are no automated tests. TypeScript checking runs as part of `next build`.

## Environment

Copy `.env.example` to `.env.local` and fill in:

```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=   # public, used client-side
SUPABASE_SECRET_KEY=              # service role key — only used in admin API routes
ADMIN_PASSWORD=                   # shared secret for the /admin/* UI
```

## Architecture

**Next.js 14 App Router** app deployed on Vercel. Supabase is the only external dependency — it is both the database and the auth layer.

### Data layer (`lib/`)

- `lib/supabase.ts` — single Supabase client instance + all TypeScript types for the DB schema
- `lib/data.ts` — **all DB queries live here**. Server components and API routes import from this file only; nothing else calls Supabase directly. Functions prefixed `get*` run at build time for SSG.
- `lib/graph.ts` — pure, side-effect-free functions for traversing the ownership graph (no DB calls). Works on both server and client.

### Database schema

Six tables in Supabase (see `supabase/schema.sql`):

- `entities` — every company, brand, subsidiary, or product; `type` is one of `conglomerate | subsidiary | brand | product`
- `ownership` — directed edge list (parent→child). `divested_date IS NULL` means currently owned. `share_pct NULL` means assumed 100%.
- `categories` — three-level self-referential taxonomy (level 1=sector, 2=category, 3=subcategory)
- `entity_categories` — many-to-many; includes `is_primary` flag
- `sources` + `ownership_sources` — citation tracking per ownership edge

Row Level Security is enabled on all tables: public reads, authenticated-only writes. Admin API routes bypass RLS by using `SUPABASE_SECRET_KEY` (service role).

### Admin authentication

All `/admin/*` pages use a client-side password gate that stores the password in `sessionStorage`. The password is sent as `x-admin-password` header to all `/api/admin/*` routes. There is no Supabase auth — it's a single shared `ADMIN_PASSWORD` env var.

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

IDs are URL-safe slugs derived from the entity name: lowercase, spaces/punctuation replaced with `-`. If a slug collides, a 6-character UUID suffix is appended. Keep this convention when inserting entities manually.

### Category inheritance

Categories support inheritance: a child entity inherits its parent's categories unless it has explicit assignments. The DB has a `entity_effective_categories(target_entity_id)` RPC function that resolves inherited categories. The admin UI distinguishes between explicit assignments (editable) and inherited ones (read-only hints).
