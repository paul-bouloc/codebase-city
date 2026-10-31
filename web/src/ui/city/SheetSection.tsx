import type { ReactNode } from 'react'
import styles from './SheetSection.module.css'

interface SheetSectionProps {
  // A mono eyebrow: "Key files", "Languages".
  title: string
  children: ReactNode
}

// A titled block in a sheet or in About. A heading, not a landmark: a sheet holds several.
export function SheetSection({ title, children }: SheetSectionProps) {
  return (
    <div className={styles.section}>
      <h3 className={styles.eyebrow}>{title}</h3>
      {children}
    </div>
  )
}
