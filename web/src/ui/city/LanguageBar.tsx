import type { CSSProperties } from 'react'
import type { Language } from '../Badge'
import styles from './LanguageBar.module.css'
import { formatShare, LANGUAGE_NAMES } from './legend-content'

const TEXT = {
  // Read aloud, "<1%" becomes words.
  share: (name: string, share: number) =>
    `${name} ${share > 0 && share < 0.005 ? 'under 1%' : formatShare(share)}`,
}

interface LanguageBarProps {
  // Shares of the files, from 0 to 1, the largest first.
  languages: readonly { language: Language; share: number }[]
}

// A 10 px bar split by language, read as one image: "TypeScript 96%, CSS 3%, …".
export function LanguageBar({ languages }: LanguageBarProps) {
  const label = languages
    .map(({ language, share }) => TEXT.share(LANGUAGE_NAMES[language], share))
    .join(', ')
  return (
    <span role="img" aria-label={label} className={styles.bar}>
      {languages.map(({ language, share }) => (
        <span
          key={language}
          className={styles.segment}
          data-language={language}
          style={{ '--share': share } as CSSProperties}
        />
      ))}
    </span>
  )
}
