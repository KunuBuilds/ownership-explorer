'use client'
import { useState } from 'react'
import styles from './SubmissionForm.module.css'

interface Props {
  type:       'correction' | 'suggestion'
  entityId?:  string
  entityName?:string
  onClose?:   () => void
}

const FIELDS = [
  { value: 'owner',     label: 'Parent company / owner' },
  { value: 'date',      label: 'Acquisition date' },
  { value: 'share_pct', label: 'Ownership percentage' },
  { value: 'name',      label: 'Entity name' },
  { value: 'region',    label: 'Region' },
  { value: 'other',     label: 'Something else' },
]

export default function SubmissionForm({ type, entityId, entityName, onClose }: Props) {
  const [field,          setField]          = useState('')
  const [currentValue,   setCurrentValue]   = useState('')
  const [proposedValue,  setProposedValue]  = useState('')
  const [notes,          setNotes]          = useState('')
  const [email,          setEmail]          = useState('')
  const [status,         setStatus]         = useState<'idle'|'submitting'|'success'|'error'>('idle')
  const [errorMsg,       setErrorMsg]       = useState('')

  async function handleSubmit() {
    if (type === 'correction' && !field) { setErrorMsg('Please select which field is incorrect.'); return }
    if (type === 'suggestion' && !notes) { setErrorMsg('Please describe the entity you want to suggest.'); return }

    setStatus('submitting')
    setErrorMsg('')

    try {
      const res = await fetch('/api/submissions', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type,
          entity_id:       entityId       || null,
          field:           field          || null,
          current_value:   currentValue   || null,
          proposed_value:  proposedValue  || null,
          notes:           notes          || null,
          submitter_email: email          || null,
        }),
      })

      const data = await res.json()
      if (!res.ok) { setStatus('error'); setErrorMsg(data.error || 'Something went wrong.'); return }
      setStatus('success')
    } catch {
      setStatus('error')
      setErrorMsg('Network error — please try again.')
    }
  }

  if (status === 'success') {
    return (
      <div className={styles.success}>
        <div className={styles.successIcon}>✓</div>
        <div className={styles.successTitle}>Thank you</div>
        <div className={styles.successDesc}>
          Your {type === 'correction' ? 'correction' : 'suggestion'} has been received and will be reviewed.
        </div>
        {onClose && (
          <button className={styles.closeBtn} onClick={onClose}>Close</button>
        )}
      </div>
    )
  }

  return (
    <div className={styles.form}>
      {type === 'correction' && entityName && (
        <div className={styles.entityLabel}>
          Reporting a correction for <span>{entityName}</span>
        </div>
      )}

      {type === 'correction' && (
        <>
          <div className={styles.field}>
            <label className={styles.label}>What is incorrect? *</label>
            <select
              className={styles.select}
              value={field}
              onChange={e => setField(e.target.value)}
            >
              <option value="">Select a field...</option>
              {FIELDS.map(f => (
                <option key={f.value} value={f.value}>{f.label}</option>
              ))}
            </select>
          </div>

          <div className={styles.fieldRow}>
            <div className={styles.field}>
              <label className={styles.label}>Current value shown</label>
              <input
                className={styles.input}
                type="text"
                placeholder="What the site shows..."
                value={currentValue}
                onChange={e => setCurrentValue(e.target.value)}
              />
            </div>
            <div className={styles.field}>
              <label className={styles.label}>Correct value</label>
              <input
                className={styles.input}
                type="text"
                placeholder="What it should be..."
                value={proposedValue}
                onChange={e => setProposedValue(e.target.value)}
              />
            </div>
          </div>
        </>
      )}

      {type === 'suggestion' && (
        <div className={styles.field}>
          <label className={styles.label}>Entity to add *</label>
          <input
            className={styles.input}
            type="text"
            placeholder="e.g. Innocent Drinks, owned by Coca-Cola since 2013"
            value={notes}
            onChange={e => setNotes(e.target.value)}
          />
        </div>
      )}

      <div className={styles.field}>
        <label className={styles.label}>
          {type === 'correction' ? 'Additional notes' : 'Supporting links or context'}
        </label>
        <textarea
          className={styles.textarea}
          placeholder={type === 'correction'
            ? 'Any additional context, source links, etc.'
            : 'Any links to sources, annual reports, news articles...'
          }
          value={type === 'correction' ? notes : ''}
          onChange={e => type === 'correction' ? setNotes(e.target.value) : null}
          rows={3}
        />
      </div>

      <div className={styles.field}>
        <label className={styles.label}>Your email (optional)</label>
        <input
          className={styles.input}
          type="email"
          placeholder="In case we need to follow up"
          value={email}
          onChange={e => setEmail(e.target.value)}
        />
      </div>

      {errorMsg && <div className={styles.error}>{errorMsg}</div>}

      <div className={styles.actions}>
        {onClose && (
          <button className={styles.cancelBtn} onClick={onClose}>Cancel</button>
        )}
        <button
          className={styles.submitBtn}
          onClick={handleSubmit}
          disabled={status === 'submitting'}
        >
          {status === 'submitting' ? 'Submitting...' : 'Submit'}
        </button>
      </div>
    </div>
  )
}