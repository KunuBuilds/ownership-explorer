-- ── SEED DATA ─────────────────────────────────────────────────────────────────
-- Run this AFTER schema.sql in Supabase SQL Editor.

-- ── ENTITIES ─────────────────────────────────────────────────────────────────
INSERT INTO entities (id, name, type, category, hq_country) VALUES
  ('lvmh',            'LVMH',               'conglomerate', NULL,              'FR'),
  ('tag-heuer',       'TAG Heuer',           'subsidiary',   'Watches',         'CH'),
  ('carrera',         'Carrera Line',        'brand',        'Watches',         NULL),
  ('bvlgari',         'BVLGARI',             'subsidiary',   'Watches/Jewels',  'IT'),
  ('bvlgari-octo',    'Octo Finissimo',      'brand',        'Watches',         NULL),
  ('dior',            'Christian Dior',      'subsidiary',   'Fashion',         'FR'),
  ('dior-beauty',     'Dior Beauty',         'brand',        'Cosmetics',       NULL),
  ('hermes',          'Hermès',              'subsidiary',   'Luxury',          'FR'),
  ('kraft-heinz',     'Kraft Heinz',         'conglomerate', NULL,              'US'),
  ('lunchables',      'Lunchables',          'brand',        'Food',            NULL),
  ('oscar-mayer',     'Oscar Mayer',         'brand',        'Food',            NULL),
  ('bologna',         'Classic Bologna',     'product',      'Deli',            NULL),
  ('heinz',           'Heinz',               'subsidiary',   'Condiments',      'US'),
  ('heinz-ketchup',   'Heinz Ketchup',       'brand',        'Condiments',      NULL),
  ('kimberly-clark',  'Kimberly-Clark',      'conglomerate', NULL,              'US'),
  ('cottonelle',      'Cottonelle',          'brand',        'Personal Care',   NULL),
  ('kleenex',         'Kleenex',             'brand',        'Personal Care',   NULL),
  ('huggies',         'Huggies',             'brand',        'Baby Care',       NULL),
  ('berkshire',       'Berkshire Hathaway',  'conglomerate', NULL,              'US'),
  ('geico',           'GEICO',               'subsidiary',   'Insurance',       'US'),
  ('coca-cola',       'Coca-Cola',           'subsidiary',   'Beverages',       'US'),
  ('coke-zero',       'Coke Zero Sugar',     'brand',        'Beverages',       NULL);

-- ── OWNERSHIP EDGES ───────────────────────────────────────────────────────────
INSERT INTO ownership (parent_id, child_id, share_pct, region, acquired_date) VALUES
  ('lvmh',          'tag-heuer',    100.00, NULL, '1999-02-22'),
  ('tag-heuer',     'carrera',      100.00, NULL, '1999-02-22'),
  ('lvmh',          'bvlgari',      100.00, NULL, '2011-06-30'),
  ('bvlgari',       'bvlgari-octo', 100.00, NULL, '2011-06-30'),
  ('lvmh',          'dior',          97.50, NULL, '2017-04-25'),
  ('dior',          'dior-beauty',  100.00, NULL, '2017-04-25'),
  ('lvmh',          'hermes',        23.10, NULL, '2010-10-23'),
  ('kraft-heinz',   'lunchables',   100.00, NULL, '1988-01-01'),
  ('kraft-heinz',   'oscar-mayer',  100.00, NULL, '1989-03-01'),
  ('oscar-mayer',   'bologna',      100.00, NULL, '1989-03-01'),
  ('kraft-heinz',   'heinz',        100.00, NULL, '2015-07-02'),
  ('heinz',         'heinz-ketchup',100.00, NULL, '2015-07-02'),
  ('kimberly-clark','cottonelle',   100.00, 'DE', '1995-06-01'),
  ('kimberly-clark','kleenex',      100.00, NULL, '1924-01-01'),
  ('kimberly-clark','huggies',      100.00, NULL, '1978-01-01'),
  ('berkshire',     'geico',        100.00, NULL, '1996-01-02'),
  ('berkshire',     'coca-cola',      9.30, NULL, '1988-01-01'),
  ('coca-cola',     'coke-zero',    100.00, NULL, '2005-06-15');

-- ── SOURCES ───────────────────────────────────────────────────────────────────
INSERT INTO sources (id, title, publisher, url, published_date, source_type) VALUES
  ('s1',  'LVMH acquires TAG Heuer',                     'LVMH Press Release',      'https://www.lvmh.com/news-documents/press-releases/lvmh-acquires-tag-heuer/',    '1999-02-22', 'primary'),
  ('s2',  'LVMH to acquire Bulgari',                     'LVMH Press Release',      'https://www.lvmh.com/news-documents/press-releases/lvmh-to-acquire-bulgari/',    '2011-03-07', 'primary'),
  ('s3',  'LVMH completes Bulgari acquisition',          'Reuters',                 'https://www.reuters.com/article/lvmh-bulgari/',                                   '2011-06-30', 'secondary'),
  ('s4',  'LVMH 2023 Annual Report — Group Structure',   'LVMH Investor Relations', 'https://r.lvmh.com/annual-report-2023',                                           '2024-02-01', 'filing'),
  ('s5',  'LVMH takes stake in Hermès',                  'Financial Times',         'https://www.ft.com/content/lvmh-hermes-stake',                                    '2010-10-26', 'secondary'),
  ('s6',  'LVMH Hermès stake confirmed at 23.1%',        'LVMH Press Release',      'https://www.lvmh.com/news-documents/press-releases/hermes-stake/',                '2014-09-02', 'primary'),
  ('s7',  'Christian Dior SE merger — tender offer',     'AMF Filing',              'https://www.amf-france.org/en/node/62411',                                        '2017-04-25', 'filing'),
  ('s8',  'Kraft Heinz 2023 10-K — Subsidiary List',    'SEC EDGAR',               'https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=0001637459',       '2024-02-14', 'filing'),
  ('s9',  'Oscar Mayer brand history',                   'Kraft Heinz',             'https://www.kraftheinzcompany.com/brands.html',                                   '2023-01-01', 'primary'),
  ('s10', 'Kraft-Heinz merger completed',                'SEC Filing 8-K',          'https://www.sec.gov/Archives/edgar/data/1637459/',                                '2015-07-02', 'filing'),
  ('s11', 'Kimberly-Clark 2023 Annual Report',          'SEC EDGAR',               'https://investor.kimberly-clark.com/annual-reports',                              '2024-02-08', 'filing'),
  ('s12', 'Kimberly-Clark acquires Scott Paper',        'Reuters',                 'https://www.reuters.com/article/kimberly-clark-scott/',                           '1995-12-12', 'secondary'),
  ('s13', 'Berkshire Hathaway 2023 Annual Report',      'Berkshire Hathaway',      'https://www.berkshirehathaway.com/2023ar/2023ar.pdf',                              '2024-02-24', 'filing'),
  ('s14', 'Berkshire 13F Filing — Coca-Cola stake',     'SEC EDGAR',               'https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=BERKSHIRE',        '2024-02-14', 'filing'),
  ('s15', 'GEICO acquisition by Berkshire Hathaway',    'Berkshire Hathaway',      'https://www.berkshirehathaway.com/letters/1995.html',                             '1996-01-02', 'primary'),
  ('s16', 'Coca-Cola Company 2023 10-K',                'SEC EDGAR',               'https://investors.coca-colacompany.com/annual-reports',                           '2024-02-14', 'filing');

-- ── OWNERSHIP → SOURCES JOIN ──────────────────────────────────────────────────
-- Link each ownership edge (by its serial id) to its citations.
-- We use a subquery to look up the ownership id by parent+child.
INSERT INTO ownership_sources (ownership_id, source_id)
SELECT o.id, s.source_id FROM ownership o
JOIN (VALUES
  ('lvmh',          'tag-heuer',    's1'),
  ('lvmh',          'tag-heuer',    's4'),
  ('tag-heuer',     'carrera',      's1'),
  ('lvmh',          'bvlgari',      's2'),
  ('lvmh',          'bvlgari',      's3'),
  ('lvmh',          'bvlgari',      's4'),
  ('bvlgari',       'bvlgari-octo', 's2'),
  ('lvmh',          'dior',         's7'),
  ('lvmh',          'dior',         's4'),
  ('dior',          'dior-beauty',  's7'),
  ('lvmh',          'hermes',       's5'),
  ('lvmh',          'hermes',       's6'),
  ('kraft-heinz',   'lunchables',   's8'),
  ('kraft-heinz',   'oscar-mayer',  's8'),
  ('kraft-heinz',   'oscar-mayer',  's9'),
  ('oscar-mayer',   'bologna',      's9'),
  ('kraft-heinz',   'heinz',        's10'),
  ('kraft-heinz',   'heinz',        's8'),
  ('heinz',         'heinz-ketchup','s10'),
  ('kimberly-clark','cottonelle',   's11'),
  ('kimberly-clark','cottonelle',   's12'),
  ('kimberly-clark','kleenex',      's11'),
  ('kimberly-clark','huggies',      's11'),
  ('berkshire',     'geico',        's13'),
  ('berkshire',     'geico',        's15'),
  ('berkshire',     'coca-cola',    's13'),
  ('berkshire',     'coca-cola',    's14'),
  ('coca-cola',     'coke-zero',    's16')
) AS s(parent_id, child_id, source_id)
  ON o.parent_id = s.parent_id AND o.child_id = s.child_id;

-- ── CATEGORIES ────────────────────────────────────────────────────────────────
INSERT INTO categories (id, name, parent_id, level, icon, description, sort_order) VALUES
  -- L1 Sectors
  ('food',            'Food & Grocery',         NULL,           1, '🛒', 'Consumer food brands, packaged goods, condiments, and grocery staples.', 1),
  ('luxury',          'Luxury & Fashion',        NULL,           1, '◈',  'High-end fashion houses, jewellery, and luxury goods conglomerates.',    2),
  ('personal-care',   'Personal Care',           NULL,           1, '✦',  'Hygiene, tissue, skincare, and baby care products.',                    3),
  ('insurance',       'Insurance & Financial',   NULL,           1, '◇',  'Insurance carriers, financial services, and holding companies.',        4),

  -- L2 Food subcategories
  ('food-meat',       'Meat & Deli',             'food',         2, NULL, 'Processed meats, deli brands, and charcuterie.',        1),
  ('food-kids',       'Kids & Lunchbox',         'food',         2, NULL, 'Brands aimed at children''s meals and lunchbox staples.',2),
  ('food-condiments', 'Condiments & Sauces',     'food',         2, NULL, 'Ketchup, mustard, dressings, and cooking sauces.',      3),
  ('food-beverages',  'Beverages',               'food',         2, NULL, 'Soft drinks, juices, and non-alcoholic beverages.',     4),

  -- L2 Luxury subcategories
  ('luxury-watches',  'Watches & Jewellery',     'luxury',       2, NULL, 'Fine watchmaking and jewellery brands.',                1),
  ('luxury-fashion',  'Haute Couture & Fashion', 'luxury',       2, NULL, 'Designer clothing, accessories, and fashion houses.',  2),
  ('luxury-leather',  'Leather Goods',           'luxury',       2, NULL, 'Handbags, luggage, and leather accessories.',          3),

  -- L2 Personal Care subcategories
  ('pc-tissue',       'Tissue & Paper',          'personal-care',2, NULL, 'Toilet paper, facial tissue, and paper towel brands.', 1),
  ('pc-baby',         'Baby Care',               'personal-care',2, NULL, 'Nappies, wipes, and infant hygiene.',                  2),

  -- L2 Insurance subcategories
  ('ins-auto',        'Auto Insurance',          'insurance',    2, NULL, 'Personal and commercial vehicle insurance.',           1),

  -- L3 Food
  ('food-meat-deli',          'Deli & Packaged Meats',   'food-meat',       3, NULL, NULL, 1),
  ('food-meat-hotdog',        'Hot Dogs & Sausages',     'food-meat',       3, NULL, NULL, 2),
  ('food-kids-lunch',         'Lunch Kits',              'food-kids',       3, NULL, NULL, 1),
  ('food-kids-snacks',        'Kids Snacks',             'food-kids',       3, NULL, NULL, 2),
  ('food-condiments-ketchup', 'Ketchup & Tomato',        'food-condiments', 3, NULL, NULL, 1),
  ('food-condiments-other',   'Other Condiments',        'food-condiments', 3, NULL, NULL, 2),
  ('food-bev-soda',           'Carbonated Soft Drinks',  'food-beverages',  3, NULL, NULL, 1),
  ('food-bev-juice',          'Juices & Waters',         'food-beverages',  3, NULL, NULL, 2),

  -- L3 Luxury
  ('luxury-watches-swiss',    'Swiss Watchmaking',       'luxury-watches',  3, NULL, NULL, 1),
  ('luxury-watches-italian',  'Italian Jewellery',       'luxury-watches',  3, NULL, NULL, 2),
  ('luxury-watches-lines',    'Watch Lines & Collections','luxury-watches', 3, NULL, NULL, 3),
  ('luxury-fashion-couture',  'Couture Houses',          'luxury-fashion',  3, NULL, NULL, 1),
  ('luxury-fashion-beauty',   'Fashion-led Beauty',      'luxury-fashion',  3, NULL, NULL, 2),
  ('luxury-leather-heritage', 'Heritage Houses',         'luxury-leather',  3, NULL, NULL, 1),

  -- L3 Personal Care
  ('pc-tissue-toilet',        'Toilet Paper',            'pc-tissue',       3, NULL, NULL, 1),
  ('pc-tissue-facial',        'Facial Tissue',           'pc-tissue',       3, NULL, NULL, 2),
  ('pc-baby-nappies',         'Nappies & Diapers',       'pc-baby',         3, NULL, NULL, 1),

  -- L3 Insurance
  ('ins-auto-personal',       'Personal Auto',           'ins-auto',        3, NULL, NULL, 1);

-- ── ENTITY → CATEGORY ASSIGNMENTS ────────────────────────────────────────────
INSERT INTO entity_categories (entity_id, category_id) VALUES
  ('lunchables',    'food-kids-lunch'),
  ('oscar-mayer',   'food-meat-deli'),
  ('bologna',       'food-meat-deli'),
  ('heinz',         'food-condiments-ketchup'),
  ('heinz-ketchup', 'food-condiments-ketchup'),
  ('coca-cola',     'food-bev-soda'),
  ('coke-zero',     'food-bev-soda'),
  ('tag-heuer',     'luxury-watches-swiss'),
  ('carrera',       'luxury-watches-lines'),
  ('bvlgari',       'luxury-watches-italian'),
  ('bvlgari-octo',  'luxury-watches-lines'),
  ('dior',          'luxury-fashion-couture'),
  ('dior-beauty',   'luxury-fashion-beauty'),
  ('hermes',        'luxury-leather-heritage'),
  ('cottonelle',    'pc-tissue-toilet'),
  ('kleenex',       'pc-tissue-facial'),
  ('huggies',       'pc-baby-nappies'),
  ('geico',         'ins-auto-personal');
