import { NextRequest, NextResponse } from 'next/server'
import { updateSubmissionStatus, getSubmissions } from '@/lib/data'

function checkAuth(req: NextRequest): boolean {
  const auth = req.headers.get('x-admin-password')
  return auth === process.env.ADMIN_PASSWORD
}

export async function GET(req: NextRequest) {
  if (!checkAuth(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const status = req.nextUrl.searchParams.get('status') || undefined
  const data   = await getSubmissions(status)
  return NextResponse.json(data)
}

export async function PATCH(req: NextRequest) {
  if (!checkAuth(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const { id, status, admin_note } = await req.json()
  await updateSubmissionStatus(id, status, admin_note)
  return NextResponse.json({ success: true })
}