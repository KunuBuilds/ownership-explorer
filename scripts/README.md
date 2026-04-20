# EDGAR Scraper -- "Who Owns This" seed tool

Fetches subsidiary lists from SEC annual filings and outputs JSON ready to
import directly into the Who Owns This Supabase schema.

## Supports both filing types

| Filer type | Form | Exhibit | Example companies |
|---|---|---|---|
| US domestic | 10-K | **Exhibit 21** | Kraft Heinz, Alphabet, Nike, Berkshire |
| Foreign private issuer | 20-F | **Exhibit 8** | LVMH, Nestle, Kering, VW, BMW, Sony |

The scraper detects which form type to use automatically based on the `filing`
field in `CIK_MAP`. If a company isn't found under its configured form, it
falls back to the other type and logs a notice.

## Setup

```bash
npm install
```

Requires Node 18+. Dependencies: `node-fetch`, `cheerio`.

---

## Usage

```bash
# Scrape all 66 pre-seeded companies (both domestic and foreign)
node scraper.mjs --out results.json

# Scrape specific tickers -- works for both 10-K and 20-F filers
node scraper.mjs --companies LVMUY,NSRGY,KHC,PG --out luxury-food.json

# Scrape by CIK (10-K mode by default)
node scraper.mjs --cik 0001571996 --out kraft.json

# Scrape by CIK in 20-F mode (foreign private issuer)
node scraper.mjs --cik 0001070154 --foreign --out lvmh.json

# Extra logging (shows each HTTP request and exhibit URL)
node scraper.mjs --companies LVMUY --verbose

# List all pre-seeded tickers, sorted by filing type
node scraper.mjs --list
```

**Output files** (when `--out results.json` is used):
- `results-raw.json` -- full scrape details per company
- `results-supabase.json` -- three arrays ready for Supabase import

---

## Output schema

`results-supabase.json` maps directly to the Who Owns This schema:

```json
{
  "entities": [
    {
      "slug": "lvmh-moet-hennessy-louis-vuitton-se",
      "name": "LVMH Moet Hennessy Louis Vuitton SE",
      "type": "conglomerate",
      "cik": "0001070154",
      "ticker": "LVMUY"
    },
    {
      "slug": "lvmh-fragrance-brands-sas",
      "name": "LVMH Fragrance Brands SAS",
      "type": "subsidiary",
      "jurisdiction": "France"
    }
  ],
  "ownership": [
    {
      "parent_slug": "lvmh-moet-hennessy-louis-vuitton-se",
      "child_slug": "lvmh-fragrance-brands-sas",
      "ownership_pct": null,
      "acquisition_date": null,
      "source_id": "sec-ex8-0001070154-24-000012",
      "notes": "Incorporated in France"
    }
  ],
  "sources": [
    {
      "id": "sec-ex8-0001070154-24-000012",
      "title": "LVMH Moet Hennessy Louis Vuitton SE -- Exhibit 8, 20-F filed 2024-03-28",
      "url": "https://www.sec.gov/Archives/edgar/data/...",
      "credibility_tier": "Primary",
      "published_at": "2024-03-28",
      "publisher": "SEC EDGAR"
    }
  ]
}
```

### Data notes
- `ownership_pct` is always `null` -- neither Exhibit 21 nor Exhibit 8 includes
  ownership percentages. Cross-reference with the main 10-K/20-F body or Orbis
  for exact stakes.
- `acquisition_date` is always `null` -- use annual report narrative, press
  releases, or Crunchbase to fill in dates.
- `jurisdiction` is the state/country of incorporation where provided (e.g.
  "Delaware", "France", "England and Wales"). Foreign filers tend to include
  more international jurisdictions.
- `credibility_tier` is set to `"Primary"` -- SEC filings are first-party
  disclosures required by law.
- `source_id` prefix is `sec-ex21` for 10-K filers and `sec-ex8` for 20-F filers.

---

## Importing into Supabase

```js
import { createClient } from '@supabase/supabase-js';
import data from './results-supabase.json' assert { type: 'json' };

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

// Upsert in dependency order: entities first, then sources, then ownership
await supabase.from('entities').upsert(data.entities, { onConflict: 'slug' });
await supabase.from('sources').upsert(data.sources,   { onConflict: 'id'   });
await supabase.from('ownership').upsert(data.ownership, {
  onConflict: 'parent_slug,child_slug',
});
```

---

## Pre-seeded companies (66 total)

### 10-K filers -- Exhibit 21 (46 companies)

| Ticker | Name | Notable brands |
|---|---|---|
| TPR | Tapestry | Coach, Kate Spade, Stuart Weitzman |
| CPRI | Capri Holdings | Versace, Jimmy Choo, Michael Kors |
| PVH | PVH Corp | Calvin Klein, Tommy Hilfiger |
| KHC | Kraft Heinz | Lunchables, Heinz, Jell-O, Oscar Mayer |
| PG | Procter & Gamble | Tide, Gillette, Pampers, Oral-B |
| UL | Unilever | Dove, Ben & Jerry's, Hellmann's |
| GIS | General Mills | Cheerios, Betty Crocker, Pillsbury |
| CAG | Conagra Brands | Birds Eye, Healthy Choice, Slim Jim |
| DEO | Diageo | Johnnie Walker, Guinness, Smirnoff |
| CL | Colgate-Palmolive | Colgate, Hill's Pet, Tom's of Maine |
| CHD | Church & Dwight | Arm & Hammer, OxiClean, Trojan |
| EL | Estee Lauder | MAC, Clinique, La Mer, Jo Malone |
| NWL | Newell Brands | Rubbermaid, Sharpie, Coleman |
| CMCSA | Comcast | NBCUniversal, Peacock, Sky |
| WBD | Warner Bros Discovery | HBO, CNN, DC, TBS |
| PARA | Paramount Global | CBS, MTV, Nickelodeon, BET |
| GOOGL | Alphabet | Google, YouTube, Waymo, DeepMind |
| META | Meta Platforms | Facebook, Instagram, WhatsApp, Oculus |
| MSFT | Microsoft | LinkedIn, GitHub, Activision |
| AMZN | Amazon | Whole Foods, Twitch, MGM, Ring |
| MAR | Marriott | Ritz-Carlton, W Hotels, Westin |
| HLT | Hilton | Waldorf Astoria, DoubleTree, Hampton |
| GM | General Motors | Chevrolet, GMC, Buick, Cadillac |
| STLA | Stellantis | Jeep, Dodge, Ram, Alfa Romeo, Fiat |
| NKE | Nike | Converse |
| VFC | VF Corp | Vans, Supreme, The North Face, Timberland |
| BRK | Berkshire Hathaway | GEICO, BNSF, Dairy Queen, See's Candies |
| ... | (+ 19 more) | |

### 20-F filers -- Exhibit 8 (20 companies)

| Ticker | Name | Notable brands |
|---|---|---|
| LVMUY | LVMH | Louis Vuitton, Dior, Bulgari, Tiffany, Sephora, TAG Heuer |
| PPRUY | Kering | Gucci, Saint Laurent, Bottega Veneta, Balenciaga |
| CFRUY | Richemont | Cartier, IWC, Van Cleef & Arpels, Dunhill |
| HESAY | Hermes | Hermes |
| BURBY | Burberry | Burberry |
| NSRGY | Nestle | KitKat, Nespresso, Purina, Gerber, Maggi |
| ADRNY | AB InBev | Budweiser, Corona, Stella Artois, Beck's |
| DANOY | Danone | Evian, Activia, Alpro, Aptamil |
| HKHHF | Heineken | Heineken, Amstel, Dos Equis, Tiger |
| RBGLY | Reckitt Benckiser | Lysol, Durex, Mucinex, Dettol |
| HENKY | Henkel | Schwarzkopf, Persil, Loctite |
| SONY | Sony Group | PlayStation, Columbia Pictures, Sony Music |
| VIVHY | Vivendi | Universal Music Group, Canal+ |
| SAP | SAP | Qualtrics, Concur, Ariba |
| ACCYY | Accor | Sofitel, Fairmont, Raffles, Novotel, Ibis |
| TOYOY | Toyota | Lexus, Daihatsu |
| VWAGY | Volkswagen | Audi, Porsche, Lamborghini, Bentley, SEAT, Skoda |
| BMWYY | BMW Group | BMW, MINI, Rolls-Royce |
| MBGYY | Mercedes-Benz | Mercedes-Benz, AMG, Maybach |
| ADDYY | Adidas | Adidas |

---

## Adding a new company

**Domestic (10-K):** search at
`https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&company=<name>&type=10-K`

**Foreign (20-F):** search at
`https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&company=<name>&type=20-F`

Then add an entry to `CIK_MAP` in `scraper.mjs`:

```js
// Domestic example
KDP: { cik: '0001418135', name: 'Keurig Dr Pepper Inc', filing: 'DOMESTIC' }, // Dr Pepper, Snapple, 7UP, Canada Dry

// Foreign example
IDEXY: { cik: '0000049754', name: 'Inditex SA', filing: 'FOREIGN' }, // Zara, Massimo Dutti, Pull&Bear, Bershka
```

---

## Rate limiting

The SEC rate-limits to ~10 requests/second. The scraper sleeps 150ms between
requests. For the full 66-company list, expect around 8-12 minutes of runtime
(each company makes 3-4 HTTP requests).
