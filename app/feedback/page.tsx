import SubmissionForm from '@/components/SubmissionForm'
import styles from './FeedbackPage.module.css'

export const metadata = {
  title:       'Suggest an Entity — Ownership Explorer',
  description: 'Suggest a new brand, subsidiary, or company to add to the Ownership Explorer.',
}

export default function FeedbackPage() {
  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div className={styles.eyebrow}>Community</div>
        <h1 className={styles.title}>Suggest an Entity</h1>
        <p className={styles.desc}>
          Know of a brand, subsidiary, or company that should be here?
          Tell us who owns it, when it was acquired, and any sources you have.
          We review all suggestions and add verified ones to the database.
        </p>
      </div>
      <div className={styles.formWrap}>
        <SubmissionForm type="suggestion" />
      </div>
    </div>
  )
}