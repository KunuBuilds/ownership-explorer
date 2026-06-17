# Handoff — Public entity page: cascade categories + redesigned grouped Holdings + brand logos

Task spec for Claude Code. Apply against the `ownership-explorer` repo. Work was designed in a
Claude.ai planning session; this file is the source of truth for the implementation.

## Goal

On the public entity page (`app/entity/[id]/page.tsx`) and supporting lib/CSS:

1. Use the category **cascade** (effective categories) instead of explicit-only.
2. Replace the flat Holdings grid with **type-grouped** holdings (Brands first), redesigned cards.
3. **Roll up** brands that sit under direct subsidiary/legal-entity children into the Brands group,
   annotated `via <owner>`.
4. **Sort** within each group by **effective primary category**.
5. **Cap** the Legal Entities group (client-side "show more").
6. Add a **logo** (or monogram fallback) to each card; populate `logo_url` from Wikidata P154.

## Prerequisites (do these first)

1. Add the column (if it does not already exist):
   ```sql
   alter table entities add column logo_url text;
   ```
   Add `logo_url: string | null` to the `Entity` interface in `lib/supabase.ts`.

2. Verify Wikidata coverage (the logo script keys off `wikidata_qid`):
   ```sql
   select column_name from information_schema.columns
   where table_name = 'entities' and column_name = 'wikidata_qid';

   select count(*) as total, count(wikidata_qid) as with_qid from entities;
   ```
   If `with_qid` is low or the column is absent, logos will be sparse — that's expected; the monogram
   fallback covers it. (Optional later path: name-based Wikidata matching to backfill both
   `wikidata_qid` and `logo_url`.)

## Change 1 — `lib/data.ts`

Add a convenience wrapper and a batch primary-category fetch; switch `getEntityPageData` to the cascade.

```ts
// Returns just the effective (explicit + inherited) category IDs.
export async function getEffectiveCategoryIds(entityId: string): Promise<string[]> {
  const cats = await getEffectiveCategories(entityId)
  return cats.map(c => c.category_id)
}

// Effective PRIMARY category per entity as { id, name }. Prefers explicit primary,
// then any primary, then any explicit, then first effective. One rpc per id.
export async function getEffectivePrimaryCategoryBatch(
  entityIds: string[]
): Promise<Map<string, { id: string; name: string }>> {
  if (entityIds.length === 0) return new Map()
  const cats = await getAllCategories()
  const nameById = new Map(cats.map(c => [c.id, c.name]))
  const results = await Promise.all(
    entityIds.map(async id => {
      const { data } = await supabase.rpc('entity_effective_categories', { target_entity_id: id })
      const rows = (data ?? []) as EffectiveCategory[]
      const pick =
        rows.find(r => r.is_primary && r.source === 'explicit') ??
        rows.find(r => r.is_primary) ??
        rows.find(r => r.source === 'explicit') ??
        rows[0]
      return { id, pick }
    })
  )
  const map = new Map<string, { id: string; name: string }>()
  for (const { id, pick } of results) {
    if (pick) map.set(id, { id: pick.category_id, name: nameById.get(pick.category_id) ?? pick.category_id })
  }
  return map
}
```

Update `EntityPageData` + `getEntityPageData`:

```ts
export interface EntityPageData {
  entity:       Entity
  children:     (Ownership & { entity: Entity })[]
  parents:      (Ownership & { entity: Entity })[]
  sources:      { source: Source; ownershipId: number; note: string | null }[]
  categories:   string[]
  categoryMeta: EffectiveCategory[]
  alternatives: { alternative: Entity; reason: string | null; directional: boolean }[]
}

export async function getEntityPageData(id: string): Promise<EntityPageData | null> {
  const [entity, children, parents, sources, categoryMeta, alternatives] = await Promise.all([
    getEntity(id), getChildren(id), getParents(id), getEntitySources(id),
    getEffectiveCategories(id), getAlternatives(id),
  ])
  if (!entity) return null
  return {
    entity, children, parents, sources,
    categories: categoryMeta.map(c => c.category_id),
    categoryMeta, alternatives,
  }
}
```

## Change 2 — NEW file `app/entity/[id]/HoldingsGroup.tsx`

```tsx
'use client'

import { useState } from 'react'
import Link from 'next/link'
import styles from './EntityPage.module.css'

export type HoldingItem = {
  id: string
  name: string
  type: string
  category: string | null
  share_pct: number | null
  region: string | null
  acquired_year: string | null
  via: { id: string; name: string } | null
  logo_url: string | null
}

export default function HoldingsGroup({
  label, items, cap,
}: { label: string; items: HoldingItem[]; cap?: number }) {
  const [expanded, setExpanded] = useState(false)
  const showAll = !cap || expanded || items.length <= cap
  const visible = showAll ? items : items.slice(0, cap)
  const hidden = items.length - visible.length

  return (
    <div className={styles.hGroup}>
      <div className={styles.hGroupLabel}>
        <span>{label}</span>
        <span className={styles.hGroupCount}>{items.length}</span>
      </div>
      <div className={styles.hGrid}>
        {visible.map(it => {
          const partial = (it.share_pct ?? 100) < 100
          return (
            <Link
              key={it.id}
              href={`/entity/${it.id}`}
              className={`${styles.hCard} ${styles['hType-' + it.type] ?? ''}`}
            >
              <div className={styles.hCardHead}>
                {it.logo_url
                  ? <img className={styles.hLogo} src={it.logo_url} alt="" loading="lazy" />
                  : <span className={styles.hLogoFallback} aria-hidden="true">{it.name.charAt(0).toUpperCase()}</span>}
                <div className={styles.hName}>{it.name}</div>
              </div>
              <div className={styles.hMeta}>
                {partial && (
                  <span className={`${styles.hBadge} ${styles.hBadgePartial}`}>{it.share_pct ?? 100}%</span>
                )}
                {it.category && <span className={styles.hBadge}>{it.category}</span>}
                {it.via && <span className={`${styles.hBadge} ${styles.hVia}`}>via {it.via.name}</span>}
                {it.region && <span className={styles.hBadge}>{it.region}</span>}
                {it.acquired_year && <span className={styles.hBadge}>{it.acquired_year}</span>}
              </div>
            </Link>
          )
        })}
      </div>
      {hidden > 0 && (
        <button className={styles.hShowMore} onClick={() => setExpanded(true)}>
          Show {hidden} more
        </button>
      )}
    </div>
  )
}
```

## Change 3 — `app/entity/[id]/page.tsx`

Import:
```tsx
import HoldingsGroup, { HoldingItem } from './HoldingsGroup'
import { /* existing */ getEffectivePrimaryCategoryBatch } from '@/lib/data'
```
(`childrenOf` is already imported from `@/lib/graph`.)

Destructure `categoryMeta` from `data` (the hero already uses it — see note at end).

Add this derived block before `return (`:

```tsx
// Children index (avoids O(E) re-scans during traversal)
const childrenByParent = new Map<string, ReturnType<typeof childrenOf>>()
for (const o of allOwnership) {
  const ent = entityMap.get(o.child_id)
  if (!ent) continue
  const arr = childrenByParent.get(o.parent_id) ?? []
  arr.push({ ...o, entity: ent })
  childrenByParent.set(o.parent_id, arr)
}

type RawBrand = { entity: typeof entity; edge: Ownership; via: { id: string; name: string } | null }
function collectBrandHoldings(rootId: string): RawBrand[] {
  const out: RawBrand[] = []
  const seenBrands = new Set<string>()
  const walked = new Set<string>()
  function walk(parentId: string) {
    if (walked.has(parentId)) return
    walked.add(parentId)
    for (const edge of childrenByParent.get(parentId) ?? []) {
      const child = edge.entity!
      if (child.type === 'brand') {
        if (!seenBrands.has(child.id)) {
          seenBrands.add(child.id)
          out.push({
            entity: child, edge,
            via: parentId === rootId ? null : { id: parentId, name: entityMap.get(parentId)?.name ?? parentId },
          })
        }
      } else {
        walk(child.id)
      }
    }
  }
  walk(rootId)
  return out
}

const rawBrands       = collectBrandHoldings(entity.id)
const companyChildren = children.filter(c => ['subsidiary', 'conglomerate'].includes(c.entity.type))
const productChildren = children.filter(c => c.entity.type === 'product')
const legalChildren   = children.filter(c => c.entity.type === 'legal-entity')
const knownTypes      = new Set(['brand', 'subsidiary', 'conglomerate', 'product', 'legal-entity'])
const otherChildren   = children.filter(c => !knownTypes.has(c.entity.type))

const holdingIds = [
  ...rawBrands.map(h => h.entity.id),
  ...companyChildren.map(c => c.entity.id),
  ...productChildren.map(c => c.entity.id),
  ...legalChildren.map(c => c.entity.id),
  ...otherChildren.map(c => c.entity.id),
]
const primaryCat = await getEffectivePrimaryCategoryBatch(holdingIds)
const catName = (id: string, fallback: string | null) => primaryCat.get(id)?.name ?? fallback ?? null

const byCategory = (a: HoldingItem, b: HoldingItem) => {
  const ca = a.category, cb = b.category
  if (ca && cb) { const d = ca.localeCompare(cb); if (d) return d }
  else if (ca && !cb) return -1
  else if (!ca && cb) return 1
  return a.name.localeCompare(b.name)
}

const brandItems: HoldingItem[] = rawBrands.map(h => ({
  id: h.entity.id, name: h.entity.name, type: h.entity.type,
  category: catName(h.entity.id, h.entity.category),
  share_pct: h.edge.share_pct ?? null,
  region: h.edge.region ?? null,
  acquired_year: h.edge.acquired_date ? h.edge.acquired_date.slice(0, 4) : null,
  via: h.via,
  logo_url: h.entity.logo_url ?? null,
})).sort(byCategory)

const mapChild = (c: typeof children[number]): HoldingItem => ({
  id: c.entity.id, name: c.entity.name, type: c.entity.type,
  category: catName(c.entity.id, c.entity.category),
  share_pct: c.share_pct ?? null,
  region: c.region ?? null,
  acquired_year: c.acquired_date ? c.acquired_date.slice(0, 4) : null,
  via: null,
  logo_url: c.entity.logo_url ?? null,
})

const companyItems = companyChildren.map(mapChild).sort(byCategory)
const productItems = productChildren.map(mapChild).sort(byCategory)
const legalItems   = legalChildren.map(mapChild).sort(byCategory)
const otherItems   = otherChildren.map(mapChild).sort(byCategory)
```

Replace the Holdings `<section>` with:

```tsx
{children.length > 0 && (
  <section className={styles.section}>
    <div className="section-label">Holdings</div>
    {/* label "Brands" — may change to "Consumer Brands" later */}
    {brandItems.length   > 0 && <HoldingsGroup label="Brands"                   items={brandItems} />}
    {companyItems.length > 0 && <HoldingsGroup label="Companies & Subsidiaries" items={companyItems} />}
    {productItems.length > 0 && <HoldingsGroup label="Products"                 items={productItems} />}
    {legalItems.length   > 0 && <HoldingsGroup label="Legal Entities"           items={legalItems} cap={24} />}
    {otherItems.length   > 0 && <HoldingsGroup label="Other Holdings"           items={otherItems} />}
  </section>
)}
```

## Change 4 — `app/entity/[id]/EntityPage.module.css` (append)

```css
/* Holdings — grouped + redesigned cards */
.hGroup { margin-top: 22px; }
.hGroup:first-of-type { margin-top: 4px; }
.hGroupLabel { display:flex; align-items:center; gap:8px; margin-bottom:10px; font-size:10px; letter-spacing:.16em; text-transform:uppercase; color:var(--muted); }
.hGroupCount { font-size:9px; padding:1px 7px; border-radius:999px; background:var(--tag-bg); border:1px solid var(--border); color:var(--accent); }
.hGrid { display:grid; grid-template-columns:repeat(auto-fill, minmax(200px, 1fr)); gap:10px; }
.hCard { display:flex; flex-direction:column; gap:9px; padding:13px 15px 12px; background:var(--surface); border:1px solid var(--border); border-left:2px solid var(--border); transition:border-color .15s ease, background .15s ease, transform .15s ease; }
.hCard:hover { background:var(--surface2); border-color:var(--accent); transform:translateY(-1px); }
.hCardHead { display:flex; align-items:center; gap:10px; }
.hLogo { width:30px; height:30px; flex-shrink:0; object-fit:contain; background:#fff; border:1px solid var(--border); padding:3px; }
.hLogoFallback { width:30px; height:30px; flex-shrink:0; display:flex; align-items:center; justify-content:center; font-size:14px; font-weight:500; border:1px solid var(--border); background:var(--tag-bg); color:var(--muted); }
.hName { font-size:14px; font-weight:500; line-height:1.3; color:var(--text); }
.hMeta { display:flex; flex-wrap:wrap; gap:5px; align-items:center; }
.hBadge { font-size:9px; padding:2px 7px; letter-spacing:.06em; border:1px solid var(--border); color:var(--muted); background:var(--tag-bg); white-space:nowrap; }
.hBadgePartial { background:rgba(200,110,110,.12); color:var(--danger); border-color:rgba(200,110,110,.25); }
.hVia { color:var(--accent2); background:rgba(126,184,164,.10); border-color:rgba(126,184,164,.22); font-style:italic; }
.hType-brand        { border-left-color:#a07eb8; }
.hType-subsidiary   { border-left-color:var(--accent2); }
.hType-conglomerate { border-left-color:var(--accent); }
.hType-product      { border-left-color:#7e8eb8; }
.hType-legal-entity { border-left-color:var(--muted); }
.hType-brand        .hLogoFallback { background:rgba(160,126,184,.15); color:#a07eb8; }
.hType-subsidiary   .hLogoFallback { background:rgba(126,184,164,.15); color:var(--accent2); }
.hType-conglomerate .hLogoFallback { background:rgba(200,169,110,.15); color:var(--accent); }
.hType-product      .hLogoFallback { background:rgba(126,142,184,.15); color:#7e8eb8; }
.hType-legal-entity .hLogoFallback { background:var(--tag-bg); color:var(--muted); }
.hShowMore { margin-top:12px; background:var(--tag-bg); border:1px solid var(--border); color:var(--muted); font-family:'IBM Plex Mono', monospace; font-size:10px; letter-spacing:.08em; text-transform:uppercase; padding:7px 14px; cursor:pointer; transition:all .15s; }
.hShowMore:hover { border-color:var(--accent); color:var(--accent); }
```

The old `.holdingsGrid`, `.holdingCard`, `.holdingName`, `.holdingMeta` are now unused — safe to delete.
KEEP `.badge`, `.badgePartial`, `.badgeFull` (Siblings + Alternatives still use them).

## Change 5 — `fetch-logos.mjs` (separate file, place in repo root)

Populates `logo_url` from Wikidata P154. Provided alongside this handoff. Run:
```
node fetch-logos.mjs --dry-run --limit 50 --verbose   # inspect
node fetch-logos.mjs                                  # write (re-runnable; only fills nulls)
```

## Acceptance checks

- An entity page renders Holdings grouped as Brands / Companies & Subsidiaries / Products /
  Legal Entities / Other, only showing non-empty groups.
- Brands include rolled-up grandchildren under subsidiaries/legal entities, tagged `via <owner>`.
- Cards lead with a logo (when `logo_url` set) else a type-tinted monogram; left edge color-coded.
- Partial ownership shows a red share badge; 100% shows none.
- Within each group, items cluster by effective primary category.
- Legal Entities group caps at 24 with a working "Show N more".
- `npm run build` passes (watch for self-loop edges and field-name mismatches).

## Open decisions (flag to the user, don't silently choose)

- Logos sit on a white tile (safe for dark-ink logos on the dark theme). Revisit if it looks loud.
- Category sort uses effective primary category; if the cascade is sparse for a subtree, items fall
  back to name order.
- "Brands" vs "Consumer Brands" label — left as "Brands" pending the user's call.
