/**
 * lib/graph.ts
 *
 * Pure functions that traverse the ownership graph.
 * These are identical in logic to the prototype — just typed and extracted.
 * They work on plain data arrays, so they run on both server and client.
 */

import type { Entity, Ownership, Category } from './supabase'

export interface OwnershipEdge extends Ownership {
  entity?: Entity
}

export interface ChainNode {
  entity: Entity
  edge:   Ownership | null   // the edge that led to this node (null for root)
}

// ── Basic traversal ───────────────────────────────────────────────────────────

export function childrenOf(
  parentId: string,
  ownership: Ownership[],
  entityMap: Map<string, Entity>
): OwnershipEdge[] {
  return ownership
    .filter(o => o.parent_id === parentId)
    .map(o => ({ ...o, entity: entityMap.get(o.child_id) }))
    .filter(o => o.entity != null)
}

export function parentsOf(
  childId: string,
  ownership: Ownership[],
  entityMap: Map<string, Entity>
): OwnershipEdge[] {
  return ownership
    .filter(o => o.child_id === childId)
    .map(o => ({ ...o, entity: entityMap.get(o.parent_id) }))
    .filter(o => o.entity != null)
}

export function rootEntities(
  entities: Entity[],
  ownership: Ownership[]
): Entity[] {
  const childIds = new Set(ownership.map(o => o.child_id))
  return entities.filter(e => e.type === 'conglomerate' && !childIds.has(e.id))
}

// ── Ownership chain ───────────────────────────────────────────────────────────
// Returns all paths from any root down to the given entity.
// Most entities have one path; entities with multiple parents (rare) have multiple.

export function getOwnershipChains(
  entityId: string,
  ownership: Ownership[],
  entityMap: Map<string, Entity>
): ChainNode[][] {
  const chains: ChainNode[][] = []

  function walk(id: string, chain: ChainNode[]): void {
    const parents = ownership.filter(o => o.child_id === id)
    if (!parents.length) {
      chains.push([...chain].reverse())
      return
    }
    for (const edge of parents) {
      const parentEntity = entityMap.get(edge.parent_id)
      if (parentEntity) {
        walk(edge.parent_id, [...chain, { entity: parentEntity, edge }])
      }
    }
  }

  const entity = entityMap.get(entityId)
  if (!entity) return []
  walk(entityId, [{ entity, edge: null }])
  return chains
}

// ── Descendant count ──────────────────────────────────────────────────────────

export function countDescendants(
  entityId: string,
  ownership: Ownership[]
): number {
  let count = 0
  function walk(id: string): void {
    const children = ownership.filter(o => o.parent_id === id)
    count += children.length
    children.forEach(c => walk(c.child_id))
  }
  walk(entityId)
  return count
}

// ── Category helpers ──────────────────────────────────────────────────────────

export interface CategoryTree {
  category:  Category
  children:  CategoryTree[]
}

export function buildCategoryTree(categories: Category[]): CategoryTree[] {
  const map = new Map(categories.map(c => [c.id, { category: c, children: [] as CategoryTree[] }]))
  const roots: CategoryTree[] = []

  for (const node of map.values()) {
    if (node.category.parent_id) {
      map.get(node.category.parent_id)?.children.push(node)
    } else {
      roots.push(node)
    }
  }

  // Sort by sort_order at each level
  function sortTree(nodes: CategoryTree[]): CategoryTree[] {
    return nodes
      .sort((a, b) => a.category.sort_order - b.category.sort_order)
      .map(n => ({ ...n, children: sortTree(n.children) }))
  }

  return sortTree(roots)
}

// Collect all descendant category IDs from a given category node
export function descendantCategoryIds(
  categoryId: string,
  categories: Category[]
): string[] {
  const ids: string[] = []
  function walk(id: string): void {
    ids.push(id)
    categories.filter(c => c.parent_id === id).forEach(c => walk(c.id))
  }
  walk(categoryId)
  return ids
}

// ── Timeline events ───────────────────────────────────────────────────────────

export interface TimelineEvent {
  childId:    string
  parentId:   string
  rootId:     string
  childName:  string
  parentName: string
  rootName:   string
  date:       Date
  year:       number
  share:      number
  region:     string | null
  type:       string | null
}

export function buildTimelineEvents(
  ownership: Ownership[],
  entityMap: Map<string, Entity>,
  chains: Map<string, ChainNode[][]>   // pre-computed chains keyed by childId
): TimelineEvent[] {
  return ownership
    .filter(o => o.acquired_date != null)
    .map(o => {
      const child   = entityMap.get(o.child_id)
      const parent  = entityMap.get(o.parent_id)
      const chain   = chains.get(o.child_id)?.[0] ?? []
      const root    = chain[0]?.entity

      return {
        childId:    o.child_id,
        parentId:   o.parent_id,
        rootId:     root?.id     ?? o.parent_id,
        childName:  child?.name  ?? o.child_id,
        parentName: parent?.name ?? o.parent_id,
        rootName:   root?.name   ?? o.parent_id,
        date:       new Date(o.acquired_date!),
        year:       parseInt(o.acquired_date!.slice(0, 4)),
        share:      o.share_pct ?? 100,
        region:     o.region,
        type:       child?.type ?? null,
      }
    })
    .sort((a, b) => a.date.getTime() - b.date.getTime())
}

// ── Utility ───────────────────────────────────────────────────────────────────

export function buildEntityMap(entities: Entity[]): Map<string, Entity> {
  return new Map(entities.map(e => [e.id, e]))
}
