import { forwardRef } from 'react'
import { Button } from '../../../ui/actions/Button'
import { exactCount } from '../../../ui/display/count-format'
import type { SearchIndex } from '../../search/search-index'
import { FileField } from './FileField'
import styles from './ImpactPanel.module.css'
import type { Impact } from './impact'
import { impactText, otherIslandsText } from './impact-text'
import { QuestionPanel } from './QuestionPanel'

export const IMPACT_QUESTION = {
  title: 'What depends on this file?',
  subtitle: 'Everything that would feel a change',
}

const TEXT = {
  subtitle: 'Every file that imports it, directly or not',
  field: 'File',
  byIsland: 'By island',
  clear: 'Clear',
  choose: 'Choose a file to see every file that depends on it.',
}

interface ImpactPanelProps {
  /** The file asked about, by path; none while the field is empty. */
  file: string | null
  /** What depends on it, once there is one. */
  impact: Impact | null
  searchIndex: SearchIndex
  onChoose: (path: string | null) => void
  onBack: () => void
  onClear: () => void
  onCollapse: () => void
}

/** The answer to "What depends on this file?": how many, how, and on which islands. */
export const ImpactPanel = forwardRef<HTMLHeadingElement, ImpactPanelProps>(function ImpactPanel(
  { file, impact, searchIndex, onChoose, onBack, onClear, onCollapse },
  titleRef,
) {
  const name = file === null ? '' : file.slice(file.lastIndexOf('/') + 1)
  const text = impact && impactText(impact, name)
  const most = impact?.islands[0]?.count ?? 0
  return (
    <QuestionPanel
      ref={titleRef}
      title={IMPACT_QUESTION.title}
      subtitle={TEXT.subtitle}
      onBack={onBack}
      onCollapse={onCollapse}
    >
      <FileField label={TEXT.field} value={file} searchIndex={searchIndex} onChoose={onChoose} />
      <div aria-live="polite">
        {!text && <p className={styles.hint}>{TEXT.choose}</p>}
        {text?.none && <p className={styles.none}>{text.none}</p>}
        {text?.lead && (
          <div className={styles.result}>
            <p className={styles.lead}>
              {text.lead} <code className={styles.name}>{name}</code>
            </p>
            <p className={styles.detail}>{text.detail}</p>
          </div>
        )}
      </div>
      {impact && text?.lead && (
        <div className={styles.islands}>
          <h3 className={styles.eyebrow}>{TEXT.byIsland}</h3>
          <ul className={styles.rows}>
            {impact.islands.map((island) => (
              <li key={island.name} className={styles.row}>
                <span className={styles.island} title={island.name}>
                  {island.name}
                </span>
                <span className={styles.track}>
                  <span
                    className={styles.bar}
                    style={{ width: `${most > 0 ? (island.count / most) * 100 : 0}%` }}
                  />
                </span>
                <span className={island.count > 0 ? styles.count : styles.zero}>
                  {exactCount(island.count)}
                </span>
              </li>
            ))}
            {impact.otherIslands && (
              <li className={`${styles.row} ${styles.others}`}>
                <span className={styles.othersName}>
                  {otherIslandsText(impact.otherIslands.islands)}
                </span>
                <span className={styles.count}>{exactCount(impact.otherIslands.count)}</span>
              </li>
            )}
          </ul>
        </div>
      )}
      {file !== null && (
        <div className={styles.actions}>
          <Button variant="ghost" onClick={onClear}>
            {TEXT.clear}
          </Button>
        </div>
      )}
    </QuestionPanel>
  )
})
