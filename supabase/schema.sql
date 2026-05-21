-- ── SCHEMA ────────────────────────────────────────────────────────────────────
-- Run this in Supabase SQL Editor: Dashboard → SQL Editor → New Query

-- All companies, subsidiaries, brands, and products live in one flat table.
-- The ownership table is the graph edge list that connects them.

CREATE TABLE entities (
  id             TEXT PRIMARY KEY,
  name           TEXT NOT NULL,
  type           TEXT NOT NULL CHECK (type IN ('conglomerate','subsidiary','brand','product','legal_entity')),
  category       TEXT,
  hq_country     TEXT,
  founded_date   DATE,
  flags          TEXT[] DEFAULT '{}',
  description    TEXT,
  created_at     TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE ownership (
  id                   SERIAL PRIMARY KEY,
  parent_id            TEXT NOT NULL REFERENCES entities(id),
  child_id             TEXT NOT NULL REFERENCES entities(id),
  share_pct            NUMERIC(5,2),         -- NULL = assumed 100%
  region               TEXT,                 -- ISO country code or NULL = global
  acquired_date        DATE,
  divested_date        DATE,                 -- NULL = still owned
  acquisition_price_usd BIGINT,
  flags                TEXT[] DEFAULT '{}',
  created_at           TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (parent_id, child_id, COALESCE(region, ''))
);

CREATE TABLE sources (
  id             TEXT PRIMARY KEY,
  title          TEXT NOT NULL,
  publisher      TEXT,
  url            TEXT,
  published_date DATE,
  source_type    TEXT CHECK (source_type IN ('primary','secondary','filing')),
  created_at     TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE ownership_sources (
  ownership_id   INTEGER NOT NULL REFERENCES ownership(id) ON DELETE CASCADE,
  source_id      TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  note           TEXT,
  PRIMARY KEY (ownership_id, source_id)
);

-- Three-level category taxonomy stored as a self-referential table.
-- level 1 = sector, level 2 = category, level 3 = subcategory
CREATE TABLE categories (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  parent_id   TEXT REFERENCES categories(id),
  level       INTEGER NOT NULL CHECK (level BETWEEN 1 AND 3),
  icon        TEXT,
  description TEXT,
  sort_order  INTEGER DEFAULT 0
);

-- Many-to-many: one entity can appear in multiple leaf categories
CREATE TABLE entity_categories (
  entity_id   TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  category_id TEXT NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  is_primary  BOOLEAN NOT NULL DEFAULT false,
  PRIMARY KEY (entity_id, category_id)
);

-- Enforce at most one primary category per entity
CREATE UNIQUE INDEX entity_categories_one_primary ON entity_categories (entity_id) WHERE is_primary = true;

-- User-submitted corrections and suggestions
CREATE TABLE submissions (
  id              SERIAL PRIMARY KEY,
  type            TEXT NOT NULL CHECK (type IN ('correction','suggestion')),
  entity_id       TEXT REFERENCES entities(id),
  field           TEXT CHECK (field IN ('owner','date','share_pct','name','region','other')),
  current_value   TEXT,
  proposed_value  TEXT,
  notes           TEXT,
  submitter_email TEXT,
  status          TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','reviewed','applied','rejected')),
  admin_note      TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Independent/alternative brand suggestions (e.g. "instead of Dove, try Dr. Bronner's")
CREATE TABLE alternatives (
  id             SERIAL PRIMARY KEY,
  entity_id      TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  alternative_id TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  reason         TEXT,
  directional    BOOLEAN NOT NULL DEFAULT false,  -- false = mutual, true = one-way
  UNIQUE (entity_id, alternative_id)
);

-- ── ROW LEVEL SECURITY ────────────────────────────────────────────────────────
-- Public reads on all tables; writes require authentication.

ALTER TABLE entities           ENABLE ROW LEVEL SECURITY;
ALTER TABLE ownership          ENABLE ROW LEVEL SECURITY;
ALTER TABLE sources            ENABLE ROW LEVEL SECURITY;
ALTER TABLE ownership_sources  ENABLE ROW LEVEL SECURITY;
ALTER TABLE categories         ENABLE ROW LEVEL SECURITY;
ALTER TABLE entity_categories  ENABLE ROW LEVEL SECURITY;
ALTER TABLE submissions        ENABLE ROW LEVEL SECURITY;
ALTER TABLE alternatives       ENABLE ROW LEVEL SECURITY;

-- Anyone can read
CREATE POLICY "Public read" ON entities           FOR SELECT USING (true);
CREATE POLICY "Public read" ON ownership          FOR SELECT USING (true);
CREATE POLICY "Public read" ON sources            FOR SELECT USING (true);
CREATE POLICY "Public read" ON ownership_sources  FOR SELECT USING (true);
CREATE POLICY "Public read" ON categories         FOR SELECT USING (true);
CREATE POLICY "Public read" ON entity_categories  FOR SELECT USING (true);
CREATE POLICY "Public read" ON alternatives       FOR SELECT USING (true);

-- Submissions: anyone can insert (public feedback form); reads/updates require auth
CREATE POLICY "Public insert" ON submissions      FOR INSERT WITH CHECK (true);
CREATE POLICY "Auth read"     ON submissions      FOR SELECT USING (auth.role() = 'authenticated');

-- Only authenticated users can write (Supabase dashboard users = authenticated)
CREATE POLICY "Auth write" ON entities           FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY "Auth write" ON ownership          FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY "Auth write" ON sources            FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY "Auth write" ON ownership_sources  FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY "Auth write" ON categories         FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY "Auth write" ON entity_categories  FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY "Auth write" ON alternatives       FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY "Auth write" ON submissions        FOR UPDATE USING (auth.role() = 'authenticated');

-- ── INDEXES ───────────────────────────────────────────────────────────────────
CREATE INDEX ON ownership (parent_id);
CREATE INDEX ON ownership (child_id);
CREATE INDEX ON ownership (divested_date) WHERE divested_date IS NULL;
CREATE INDEX ON entity_categories (category_id);
CREATE INDEX ON categories (parent_id);
CREATE INDEX ON submissions (status);
CREATE INDEX ON alternatives (entity_id);
CREATE INDEX ON alternatives (alternative_id);
