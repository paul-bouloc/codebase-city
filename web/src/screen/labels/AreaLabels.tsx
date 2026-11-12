import { useEffect, useRef, useState } from 'react'
import type { AreaLabel } from '../../city/interaction/city-items'
import styles from './AreaLabels.module.css'

/** A label the city stops showing fades out over this many ms. */
const FADE_MS = 150

interface AreaLabelsProps {
  /** The labels on show, as the city places them. */
  labels: readonly AreaLabel[]
  /** The folder selected, if any: its label takes an ink rim. */
  selected: string | null
}

// The names of islands and folders over the city. The city places them and takes their clicks:
// they let the pointer through to it.
export function AreaLabels({ labels, selected }: AreaLabelsProps) {
  const leaving = useLeaving(labels)
  return (
    <>
      {leaving.map((label) => (
        <Label key={`leaving:${label.path}`} label={label} selected={false} leaving />
      ))}
      {labels.map((label) => (
        <Label key={label.path} label={label} selected={label.path === selected} leaving={false} />
      ))}
    </>
  )
}

function Label({
  label,
  selected,
  leaving,
}: {
  label: AreaLabel
  selected: boolean
  leaving: boolean
}) {
  const classes = [
    styles.label,
    label.island ? styles.island : styles.parcel,
    styles[label.lean],
    selected ? styles.selected : '',
    leaving ? styles.leaving : '',
  ]
  return (
    <div
      className={classes.join(' ')}
      style={{ left: label.x, top: label.y }}
      title={label.path}
      aria-hidden="true"
    >
      {label.caption !== null && <span className={styles.caption}>{label.caption}</span>}
      <span className={styles.name}>{label.name}</span>
    </div>
  )
}

/**
 * The labels shown before and no longer, for as long as they fade out. Their timers outlive the
 * frames that follow: the camera may keep moving while they fade.
 */
function useLeaving(labels: readonly AreaLabel[]): AreaLabel[] {
  const previous = useRef<readonly AreaLabel[]>([])
  const [leaving, setLeaving] = useState<AreaLabel[]>([])
  useEffect(() => {
    const shown = new Set(labels.map((label) => label.path))
    const gone = previous.current.filter((label) => !shown.has(label.path))
    previous.current = labels
    const goneNow = new Set(gone.map((label) => label.path))
    setLeaving((now) => {
      const kept = now.filter((label) => !shown.has(label.path) && !goneNow.has(label.path))
      return gone.length === 0 && kept.length === now.length ? now : [...kept, ...gone]
    })
    if (gone.length > 0) {
      window.setTimeout(() => {
        setLeaving((now) => now.filter((label) => !gone.includes(label)))
      }, FADE_MS)
    }
  }, [labels])
  return leaving
}
