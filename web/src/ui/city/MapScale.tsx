import { exactCount } from '../count-format'
import styles from './MapScale.module.css'

const TEXT = {
  value: (files: number) => `≈ ${exactCount(files)} ${files === 1 ? 'file' : 'files'}`,
  label: (files: number) =>
    `Scale: this bar spans about ${exactCount(files)} ${files === 1 ? 'file' : 'files'}`,
}

const CELLS = 4

interface MapScaleProps {
  // How many files the 96 px bar covers at the current zoom.
  files: number
}

// A sea chart scale, counted in files.
export function MapScale({ files }: MapScaleProps) {
  return (
    <div role="img" aria-label={TEXT.label(files)} className={styles.scale}>
      <span className={styles.bar} aria-hidden="true">
        {Array.from({ length: CELLS }, (_, index) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: fixed cells that never move
          <span key={index} className={styles.cell} />
        ))}
      </span>
      <span className={styles.value} aria-hidden="true">
        {TEXT.value(files)}
      </span>
    </div>
  )
}
