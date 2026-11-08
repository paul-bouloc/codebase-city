import { Icon } from '../../ui/Icon'
import styles from './UnanalyzedNote.module.css'

interface UnanalyzedNoteProps {
  // The first sentence, in bold: "PowerShell isn't analyzed yet."
  title: string
  // What the city keeps and shows without the analysis.
  body: string
}

// The neutral box of a file or folder whose language has no analyzer.
export function UnanalyzedNote({ title, body }: UnanalyzedNoteProps) {
  return (
    <p className={styles.note}>
      <Icon name="info" size={20} className={styles.icon} />
      <span>
        <strong>{title}</strong> {body}
      </span>
    </p>
  )
}
