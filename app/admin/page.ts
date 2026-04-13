'use client'
import { useState, useEffect } from 'react'
import styles from './AdminPage.module.css'

type Status = 'pending' | 'reviewed' | 'applied' | 'rejected'

interface Submission {
  id:              number
  type:            string
  entity_id:       string | null
  field:           string | null
  current_value:   string | null
  proposed_value:  string | null
  notes:           string | null
  submitter_email: string | null
  status:          Status
  admin_note:      string | null
  created_at:      string
}

const STATUS_COLORS: Record<Status, string> = {
  pending:  'var(--accent)',
  reviewed: '#7e8eb8',
  applied:  'var(--accent2)',
  rejected: 'var(--danger)',
}

export default function AdminPage() {
  const [password,     setPassword]     = useState('')
  const [authed,       setAuthed]       = useState(false)
  const [authError,    setAuthError]    = useState('')
  const [submissions,  setSubmissions]  = useState<Submission[]>([])
  const [filter,       setFilter]       = useState<string>('pending')
  const [loading,      setLoading]      = useState(false)
  const [adminNotes,   setAdminNotes]   = useState<Record<number, string>>({})
  const [savedPw,      setSavedPw]      = useState('')

  async function login() {
    setLoading(true)
    const res = await fetch(`/api/admin?status=${filter}`, {
      headers: { 'x-admin-password': password }
    })
    if (res.status === 401) {
      setAuthError('Incorrect password.')
      setLoading(false)
      return
    }
    const data = await res.json()
    setSubmissions(data)
    setSavedPw(password)
    setAuthed(true)
    setLoading(false)
  }

  async function loadSubmissions(status: string, pw: string) {
    setLoading(true)
    const res  = await fetch(`/api/admin?status=${status}`, {
      headers: { 'x-admin-password': pw }
    })
    const data = await res.json()
    setSubmissions(data)
    setLoading(false)
  }

  async function updateStatus(id: number, status: Status) {
    await fetch('/api/admin', {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json', 'x-admin-password': savedPw },
      body:    JSON.stringify({ id, status, admin_note: adminNotes[id] || null }),
    })
    loadSubmissions(filter, savedPw)
  }

  useEffect(() => {
    if (authed) loadSubmissions(filter, savedPw)
  }, [filter])

  if (!authed) {
    return (
      <div className={styles.loginPage}>
        <div className={styles.loginBox}>
          <div className={styles.loginTitle}>Admin Access</div>
          <input
            className={styles.loginInput}
            type="password"
            placeholder="Password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && login()}
          />
          {authError && <div className={styles.loginError}>{authError}</div>}
          <button className={styles.loginBtn} onClick={login} disabled={loading}>
            {loading ? 'Checking...' : 'Enter'}
          </button>
        </div>
      </div>
    )
  }

  const STATUSES = ['pending', 'reviewed', 'applied', 'rejected']

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div className={styles.headerLeft}>
          <h1 className={styles.title}>Submissions</h1>
          <div className={styles.subtitle}>
            {submissions.length} {filter} submission{submissions.length !== 1 ? 's' : ''}
          </div>
        </div>
        <div className={styles.filterRow}>
          {STATUSES.map(s => (
            <button
              key={s}
              className={`filter-btn ${filter === s ? 'active' : ''}`}
              onClick={() => setFilter(s)}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className={styles.loading}>Loading...</div>
      ) : submissions.length === 0 ? (
        <div className={styles.empty}>No {filter} submissions</div>
      ) : (
        <div className={styles.list}>
          {submissions.map(sub => (
            <div key={sub.id} className={styles.card}>
              <div className={styles.cardHeader}>
                <div className={styles.cardLeft}>
                  <span className={styles.typeBadge}>{sub.type}</span>
                  {sub.entity_id && (
                    <span className={styles.entityBadge}>{sub.entity_id}</span>
                  )}
                  <span className={styles.date}>
                    {new Date(sub.created_at).toLocaleDateString('en-GB', {
                      day: 'numeric', month: 'short', year: 'numeric'
                    })}
                  </span>
                </div>
                <span
                  className={styles.statusBadge}
                  style={{ color: STATUS_COLORS[sub.status], borderColor: STATUS_COLORS[sub.status] }}
                >
                  {sub.status}
                </span>
              </div>

              <div className={styles.cardBody}>
                {sub.field && (
                  <div className={styles.row}>
                    <span className={styles.rowLabel}>Field</span>
                    <span className={styles.rowValue}>{sub.field}</span>
                  </div>
                )}
                {sub.current_value && (
                  <div className={styles.row}>
                    <span className={styles.rowLabel}>Current</span>
                    <span className={styles.rowValue}>{sub.current_value}</span>
                  </div>
                )}
                {sub.proposed_value && (
                  <div className={styles.row}>
                    <span className={styles.rowLabel}>Proposed</span>
                    <span className={`${styles.rowValue} ${styles.proposed}`}>{sub.proposed_value}</span>
                  </div>
                )}
                {sub.notes && (
                  <div className={styles.row}>
                    <span className={styles.rowLabel}>Notes</span>
                    <span className={styles.rowValue}>{sub.notes}</span>
                  </div>
                )}
                {sub.submitter_email && (
                  <div className={styles.row}>
                    <span className={styles.rowLabel}>Email</span>
                    <span className={styles.rowValue}>
                      <a href={`mailto:${sub.submitter_email}`}>{sub.submitter_email}</a>
                    </span>
                  </div>
                )}
              </div>

              <div className={styles.cardFooter}>
                <input
                  className={styles.noteInput}
                  type="text"
                  placeholder="Admin note (optional)..."
                  value={adminNotes[sub.id] ?? sub.admin_note ?? ''}
                  onChange={e => setAdminNotes(prev => ({ ...prev, [sub.id]: e.target.value }))}
                />
                <div className={styles.actions}>
                  {(['reviewed', 'applied', 'rejected'] as Status[])
                    .filter(s => s !== sub.status)
                    .map(s => (
                      <button
                        key={s}
                        className={`${styles.actionBtn} ${styles[s]}`}
                        onClick={() => updateStatus(sub.id, s)}
                      >
                        Mark {s}
                      </button>
                    ))
                  }
                  {sub.status !== 'pending' && (
                    <button
                      className={`${styles.actionBtn} ${styles.pending}`}
                      onClick={() => updateStatus(sub.id, 'pending')}
                    >
                      Reset to pending
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}