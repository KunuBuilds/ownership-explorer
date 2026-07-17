/**
 * lib/data.ts
 *
 * All database queries live here. Components never call Supabase directly —
 * they call these functions. This makes it easy to add caching, swap
 * the database, or mock data in tests.
 *
 * Functions prefixed with `get` are used in server components / generateStaticParams.
 * They run at build time and produce static pages.
 */

import { supabase, Entity, Ownership, Source, OwnershipSource, Category, Submission } from './supabase'

// ── Entities ─────────────────────────────────────────────────────────────────

export async function getAllEntities(): Promise<Entity[]> {
  const PAGE_SIZE = 1000
  const all: Entity[] = []
  let from = 0

  while (true) {
    const { data, error } = await supabase
      .from('entities')
      .select('*')
      .order('name')
      .order('id')              // ← tiebreaker for stable pagination
      .range(from, from + PAGE_SIZE - 1)

    if (error) throw error
    if (!data || data.length === 0) break
    all.push(...data)
    if (data.length < PAGE_SIZE) break
    from += PAGE_SIZE
  }
  return all
}


export async function getEntity(id: string): Promise<Entity | null> {
  const { data, error } = await supabase
    .from('entities')
    .select('*')
    .eq('id', id)
    .single()
  if (error) return null
  return data
}

export async function getAllEntityIds(): Promise<string[]> {
  const { data, error } = await supabase
    .from('entities')
    .select('id')
  if (error) throw error
  return data.map(e => e.id)
}

// ── Ownership edges ───────────────────────────────────────────────────────────

export async function getAllOwnership(): Promise<Ownership[]> {
  const PAGE_SIZE = 1000
  const all: Ownership[] = []
  let from = 0

  while (true) {
    const { data, error } = await supabase
      .from('ownership')
      .select('*')
      .is('divested_date', null)
      .order('id')              // ← use primary key directly, don't rely on nullable acquired_date
      .range(from, from + PAGE_SIZE - 1)

    if (error) throw error
    if (!data || data.length === 0) break
    all.push(...data)
    if (data.length < PAGE_SIZE) break
    from += PAGE_SIZE
  }
  return all
}

// Children of a given entity (what it owns)
export async function getChildren(parentId: string): Promise<(Ownership & { entity: Entity })[]> {
  const { data, error } = await supabase
    .from('ownership')
    .select(`
      *,
      entity:entities!ownership_child_id_fkey (*)
    `)
    .eq('parent_id', parentId)
    .is('divested_date', null)
  if (error) throw error
  return data as any
}

// Parents of a given entity (who owns it)
export async function getParents(childId: string): Promise<(Ownership & { entity: Entity })[]> {
  const { data, error } = await supabase
    .from('ownership')
    .select(`
      *,
      entity:entities!ownership_parent_id_fkey (*)
    `)
    .eq('child_id', childId)
    .is('divested_date', null)
  if (error) throw error
  return data as any
}

// ── Sources ───────────────────────────────────────────────────────────────────

export async function getAllSources(): Promise<Source[]> {
  const { data, error } = await supabase
    .from('sources')
    .select('*')
    .order('published_date', { ascending: false })
  if (error) throw error
  return data
}

// Sources for a specific entity's page (its incoming edge + all outgoing edges)
// Citation counts per ownership edge, for the "N sources" pill on holdings.
// getEntitySources only covers edges touching one entity, so brands rolled up
// via an intermediate would otherwise look uncited.
//
// Reads the whole (small) junction table in one paginated pass rather than
// filtering by edge id: a big conglomerate can have thousands of holdings, and
// chunked `in` filters meant ~40 sequential round-trips per page — enough to
// time the build out. Paginated against the 1,000-row cap like getAllOwnership.
export async function getSourceCountsByOwnership(): Promise<Map<number, number>> {
  const PAGE_SIZE = 1000
  const counts = new Map<number, number>()
  let from = 0

  while (true) {
    const { data, error } = await supabase
      .from('ownership_sources')
      .select('ownership_id')
      .order('ownership_id')
      .range(from, from + PAGE_SIZE - 1)

    if (error) throw error
    if (!data || data.length === 0) break
    for (const row of data) {
      counts.set(row.ownership_id, (counts.get(row.ownership_id) ?? 0) + 1)
    }
    if (data.length < PAGE_SIZE) break
    from += PAGE_SIZE
  }
  return counts
}

export async function getEntitySources(entityId: string): Promise<{
  source: Source
  ownershipId: number
  note: string | null
}[]> {
  // Fetch ownership IDs where this entity is the parent or child
  const { data: edges, error: edgeError } = await supabase
    .from('ownership')
    .select('id')
    .or(`parent_id.eq.${entityId},child_id.eq.${entityId}`)

  if (edgeError || !edges?.length) return []

  const ownershipIds = edges.map(e => e.id)

  const { data, error } = await supabase
    .from('ownership_sources')
    .select(`
      ownership_id,
      note,
      source:sources (*)
    `)
    .in('ownership_id', ownershipIds)

  if (error) throw error

  return (data as any).map((row: any) => ({
    source:      row.source,
    ownershipId: row.ownership_id,
    note:        row.note,
  }))
}

export async function getAlternatives(entityId: string): Promise<{
  alternative: Entity
  reason: string | null
  directional: boolean
}[]> {
  // Get alternatives where this entity is the subject
  const { data: forward, error: e1 } = await supabase
    .from('alternatives')
    .select(`alternative:entities!alternatives_alternative_id_fkey (*), reason, directional`)
    .eq('entity_id', entityId)
    .eq('status', 'approved')

  if (e1) throw e1

  // Get mutual alternatives where this entity is the alternative
  const { data: reverse, error: e2 } = await supabase
    .from('alternatives')
    .select(`alternative:entities!alternatives_entity_id_fkey (*), reason, directional`)
    .eq('alternative_id', entityId)
    .eq('directional', false)
    .eq('status', 'approved')

  if (e2) throw e2

  return [
    ...(forward as any).map((r: any) => ({
      alternative: r.alternative,
      reason:      r.reason,
      directional: r.directional,
    })),
    ...(reverse as any).map((r: any) => ({
      alternative: r.alternative,
      reason:      r.reason,
      directional: false,
    })),
  ]
}

// ── Categories ────────────────────────────────────────────────────────────────

export async function getAllCategories(): Promise<Category[]> {
  const { data, error } = await supabase
    .from('categories')
    .select('*')
    .order('sort_order')
  if (error) throw error
  return data
}

// Entities in a given category (and all its descendants)
export async function getEntitiesInCategory(categoryId: string): Promise<Entity[]> {
  const { data, error } = await supabase
    .from('entity_categories')
    .select(`
      entity:entities (*)
    `)
    .eq('category_id', categoryId)
  if (error) throw error
  return (data as any).map((row: any) => row.entity)
}

// All category assignments for a given entity
export async function getEntityCategories(entityId: string): Promise<string[]> {
  const { data, error } = await supabase
    .from('entity_categories')
    .select('category_id')
    .eq('entity_id', entityId)
  if (error) throw error
  return data.map(row => row.category_id)
}

// ── Compound queries (used by entity profile page) ────────────────────────────

export interface EntityPageData {
  entity:       Entity
  children:     (Ownership & { entity: Entity })[]
  parents:      (Ownership & { entity: Entity })[]
  sources:      { source: Source; ownershipId: number; note: string | null }[]
  categories:   string[]
  categoryMeta: EffectiveCategory[]   // ← NEW: full metadata (source, is_primary)
  alternatives: { alternative: Entity; reason: string | null; directional: boolean }[]
}

export async function getEntityPageData(id: string): Promise<EntityPageData | null> {
  const [entity, children, parents, sources, categoryMeta, alternatives] = await Promise.all([
    getEntity(id),
    getChildren(id),
    getParents(id),
    getEntitySources(id),
    getEffectiveCategories(id),   // ← was: getEntityCategories(id)
    getAlternatives(id),
  ])
  if (!entity) return null
  return {
    entity,
    children,
    parents,
    sources,
    categories:   categoryMeta.map(c => c.category_id),   // keep backward-compat shape
    categoryMeta,
    alternatives,
  }
}

// ── Full graph snapshot (used by client-side pages: explore, timeline) ────────
// Returns everything needed to reconstruct the graph client-side.

export interface GraphSnapshot {
  entities:   Entity[]
  ownership:  Ownership[]
  categories: Category[]
  sources:    Source[]
  entityCategories: Record<string, string[]>
}

export async function getAllEntityCategories(): Promise<Record<string, string[]>> {
  const PAGE_SIZE = 1000
  const all: { entity_id: string; category_id: string }[] = []
  let from = 0

  while (true) {
    const { data, error } = await supabase
      .from('entity_categories')
      .select('entity_id, category_id')
      .order('entity_id')
      .range(from, from + PAGE_SIZE - 1)

    if (error) throw error
    if (!data || data.length === 0) break
    all.push(...data)
    if (data.length < PAGE_SIZE) break
    from += PAGE_SIZE
  }

  // Group into { entity_id: [category_id, ...] }
  const map: Record<string, string[]> = {}
  for (const row of all) {
    if (!map[row.entity_id]) map[row.entity_id] = []
    map[row.entity_id].push(row.category_id)
  }
  return map
}

export async function getGraphSnapshot(): Promise<GraphSnapshot> {
  const [entities, ownership, categories, sources, entityCategories] = await Promise.all([
    getAllEntities(),
    getAllOwnership(),
    getAllCategories(),
    getAllSources(),
	getAllEntityCategories(),
  ])
  return { entities, ownership, categories, sources, entityCategories }
}


// ── Submissions ───────────────────────────────────────────────────────────────

export async function createSubmission(submission: {
  type:            string
  entity_id?:      string
  field?:          string
  current_value?:  string
  proposed_value?: string
  notes?:          string
  submitter_email?:string
}): Promise<{ success: boolean; error?: string }> {
  const { error } = await supabase
    .from('submissions')
    .insert([submission])
  if (error) return { success: false, error: error.message }
  return { success: true }
}

export async function getSubmissions(status?: string): Promise<Submission[]> {
  let query = supabase
    .from('submissions')
    .select('*')
    .order('created_at', { ascending: false })
  if (status) query = query.eq('status', status)
  const { data, error } = await query
  if (error) throw error
  return data
}

export async function updateSubmissionStatus(
  id: number,
  status: string,
  admin_note?: string
): Promise<void> {
  const { error } = await supabase
    .from('submissions')
    .update({ status, admin_note })
    .eq('id', id)
  if (error) throw error
}

// ── Types for categorization queries ──────────────────────────────────────────

export interface EffectiveCategory {
  category_id:      string
  is_primary:       boolean
  source:           'explicit' | 'inherited'
  source_entity_id: string
}

export interface EntityWithCategories {
  id:   string
  name: string
  type: string
  categories: { id: string; name: string; is_primary: boolean }[]
}

// ── Effective categories for an entity (explicit + inherited) ────────────────
// Uses the SQL function from the migration. Replaces getEntityCategories for
// cases where you want inheritance, not just direct assignments.

export async function getEffectiveCategories(entityId: string): Promise<EffectiveCategory[]> {
  const { data, error } = await supabase.rpc('entity_effective_categories', {
    target_entity_id: entityId,
  })
  if (error) throw error
  return (data ?? []) as EffectiveCategory[]
}

// Convenience wrapper — returns just the category IDs (explicit + inherited).
// Use this on public pages where you want the full cascade but only need IDs.
export async function getEffectiveCategoryIds(entityId: string): Promise<string[]> {
  const cats = await getEffectiveCategories(entityId)
  return cats.map(c => c.category_id)
}

// Effective PRIMARY category per entity as { id, name }. Prefers explicit primary,
// then any primary, then any explicit, then first effective. One rpc per id —
// used to sort grouped holdings on the public entity page by category.
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

// Entities in a category, including those that inherit from an ancestor.
// Replaces getEntitiesInCategory where you want cascade behavior.
export async function getEntitiesInCategoryWithInheritance(
  categoryId: string
): Promise<{ entity_id: string; source: 'explicit' | 'inherited' }[]> {
  const { data, error } = await supabase.rpc('entities_in_category', {
    target_category_id: categoryId,
  })
  if (error) throw error
  return (data ?? []) as { entity_id: string; source: 'explicit' | 'inherited' }[]
}

// ── Direct (explicit-only) queries for the admin UI ──────────────────────────
// The admin UI edits explicit assignments only. Inheritance is presented as
// read-only context ("this entity currently inherits Food & Beverage from
// Mondelez — assign your own to override").

export async function getExplicitCategories(entityId: string): Promise<
  { category_id: string; is_primary: boolean }[]
> {
  const { data, error } = await supabase
    .from('entity_categories')
    .select('category_id, is_primary')
    .eq('entity_id', entityId)
  if (error) throw error
  return data ?? []
}

// Batch version — takes an array of entity IDs and returns a Map keyed by
// entity_id. Used by the admin queue/bulk views to display current state.
export async function getExplicitCategoriesBatch(
  entityIds: string[]
): Promise<Map<string, { category_id: string; is_primary: boolean }[]>> {
  if (entityIds.length === 0) return new Map()
  const { data, error } = await supabase
    .from('entity_categories')
    .select('entity_id, category_id, is_primary')
    .in('entity_id', entityIds)
  if (error) throw error

  const map = new Map<string, { category_id: string; is_primary: boolean }[]>()
  for (const row of data ?? []) {
    const arr = map.get(row.entity_id) ?? []
    arr.push({ category_id: row.category_id, is_primary: row.is_primary })
    map.set(row.entity_id, arr)
  }
  return map
}

// ── Category coverage stats (for the admin dashboard) ────────────────────────

export interface CategoryCoverage {
  category_id:     string
  category_name:   string
  explicit_count:  number
  primary_count:   number
}

export async function getCategoryCoverage(): Promise<CategoryCoverage[]> {
  // We group in-app because doing it with rpc/sql is heavier and we have <200 cats
  const { data: cats, error: catErr } = await supabase
    .from('categories')
    .select('id, name')
  if (catErr) throw catErr

  const { data: assignments, error: asgErr } = await supabase
    .from('entity_categories')
    .select('category_id, is_primary')
  if (asgErr) throw asgErr

  const counts = new Map<string, { explicit: number; primary: number }>()
  for (const row of assignments ?? []) {
    const c = counts.get(row.category_id) ?? { explicit: 0, primary: 0 }
    c.explicit += 1
    if (row.is_primary) c.primary += 1
    counts.set(row.category_id, c)
  }

  return (cats ?? []).map(c => {
    const { explicit = 0, primary = 0 } = counts.get(c.id) ?? {}
    return {
      category_id:    c.id,
      category_name:  c.name,
      explicit_count: explicit,
      primary_count:  primary,
    }
  })
}

// ── Uncategorized entities (the work queue) ──────────────────────────────────

export interface UncategorizedEntity {
  id:         string
  name:       string
  type:       string
  parent_id:  string | null
  parent_name:string | null
  // Inherited categories from ancestors — shown as hints to the admin
  inherited_category_ids: string[]
}

// Returns entities with no explicit category assignments.
// Defaults to type in ('brand', 'conglomerate') to match the chosen scope.
export async function getUncategorizedEntities(opts: {
  types?:       string[]
  parent_id?:   string
  limit?:       number
  offset?:      number
  search?:      string
}): Promise<{ rows: UncategorizedEntity[]; total: number }> {
  const types = opts.types ?? ['brand', 'conglomerate']
  const limit = opts.limit ?? 50
  const offset = opts.offset ?? 0

  // Step 1: entity IDs that already have explicit categories — we'll exclude these
  const { data: tagged, error: tagErr } = await supabase
    .from('entity_categories')
    .select('entity_id')
  if (tagErr) throw tagErr
  const taggedIds = new Set((tagged ?? []).map(r => r.entity_id))

  // Step 2: fetch candidate entities
  let query = supabase
    .from('entities')
    .select('id, name, type', { count: 'exact' })
    .in('type', types)
    .order('name')

  if (opts.search) {
    query = query.ilike('name', `%${opts.search}%`)
  }

  // We over-fetch a bit since we'll filter out tagged ones client-side.
  // If this becomes slow at scale we can move the anti-join to SQL.
  const { data: candidates, error: candErr, count } = await query
    .range(offset, offset + limit * 2)

  if (candErr) throw candErr

  const filtered = (candidates ?? [])
    .filter(e => !taggedIds.has(e.id))
    .slice(0, limit)

  // Step 3: fetch parent context and inherited categories for the slice
  const entityIds = filtered.map(e => e.id)
  const [parentsMap, inheritedMap] = await Promise.all([
    getFirstParents(entityIds),
    getInheritedCategoriesBatch(entityIds),
  ])

  const rows: UncategorizedEntity[] = filtered.map(e => {
    const parent = parentsMap.get(e.id)
    return {
      id:         e.id,
      name:       e.name,
      type:       e.type,
      parent_id:  parent?.id ?? null,
      parent_name: parent?.name ?? null,
      inherited_category_ids: inheritedMap.get(e.id) ?? [],
    }
  })

  return { rows, total: count ?? rows.length }
}

// Helper: first parent for each entity ID (for display)
async function getFirstParents(entityIds: string[]): Promise<Map<string, { id: string; name: string }>> {
  if (entityIds.length === 0) return new Map()
  const { data, error } = await supabase
    .from('ownership')
    .select('child_id, parent_id, entity:entities!ownership_parent_id_fkey (id, name)')
    .in('child_id', entityIds)
    .is('divested_date', null)
  if (error) throw error

  const map = new Map<string, { id: string; name: string }>()
  for (const row of (data ?? []) as any[]) {
    if (!map.has(row.child_id) && row.entity) {
      map.set(row.child_id, { id: row.entity.id, name: row.entity.name })
    }
  }
  return map
}

// Helper: inherited category IDs for a batch of entities.
// This calls entity_effective_categories per ID since Supabase rpc doesn't
// natively support multi-input batching. For the admin UI (typically <50
// entities per page load) the overhead is acceptable. If you ever need to
// batch thousands, we'd add a batch variant of the SQL function.
async function getInheritedCategoriesBatch(entityIds: string[]): Promise<Map<string, string[]>> {
  const results = await Promise.all(
    entityIds.map(async id => {
      const { data } = await supabase.rpc('entity_effective_categories', { target_entity_id: id })
      return { id, cats: (data ?? []) as EffectiveCategory[] }
    })
  )

  const map = new Map<string, string[]>()
  for (const { id, cats } of results) {
    map.set(id, cats.filter(c => c.source === 'inherited').map(c => c.category_id))
  }
  return map
}

// ── Mutations (admin only — called from /api/admin/* routes) ─────────────────

export async function assignCategory(
  entityId:   string,
  categoryId: string,
  isPrimary:  boolean
): Promise<{ success: boolean; error?: string }> {
  // If setting primary, first clear any existing primary for this entity
  // (the partial unique index would reject otherwise).
  if (isPrimary) {
    const { error: clearErr } = await supabase
      .from('entity_categories')
      .update({ is_primary: false })
      .eq('entity_id', entityId)
      .eq('is_primary', true)
    if (clearErr) return { success: false, error: clearErr.message }
  }

  // Upsert the assignment
  const { error } = await supabase
    .from('entity_categories')
    .upsert(
      { entity_id: entityId, category_id: categoryId, is_primary: isPrimary },
      { onConflict: 'entity_id,category_id' }
    )
  if (error) return { success: false, error: error.message }
  return { success: true }
}

export async function unassignCategory(
  entityId:   string,
  categoryId: string
): Promise<{ success: boolean; error?: string }> {
  const { error } = await supabase
    .from('entity_categories')
    .delete()
    .eq('entity_id', entityId)
    .eq('category_id', categoryId)
  if (error) return { success: false, error: error.message }
  return { success: true }
}

// Bulk assign — apply one category to many entities. Optionally set as primary
// for all of them (useful when categorizing a cluster of similar brands).
export async function bulkAssignCategory(
  entityIds:  string[],
  categoryId: string,
  isPrimary:  boolean
): Promise<{ success: boolean; inserted: number; error?: string }> {
  if (entityIds.length === 0) return { success: true, inserted: 0 }

  // If marking primary, clear existing primaries on all target entities first
  if (isPrimary) {
    const { error: clearErr } = await supabase
      .from('entity_categories')
      .update({ is_primary: false })
      .in('entity_id', entityIds)
      .eq('is_primary', true)
    if (clearErr) return { success: false, inserted: 0, error: clearErr.message }
  }

  const rows = entityIds.map(entity_id => ({
    entity_id,
    category_id: categoryId,
    is_primary:  isPrimary,
  }))

  const { error, count } = await supabase
    .from('entity_categories')
    .upsert(rows, { onConflict: 'entity_id,category_id', count: 'exact' })

  if (error) return { success: false, inserted: 0, error: error.message }
  return { success: true, inserted: count ?? rows.length }
}
