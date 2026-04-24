'use client'

import { useEffect } from 'react'
import Link from 'next/link'

export default function AdminIndex() {
  useEffect(() => {
    const prev = { bg: document.body.style.background, color: document.body.style.color }
    document.body.style.background = '#ffffff'
    document.body.style.color = '#1a1a1a'
    return () => {
      document.body.style.background = prev.bg
      document.body.style.color = prev.color
    }
  }, [])

  const cardStyle = {
    padding: 20,
    background: '#f7f7f8',
    border: '1px solid #d8dbe0',
    borderRadius: 4,
    textDecoration: 'none',
    color: '#1a1a1a',
    display: 'block',
  }

  return (
    <div style={{ minHeight: '100vh', background: '#ffffff', color: '#1a1a1a', fontFamily: 'system-ui, sans-serif' }}>
      <div style={{ maxWidth: 600, margin: '0 auto', padding: '80px 24px 24px' }}>
        <h1 style={{ fontSize: 22, marginBottom: 24 }}>Admin</h1>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <Link href="/admin/submissions" style={cardStyle}>
            <strong style={{ color: '#0066cc' }}>Submissions →</strong>
            <div style={{ fontSize: 13, color: '#555', marginTop: 4 }}>
              Review user-submitted corrections and data additions
            </div>
          </Link>
          <Link href="/admin/entities" style={cardStyle}>
            <strong style={{ color: '#0066cc' }}>Entity Management →</strong>
            <div style={{ fontSize: 13, color: '#555', marginTop: 4 }}>
              Reparent sub-brands, clean up duplicates, manage entity types
            </div>
          </Link>
        </div>
      </div>
    </div>
  )
}