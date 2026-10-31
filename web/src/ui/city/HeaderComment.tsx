import { useId, useState } from 'react'
import styles from './HeaderComment.module.css'

const TEXT = {
  title: 'Header comment',
  more: (count: number) => `Show ${count} more ${count === 1 ? 'line' : 'lines'}`,
  fewer: 'Show fewer lines',
}

// Lines shown while folded.
const FOLDED_LINES = 12

interface HeaderCommentProps {
  // The file's first comment, verbatim: never reformatted, never interpreted.
  text: string
  defaultExpanded?: boolean
}

export function HeaderComment({ text, defaultExpanded = false }: HeaderCommentProps) {
  const [expanded, setExpanded] = useState(defaultExpanded)
  const titleId = useId()
  const blockId = useId()
  const lines = text.split('\n')
  const hidden = lines.length - FOLDED_LINES
  const shown = expanded || hidden <= 0 ? lines : lines.slice(0, FOLDED_LINES)

  return (
    <section aria-labelledby={titleId} className={styles.section}>
      <h3 id={titleId} className={styles.title}>
        {TEXT.title}
      </h3>
      <pre id={blockId} className={styles.comment}>
        {shown.join('\n')}
      </pre>
      {hidden > 0 && (
        <button
          type="button"
          className={styles.toggle}
          aria-expanded={expanded}
          aria-controls={blockId}
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? TEXT.fewer : TEXT.more(hidden)}
        </button>
      )}
    </section>
  )
}
