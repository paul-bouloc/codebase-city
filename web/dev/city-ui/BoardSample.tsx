import type { ReactNode } from 'react'
import styles from './BoardSample.module.css'

interface BoardSampleProps {
  title: string
  children: ReactNode
}

export function BoardSample({ title, children }: BoardSampleProps) {
  return (
    <section className={styles.sample}>
      <h2 className="heading-2">{title}</h2>
      <div className={styles.cases}>{children}</div>
    </section>
  )
}
