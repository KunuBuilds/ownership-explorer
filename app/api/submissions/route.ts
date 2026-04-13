import { NextRequest, NextResponse } from 'next/server'
import { createSubmission } from '@/lib/data'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()

    // Basic validation
    if (!body.type || !['correction', 'suggestion'].includes(body.type)) {
      return NextResponse.json({ error: 'Invalid submission type' }, { status: 400 })
    }

    if (body.type === 'correction' && !body.entity_id) {
      return NextResponse.json({ error: 'entity_id required for corrections' }, { status: 400 })
    }

    if (body.type === 'suggestion' && !body.notes) {
      return NextResponse.json({ error: 'Notes required for suggestions' }, { status: 400 })
    }

    const result = await createSubmission({
      type:            body.type,
      entity_id:       body.entity_id       || null,
      field:           body.field           || null,
      current_value:   body.current_value   || null,
      proposed_value:  body.proposed_value  || null,
      notes:           body.notes           || null,
      submitter_email: body.submitter_email || null,
    })

    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (err) {
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}