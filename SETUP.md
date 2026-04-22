# Ownership Explorer — Setup Guide

## Prerequisites
- Node.js 18+
- A Supabase account (free at supabase.com)
- A Vercel account (free at vercel.com)
- A GitHub account

---

## Step 1 — Supabase setup

1. Go to supabase.com → New Project
2. Choose a name (e.g. `ownership-explorer`), set a database password, pick a region close to you
3. Once provisioned, go to **SQL Editor** → **New Query**
4. Paste the contents of `supabase/schema.sql` and click **Run**
5. Open a new query, paste `supabase/seed.sql` and click **Run**
6. Go to **Project Settings → API** and copy:
   - **Project URL** → this is your `NEXT_PUBLIC_SUPABASE_URL`
   - **anon public** key → this is your `NEXT_PUBLIC_SUPABASE_ANON_KEY`

---

## Step 2 — Local development

```bash
# Clone your repo / move files into a new directory
cd ownership-explorer

# Copy and fill in environment variables
cp .env.example .env.local
# Edit .env.local with your Supabase URL and anon key

# Install dependencies
npm install

# Run locally
npm run dev
```

Open http://localhost:3000 — you should see the full app with live data from Supabase.

---

## Step 3 — Push to GitHub

```bash
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/ownership-explorer.git
git push -u origin main
```

---

## Step 4 — Deploy to Vercel

1. Go to vercel.com → **Add New Project**
2. Import your GitHub repository
3. Under **Environment Variables**, add:
   - `NEXT_PUBLIC_SUPABASE_URL` = your Supabase project URL
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY` = your Supabase anon key
4. Click **Deploy**

Vercel will build the app, run `generateStaticParams` to pre-render all entity pages,
and deploy everything to its CDN. Your site will be live at `your-project.vercel.app`.

---

## Step 5 — Adding data

### Via Supabase Table Editor (recommended for most data entry)

1. Go to your Supabase project → **Table Editor**
2. Select the `entities` table
3. Click **Insert row** — fill in `id`, `name`, `type`, and optionally `category`, `hq_country`
4. Switch to the `ownership` table
5. Click **Insert row** — fill in `parent_id`, `child_id`, `share_pct`, `acquired_date`, and optionally `region`
6. Repeat for `sources` and `ownership_sources` as needed
7. Trigger a Vercel redeploy (push any small commit, or use the Vercel dashboard → Deployments → Redeploy)

### Via SQL (for bulk inserts)

Use the SQL editor with INSERT statements matching the format in `supabase/seed.sql`.

### For category assignments

Insert rows into `entity_categories` with `entity_id` and `category_id` matching
a leaf category from the `categories` table.

---

## Redeploy when data changes

Vercel builds static pages at deploy time. When you add new entities or ownership edges:

```bash
# Option A: push an empty commit to trigger a rebuild
git commit --allow-empty -m "Trigger rebuild"
git push

# Option B: use Vercel CLI
npx vercel --prod

# Option C: Vercel dashboard → your project → Deployments → Redeploy
```

For a more automated flow, Supabase webhooks can trigger a Vercel deploy hook
automatically when rows are inserted — set this up under:
- Supabase: Database → Webhooks → Create webhook → point to your Vercel deploy hook URL
- Vercel: Project Settings → Git → Deploy Hooks → create a hook URL

---

## Project structure recap

```
ownership-explorer/
├── app/
│   ├── layout.tsx                  Root layout + nav
│   ├── globals.css                 Design tokens + shared styles
│   ├── page.tsx                    /  (Browse/Explore)
│   ├── entity/[id]/
│   │   ├── page.tsx                /entity/:id  (statically generated)
│   │   └── EntityPage.module.css
│   ├── categories/[[...slug]]/
│   │   └── page.tsx                /categories
│   └── timeline/
│       └── page.tsx                /timeline
├── components/
│   ├── Nav.tsx + Nav.module.css
│   ├── LookupSearch.tsx + .css     Global entity search
│   ├── ExploreClient.tsx + .css    Interactive tree browser
│   ├── TimelineClient.tsx + .css   Acquisition timeline
│   └── CategoriesClient.tsx + .css Category browser
├── lib/
│   ├── supabase.ts                 DB client + TypeScript types
│   ├── data.ts                     All database queries
│   └── graph.ts                    Graph traversal logic
└── supabase/
    ├── schema.sql                  Run first — creates all tables
    └── seed.sql                    Run second — loads starter data
```

