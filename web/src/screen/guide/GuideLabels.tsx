import type { GuideLabel } from '../../city/interaction/city-items'
import { truncateMiddle } from '../../ui/display/truncate-path'
import { CityMarker } from '../tooltips/CityMarker'
import styles from './GuideLabels.module.css'

/** The most characters of a file's name on the label of its impact: a long one loses its middle. */
const IMPACT_NAME = 32

interface GuideLabelsProps {
  /** Where each label's foot stands on the page, as the city tells it. */
  labels: readonly GuideLabel[]
  /** What each labelled file's label says after its name, by path. */
  notes: ReadonlyMap<string, string>
  /** The file whose impact is on show, and how many depend on it. */
  impact?: { path: string; dependents: number } | null
}

// The labels of the guide over their roofs: "main.ts · entry point", "nls.ts · 6,213 dependents".
export function GuideLabels({ labels, notes, impact }: GuideLabelsProps) {
  return labels.map(({ path, x, y }) => {
    const name = path.slice(path.lastIndexOf('/') + 1)
    return (
      <div key={path} className={styles.label} style={{ left: x, top: y }} aria-hidden="true">
        {impact?.path === path ? (
          <CityMarker
            kind="impact"
            name={truncateMiddle(name, IMPACT_NAME)}
            dependents={impact.dependents}
          />
        ) : (
          <CityMarker kind="guide" name={name} note={notes.get(path) ?? ''} />
        )}
      </div>
    )
  })
}
