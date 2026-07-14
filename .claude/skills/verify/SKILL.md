---
name: verify
description: Build/launch/drive recipe for verifying changes to this Next.js + Supabase app at its runtime surface
---

# Verifying ownership-explorer changes

## Launch

- `npm run dev` in the background — ready in ~3s on `http://localhost:3000`.
- **Run it with the sandbox disabled**: the sandboxed shell blocks DNS, so Supabase fetches fail with `ENOTFOUND` and every page 500s. Same for any `Invoke-WebRequest`/REST probing.
- Routes 308-redirect to trailing slash (`/categories` → `/categories/`); fetch the slashed form directly.
- First request to a route compiles it (~10–15s) — use a generous timeout.
- Kill with `Get-Process node | Stop-Process -Force` (Ctrl+C doesn't stop Node on this box).

## Drive

- Public pages are server-rendered from a full `GraphSnapshot`; client components ('use client') still SSR their initial render, so counts/lists computed during render are observable in the raw HTML — extract with regex on the CSS-module class fragments (e.g. `l1Name` / `l1Count`).
- Deep-link state set in `useEffect` (e.g. `?cat=`) is client-only and NOT in SSR HTML; verifying it needs a real browser (claude-in-chrome extension, if connected).
- Cross-check rendered data against Supabase directly via PostgREST using the anon key from `.env.local`:
  - `POST {url}/rest/v1/rpc/category_effective_counts` (body `{}`) — cascade counts per category.
  - `POST {url}/rest/v1/rpc/entities_in_category` (body `{"target_category_id":"..."}`) — membership with `source: explicit|inherited`. **Capped at 1000 rows.**
  - Exact counts: add `&limit=1` plus header `Prefer: count=exact`, read `Content-Range`. (PS 5.1 forbids setting a `Range` header on Invoke-WebRequest — use the `limit` query param.)
- Watch the dev-server output file for runtime/hydration errors after each fetch.

## Gotchas

- `next build` can "pass" with Supabase unreachable by serving stale data from `.next/cache` — a green build is not evidence the DB is reachable.
- `npm run build` output is ~5MB (425 SSG pages); expect persisted-output truncation.
