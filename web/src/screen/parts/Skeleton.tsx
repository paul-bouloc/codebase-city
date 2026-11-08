import type { CSSProperties } from 'react'
import styles from './Skeleton.module.css'

interface SkeletonProps {
  // CSS lengths: "100%", "120px".
  width: string
  height: string
}

// A placeholder block while details load. Decorative: the panel says it is loading.
export function Skeleton({ width, height }: SkeletonProps) {
  const size: CSSProperties = { width, height }
  return <span className={styles.skeleton} style={size} aria-hidden="true" />
}
