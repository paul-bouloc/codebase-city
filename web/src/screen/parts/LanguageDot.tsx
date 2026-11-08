import type { Language } from '../../data/file-kinds'
import styles from './LanguageDot.module.css'

interface LanguageDotProps {
  // `test` for test files, drawn in their own colour in the city.
  language: Language | 'test'
  size: 8 | 10
}

// A language's colour, always next to its name: decorative.
export function LanguageDot({ language, size }: LanguageDotProps) {
  return (
    <span
      className={`${styles.dot} ${size === 8 ? styles.small : styles.large}`}
      data-language={language}
      aria-hidden="true"
    />
  )
}
