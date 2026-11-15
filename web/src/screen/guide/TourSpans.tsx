import { Fragment, type ReactNode } from 'react'
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

/** Punctuation that never starts a line: it stays with the chip before it. */
const STICKY = /^[,.:;)]+/

/** A sentence of the tour: words, names, and chips that fly to what they name. */
export function TourSpans({ spans, repoName, onChip }: TourSpansProps) {
  return spans.map((span, at) => {
    // The spans of a step never move: their place is their key.
    const key = at
    if (typeof span === 'string') {
      // What sticks to a chip is drawn with it
      const before = spans[at - 1]
      const words =
        before === undefined || typeof before === 'string' ? span : span.replace(STICKY, '')
      return <span key={key}>{words}</span>
    }
    const after = spans[at + 1]
    const sticky = typeof after === 'string' ? (STICKY.exec(after)?.[0] ?? '') : ''
    const chip = chipOf(span, repoName, onChip)
    return sticky ? (
      <span key={key} className={styles.together}>
        {chip}
        {sticky}
      </span>
    ) : (
      <Fragment key={key}>{chip}</Fragment>
    )
  })
}

/** A name: the repository's or the code's, or a chip, which flies where it leads if it can. */
function chipOf(
  span: Exclude<TourSpan, string>,
  repoName: string,
  onChip: ((target: TourTarget) => void) | undefined,
): ReactNode {
  const { text, title } = chipLabel(span, repoName)
  if (span.kind === 'repo') {
    return <strong className={styles.repo}>{text}</strong>
  }
  if (span.kind === 'code') {
    return <code className={styles.code}>{text}</code>
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
      <span className={classes} title={title}>
        {content}
      </span>
    )
  }
  return (
    <button
      type="button"
      className={`${classes} ${styles.link}`}
      title={`Show ${title}`}
      onClick={() => onChip(target)}
    >
      {content}
    </button>
  )
}
