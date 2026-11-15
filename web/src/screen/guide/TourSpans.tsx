import { IslandGlyph } from './IslandGlyph'
import styles from './TourSpans.module.css'
import { chipLabel } from './tour/tour-labels'
import { spanTarget, type TourSpan, type TourTarget } from './tour/tour-spans'

interface TourSpansProps {
  spans: readonly TourSpan[]
  repoName: string
  /** Chips fly where they lead; without it, they are names only (inside a button). */
  onChip?: (target: TourTarget) => void
}

/** A sentence of the tour: words, names, and chips that fly to what they name. */
export function TourSpans({ spans, repoName, onChip }: TourSpansProps) {
  return spans.map((span, at) => {
    // The spans of a step never move: their place is their key.
    const key = at
    if (typeof span === 'string') {
      return <span key={key}>{span}</span>
    }
    const { text, title } = chipLabel(span, repoName)
    if (span.kind === 'repo') {
      return (
        <strong key={key} className={styles.repo}>
          {text}
        </strong>
      )
    }
    if (span.kind === 'code') {
      return (
        <code key={key} className={styles.code}>
          {text}
        </code>
      )
    }
    const island = span.kind === 'island'
    const content = (
      <>
        {island && <IslandGlyph />}
        {text}
        {island && span.count !== null && <span className={styles.count}>×{span.count}</span>}
      </>
    )
    const classes = `${styles.chip} ${island ? styles.island : styles.path}`
    const target = spanTarget(span)
    if (!onChip || !target) {
      return (
        <span key={key} className={classes} title={title}>
          {content}
        </span>
      )
    }
    return (
      <button
        key={key}
        type="button"
        className={`${classes} ${styles.link}`}
        title={`Show ${title}`}
        onClick={() => onChip(target)}
      >
        {content}
      </button>
    )
  })
}
