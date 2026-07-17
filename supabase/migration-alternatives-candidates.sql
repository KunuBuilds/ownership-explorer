-- ============================================================================
-- Alternatives: staged candidate generation
-- Run this whole file in the Supabase SQL editor.
--
-- Live-schema notes (verified against prod, not the stale supabase.ts / schema.sql):
--   * alternatives ALREADY has: score, llm_reason, llm_verdict, created_at
--     -> those are NOT re-added below (adding them would error).
--   * Only status / generated_reason / generated_at are new.
--   * A UNIQUE(entity_id, alternative_id) constraint already exists (0 dupes found),
--     so ON CONFLICT (entity_id, alternative_id) already works. The pair index
--     below is created ONLY if no unique index on that column pair exists.
-- ============================================================================

-- ── Step 2: columns ─────────────────────────────────────────────────────────
alter table alternatives
  add column if not exists status           text not null default 'approved',  -- approved | pending | rejected
  add column if not exists generated_reason text,
  add column if not exists generated_at     timestamptz;

-- Enforce the status enum (existing rows are all 'approved' -> passes).
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'alternatives_status_check') then
    alter table alternatives
      add constraint alternatives_status_check check (status in ('approved','pending','rejected'));
  end if;
end $$;

-- Unique pair index — created only if no unique index already covers
-- (entity_id, alternative_id). If the existing UNIQUE constraint is present
-- this is a no-op, and ON CONFLICT uses that constraint.
do $$
begin
  if not exists (
    select 1
      from pg_index i
      join pg_class t on t.oid = i.indrelid
     where t.relname = 'alternatives' and i.indisunique
       and (
         select array_agg(a.attname::text order by k.ord)
           from unnest(i.indkey) with ordinality k(attnum, ord)
           join pg_attribute a on a.attrelid = t.oid and a.attnum = k.attnum
       ) = array['entity_id','alternative_id']
  ) then
    create unique index alternatives_pair_key on alternatives (entity_id, alternative_id);
  end if;
end $$;


-- ── Step 4: candidate generator ─────────────────────────────────────────────
-- Live RPC signatures used below (verified):
--   entity_effective_categories(target_entity_id text) -> (category_id, is_primary, source, source_entity_id)
--   entities_in_category(target_category_id text)       -> (entity_id, source)   [cascade-aware]
--   entity_descendants(target_entity_id text)           -> (entity_id)           [ownership-tree]
create or replace function generate_alternative_candidates(target_category text default null)
returns table(brands_processed int, pairs_inserted int)
language plpgsql
as $$
declare
  v_brands   int;
  v_inserted int;
begin
  -- One deterministic CURRENT parent per child (divested edges ignored; no self-loops).
  -- Highest share_pct wins (NULL treated as 100%), tie-broken by parent_id.
  create temp table _parent_of on commit drop as
    select distinct on (child_id) child_id, parent_id
      from ownership
     where divested_date is null and parent_id <> child_id
     order by child_id, coalesce(share_pct, 100) desc, parent_id;
  create index on _parent_of (child_id);

  -- Brands in scope.
  create temp table _brands on commit drop as
    select e.id, e.hq_country
      from entities e
     where e.type = 'brand'
       and (target_category is null
            or e.id in (select entity_id from entities_in_category(target_category)));
  select count(*) into v_brands from _brands;

  -- Chosen categories per brand: primary effective cats if any, else all effective cats.
  create temp table _brand_cat on commit drop as
    with eff as (
      select b.id as brand_id, c.category_id, c.is_primary
        from _brands b
        cross join lateral entity_effective_categories(b.id) c
    ),
    hp as (
      select brand_id, bool_or(is_primary) as has_primary from eff group by brand_id
    )
    select e.brand_id, e.category_id
      from eff e
      join hp on hp.brand_id = e.brand_id
     where (hp.has_primary and e.is_primary) or (not hp.has_primary);
  create index on _brand_cat (brand_id);

  -- Peer brands sharing a chosen category; keep one (deterministic) category per pair.
  create temp table _pair on commit drop as
    select distinct on (bc.brand_id, m.entity_id)
           bc.brand_id, m.entity_id as peer_id, bc.category_id
      from _brand_cat bc
      cross join lateral entities_in_category(bc.category_id) m
      join entities pe on pe.id = m.entity_id and pe.type = 'brand'
     where m.entity_id <> bc.brand_id
     order by bc.brand_id, m.entity_id, bc.category_id;

  -- Ownership root for every involved entity (recursive, current edges only).
  create temp table _work on commit drop as
    select id from _brands union select peer_id from _pair;

  create temp table _root on commit drop as
    with recursive walk as (
      select w.id as start_id, w.id as cur, 0 as depth, array[w.id] as path
        from _work w
      union all
      select k.start_id, p.parent_id, k.depth + 1, k.path || p.parent_id
        from walk k
        join _parent_of p on p.child_id = k.cur
       where k.depth < 10                       -- depth cap
         and not (p.parent_id = any(k.path))     -- cycle guard
    )
    select distinct on (start_id) start_id, cur as root_id
      from walk
     order by start_id, depth desc;              -- deepest reached = root
  create index on _root (start_id);

  -- Total descendants per distinct root (for the small-parent test).
  create temp table _rootcount on commit drop as
    select r.root_id, (select count(*) from entity_descendants(r.root_id)) as n
      from (select distinct root_id from _root) r;
  create index on _rootcount (root_id);

  -- Score + insert. Divested edges never appear (only current edges built _parent_of/_root).
  insert into alternatives (entity_id, alternative_id, status, directional,
                            score, generated_reason, generated_at, reason)
  select p.brand_id, p.peer_id, 'pending', true,
         t.base + case
                    when b.hq_country is not null and pe.hq_country is not null
                     and b.hq_country = pe.hq_country then 0.5 else 0
                  end,
         t.tier || ', same category: ' || p.category_id,
         now(), null
    from _pair p
    join _root rb on rb.start_id = p.brand_id
    join _root rp on rp.start_id = p.peer_id
    join _brands b on b.id = p.brand_id
    join entities pe on pe.id = p.peer_id
    cross join lateral (
      select
        not exists (select 1 from _parent_of pp where pp.child_id = p.peer_id) as indep,
        coalesce((select n from _rootcount rc where rc.root_id = rp.root_id), 0) as root_desc
    ) f
    cross join lateral (
      select
        case when f.indep then 3 when f.root_desc < 5 then 2 else 1 end       as base,
        case when f.indep then 'independent'
             when f.root_desc < 5 then 'small-parent'
             else 'other-conglomerate' end                                     as tier
    ) t
   where rp.root_id <> rb.root_id          -- different owners
     and p.peer_id  <> p.brand_id          -- no self-pairs
     and not exists (                       -- never duplicate an existing row (either direction)
       select 1 from alternatives a
        where (a.entity_id = p.brand_id and a.alternative_id = p.peer_id)
           or (a.entity_id = p.peer_id  and a.alternative_id = p.brand_id)
     )
  on conflict (entity_id, alternative_id) do nothing;

  get diagnostics v_inserted = row_count;

  brands_processed := v_brands;
  pairs_inserted   := v_inserted;
  return next;
end;
$$;
