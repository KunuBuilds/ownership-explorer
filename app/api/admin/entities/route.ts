import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

function checkAuth(req: NextRequest): boolean {
  const auth = req.headers.get('x-admin-password')
  return auth === process.env.ADMIN_PASSWORD
}

function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SECRET_KEY!,
    { auth: { persistSession: false } }
  )
}

export async function GET(req: NextRequest) {
  if (!checkAuth(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = getAdminClient()
  const list = req.nextUrl.searchParams.get('list')
  const parent = req.nextUrl.searchParams.get('parent')

  // List parents: all conglomerates + all entities (for target picker)
  if (list === 'parents') {
    // Paginated fetch for all entities
    const PAGE = 1000
    const all: any[] = []
    let from = 0
    while (true) {
      const { data, error } = await supabase
        .from('entities')
        .select('id,name,type')
        .order('type')
        .order('name')
        .range(from, from + PAGE - 1)
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
      if (!data || data.length === 0) break
      all.push(...data)
      if (data.length < PAGE) break
      from += PAGE
    }

    const conglomerates = all.filter(e => e.type === 'conglomerate')
    return NextResponse.json({ conglomerates, allEntities: all })
  }

  // Get direct children of a parent, with their child counts
  if (parent) {
    // Fetch ownership edges for this parent
    const { data: edges, error: edgeErr } = await supabase
      .from('ownership')
      .select('child_id')
      .eq('parent_id', parent)
    if (edgeErr) return NextResponse.json({ error: edgeErr.message }, { status: 500 })

    const childIds = (edges ?? []).map(e => e.child_id)
    if (childIds.length === 0) return NextResponse.json({ entities: [] })

    // Fetch entity details for those children in batches (to avoid 414 URLs)
    const BATCH = 500
    const entityMap = new Map<string, any>()
    for (let i = 0; i < childIds.length; i += BATCH) {
      const batch = childIds.slice(i, i + BATCH)
      const { data, error } = await supabase
        .from('entities')
        .select('id,name,type')
        .in('id', batch)
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
      data?.forEach(e => entityMap.set(e.id, e))
    }

    // Fetch child counts for each child (paginated to handle >1000 total rows)
    const countMap = new Map<string, number>()
    const PAGE = 1000
    let offset = 0
    while (true) {
      const { data, error } = await supabase
        .from('ownership')
        .select('parent_id')
        .in('parent_id', childIds)
        .order('parent_id')
        .order('child_id')
        .range(offset, offset + PAGE - 1)

      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
      if (!data || data.length === 0) break

      data.forEach(row => {
        countMap.set(row.parent_id, (countMap.get(row.parent_id) ?? 0) + 1)
      })

      if (data.length < PAGE) break
      offset += PAGE
    }

    const entities = childIds
      .map(id => {
        const e = entityMap.get(id)
        if (!e) return null
        return { ...e, child_count: countMap.get(id) ?? 0 }
      })
      .filter(Boolean)
      .sort((a: any, b: any) => a.name.localeCompare(b.name))

    return NextResponse.json({ entities })
  }

  return NextResponse.json({ error: 'Missing query parameter' }, { status: 400 })
}
