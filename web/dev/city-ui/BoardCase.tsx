import type { ReactNode } from 'react'
import styles from './BoardCase.module.css'

interface BoardCaseProps {
  label: string
  wide?: boolean
  framed?: boolean
  children: ReactNode
}

export function BoardCase({ label, wide = false, framed = false, children }: BoardCaseProps) {
  const classes = [styles.case, wide && styles.wide].filter(Boolean).join(' ')
  return (
    <figure className={classes}>
      <figcaption className="eyebrow-mono">{label}</figcaption>
      <div className={framed ? `${styles.sea} ${styles.frame}` : styles.sea}>{children}</div>
    </figure>
  )
}
