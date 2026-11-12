import { useEffect, useLayoutEffect, useState } from 'react'
import type { AreaLabel } from '../../city/interaction/city-items'
import styles from './AreaLabels.module.css'
import { type AreaLabelLayer, placeAt } from './area-label-layer'

/** A label the city stops showing fades out over this many ms. */
const FADE_MS = 150

interface AreaLabelsProps {
  /** Where the city stands its labels: it moves them itself, React draws each new set. */
  layer: AreaLabelLayer
  /** The folder selected, if any: its label takes an ink rim. */
  selected: string | null
}

// The names of islands and folders over the city. The city places them and takes their clicks:
// they let the pointer through to it.
export function AreaLabels({ layer, selected }: AreaLabelsProps) {
  const [labels, setLabels] = useState<readonly AreaLabel[]>([])
  const [leaving, setLeaving] = useState<readonly AreaLabel[]>([])
  useEffect(
    () =>
      layer.connect((next, gone) => {
        setLabels(next)
        const back = new Set(next.map((label) => label.path))
        const goneNow = new Set(gone.map((label) => label.path))
        setLeaving((now) => [
          ...now.filter((label) => !back.has(label.path) && !goneNow.has(label.path)),
          ...gone,
        ])
        // Their timers outlive the sets that follow: the camera may keep moving while they fade.
        if (gone.length > 0) {
          window.setTimeout(() => {
            setLeaving((now) => now.filter((label) => !gone.includes(label)))
          }, FADE_MS)
        }
      }),
    [layer],
  )
  // A set just drawn stands where the city last said, before the page shows it.
  useLayoutEffect(() => {
    layer.position()
  })
  return (
    <>
      {leaving.map((label) => (
        <Label key={`leaving:${label.path}`} label={label} selected={false} />
      ))}
      {labels.map((label) => (
        <Label
          key={label.path}
          label={label}
          selected={label.path === selected}
          moved={(element) => layer.element(label.path, element)}
        />
      ))}
    </>
  )
}

/**
 * A label: one on show is moved by the layer, through `moved`; one fading out stands where it
 * last stood.
 */
function Label({
  label,
  selected,
  moved,
}: {
  label: AreaLabel
  selected: boolean
  moved?: (element: HTMLDivElement | null) => void
}) {
  const leaving = moved === undefined
  const classes = [
    styles.label,
    label.island ? styles.island : styles.parcel,
    styles[label.lean],
    selected ? styles.selected : '',
    leaving ? styles.leaving : '',
  ]
  // The anchor stands on the page; the label runs from it, out to the sea.
  return (
    <div
      ref={moved}
      className={styles.anchor}
      style={leaving ? { transform: placeAt(label.x, label.y) } : undefined}
      title={label.path}
      aria-hidden="true"
    >
      <div className={classes.join(' ')}>
        {label.caption !== null && <span className={styles.caption}>{label.caption}</span>}
        <span className={styles.name}>{label.name}</span>
      </div>
    </div>
  )
}
