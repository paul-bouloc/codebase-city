import type { GuideLabel } from '../../city/interaction/city-items'
import { CityMarker } from '../tooltips/CityMarker'
import styles from './GuideLabels.module.css'

interface GuideLabelsProps {
  /** Where each label's foot stands on the page, as the city tells it. */
  labels: readonly GuideLabel[]
  /** What each labelled file's label says after its name, by path. */
  notes: ReadonlyMap<string, string>
}

// The labels of the guide's step over their roofs: "main.ts · entry point".
export function GuideLabels({ labels, notes }: GuideLabelsProps) {
  return labels.map(({ path, x, y }) => (
    <div key={path} className={styles.label} style={{ left: x, top: y }} aria-hidden="true">
      <CityMarker
        kind="guide"
        name={path.slice(path.lastIndexOf('/') + 1)}
        note={notes.get(path) ?? ''}
      />
    </div>
  ))
}
