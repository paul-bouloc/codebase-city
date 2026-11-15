import { forwardRef, type ReactNode } from 'react'
import { Icon } from '../../../ui/brand/Icon'
import { Glass } from '../../parts/Glass'
import { useContentHeight } from '../use-content-height'
import styles from './QuestionPanel.module.css'

const TEXT = {
  label: 'Guide',
  back: 'Back to questions',
  collapse: 'Collapse the guide',
}

interface QuestionPanelProps {
  title: string
  subtitle: string
  onBack: () => void
  onCollapse: () => void
  children: ReactNode
}

/** The answer to one of the guide's questions: the way back, the question, then the answer. */
export const QuestionPanel = forwardRef<HTMLHeadingElement, QuestionPanelProps>(
  function QuestionPanel({ title, subtitle, onBack, onCollapse, children }, titleRef) {
    // The panel eases from one height to the next: a file chosen, a list opened.
    const { boxRef, contentRef, height } = useContentHeight<HTMLDivElement, HTMLDivElement>()
    return (
      <Glass
        ref={boxRef}
        as="section"
        className={styles.panel}
        style={{ height }}
        aria-label={TEXT.label}
      >
        <div ref={contentRef} className={styles.content}>
          <div className={styles.head}>
            <button
              type="button"
              className={styles.icon}
              aria-label={TEXT.back}
              title={TEXT.back}
              onClick={onBack}
            >
              <Icon name="arrow-left" size={18} />
            </button>
            <div className={styles.words}>
              <h2 ref={titleRef} tabIndex={-1} className={styles.title}>
                {title}
              </h2>
              <span className={styles.subtitle}>{subtitle}</span>
            </div>
            <button
              type="button"
              className={styles.icon}
              aria-label={TEXT.collapse}
              aria-expanded={true}
              onClick={onCollapse}
            >
              <Icon name="chevron-down" size={18} />
            </button>
          </div>
          {children}
        </div>
      </Glass>
    )
  },
)
