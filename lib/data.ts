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

import { supabase, Entity, Ownership, Source, OwnershipSource, Category } from './supabase'

// ── Entities ─────────────────────────────────────────────────────────────────

export async function getAllEntities(): Promise<Entity[]> {
  const { data, error } = await supabase
    .from('entities')
    .select('*')
    .order('name')
  if (error) throw error
  return data
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
  const { data, error } = await supabase
    .from('ownership')
    .select('*')
    .is('divested_date', null)   // only current ownership
    .order('acquired_date')
  if (error) throw error
  return data
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

  if (e1) throw e1

  // Get mutual alternatives where this entity is the alternative
  const { data: reverse, error: e2 } = await supabase
    .from('alternatives')
    .select(`alternative:entities!alternatives_entity_id_fkey (*), reason, directional`)
    .eq('alternative_id', entityId)
    .eq('directional', false)

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
  entity:     Entity
  children:   (Ownership & { entity: Entity })[]
  parents:    (Ownership & { entity: Entity })[]
  sources:    { source: Source; ownershipId: number; note: string | null }[]
  categories: string[]
  alternatives: { alternative: Entity; reason: string | null; directional: boolean }[]
}

export async function getEntityPageData(id: string): Promise<EntityPageData | null> {
  const [entity, children, parents, sources, categories, alternatives] = await Promise.all([
    getEntity(id),
    getChildren(id),
    getParents(id),
    getEntitySources(id),
    getEntityCategories(id),
	getAlternatives(id)
  ])
  if (!entity) return null
  return { entity, children, parents, sources, categories, alternatives }
}

// ── Full graph snapshot (used by client-side pages: explore, timeline) ────────
// Returns everything needed to reconstruct the graph client-side.

export interface GraphSnapshot {
  entities:   Entity[]
  ownership:  Ownership[]
  categories: Category[]
  sources:    Source[]
}

export async function getGraphSnapshot(): Promise<GraphSnapshot> {
  const [entities, ownership, categories, sources] = await Promise.all([
    getAllEntities(),
    getAllOwnership(),
    getAllCategories(),
    getAllSources(),
  ])
  return { entities, ownership, categories, sources }
}
