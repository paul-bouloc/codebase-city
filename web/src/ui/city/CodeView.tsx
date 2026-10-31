import { type CSSProperties, useEffect, useRef } from 'react'
import { Button } from '../Button'
import { ExternalLink } from '../ExternalLink'
import { InlineAlert } from '../InlineAlert'
import { LinkButton } from '../LinkButton'
import { ScrollArea } from '../ScrollArea'
import styles from './CodeView.module.css'
import { safeGithubHref } from './github-links'
import { Skeleton } from './Skeleton'
import type { CodeState } from './sheet-data'

const numbers = new Intl.NumberFormat('en-US')

const TEXT = {
  label: 'Code',
  partial: (shown: number, total: number) =>
    `Showing lines 1–${numbers.format(shown)} of ${numbers.format(total)}.`,
  all: (total: number) => `All ${numbers.format(total)} ${total === 1 ? 'line' : 'lines'}.`,
  openFull: 'Open the full file on GitHub',
  errorTitle: 'The code couldn’t be loaded from GitHub.',
  errorCause: {
    timeout:
      'GitHub didn’t answer in time. Everything else on this sheet comes from the analysis and is still accurate.',
    gone: 'This file isn’t on GitHub at the analyzed commit anymore. Everything else on this sheet comes from the analysis and is still accurate.',
  },
  beyond: (line: number) => `Line ${numbers.format(line)} is past the lines shown here.`,
  openLine: (line: number) => `Open line ${numbers.format(line)} on GitHub`,
  retry: 'Try again',
  github: 'Open on GitHub',
}

// Line height of the code, in px: the CSS draws it and the highlight lines up with it.
const LINE_HEIGHT = 19

const SKELETON_LINES = ['70%', '45%', '85%', '60%', '30%', '75%']

interface CodeViewProps {
  code: CodeState
  githubUrl: string
  onRetry: () => void
  // A symbol's line: scrolled to and highlighted.
  line?: number
}

// The start of the file, read from GitHub at the analyzed commit, up to the limit (2,000 lines
// or 200 KB); beyond it, a link. Line numbers are left out of what screen readers read.
export function CodeView({ code, githubUrl, onRetry, line }: CodeViewProps) {
  const githubHref = safeGithubHref(githubUrl)
  const textRef = useRef<HTMLPreElement>(null)
  const regionRef = useRef<HTMLDivElement>(null)
  const shownLines = code.status === 'ready' ? code.lines.length : 0
  const target = line !== undefined && line <= shownLines ? line : undefined

  // Brings the line into the sheet's view, a few lines from the top.
  useEffect(() => {
    const text = textRef.current
    // The first ancestor that really scrolls up and down: the code itself only scrolls sideways
    // (its `overflow-y` computes to `auto` all the same).
    let scroller = text?.parentElement ?? null
    while (
      scroller &&
      !(
        getComputedStyle(scroller).overflowY === 'auto' &&
        scroller.scrollHeight > scroller.clientHeight
      )
    ) {
      scroller = scroller.parentElement
    }
    if (target === undefined || !text || !scroller) {
      return
    }
    const textTop = text.getBoundingClientRect().top - scroller.getBoundingClientRect().top
    scroller.scrollTop += textTop + (target - 3) * LINE_HEIGHT
  }, [target])

  // A symbol was chosen: its button is gone with the Symbols tab, the focus goes to the code.
  useEffect(() => {
    if (line !== undefined) {
      regionRef.current?.focus({ preventScroll: true })
    }
  }, [line])

  if (code.status === 'loading') {
    return (
      <div className={styles.loading}>
        {SKELETON_LINES.map((width, index) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: fixed placeholder lines
          <Skeleton key={index} width={width} height="12px" />
        ))}
      </div>
    )
  }

  if (code.status === 'error') {
    return (
      <div role="alert">
        <InlineAlert
          tone="error"
          title={TEXT.errorTitle}
          action={
            <span className={styles.errorActions}>
              <Button variant="secondary" icon="refresh" onClick={onRetry}>
                {TEXT.retry}
              </Button>
              {githubHref && (
                <LinkButton href={githubHref} icon="external" newTab>
                  {TEXT.github}
                </LinkButton>
              )}
            </span>
          }
        >
          {TEXT.errorCause[code.cause]}
        </InlineAlert>
      </div>
    )
  }

  const shown = code.lines.length
  return (
    <div className={styles.code}>
      <ScrollArea
        ref={regionRef}
        as="section"
        className={styles.frame}
        aria-label={TEXT.label}
        // Focusable, so the keyboard can scroll it sideways.
        tabIndex={0}
        style={{ '--line-height': `${LINE_HEIGHT}px` } as CSSProperties}
      >
        {/* As wide as the longest line, so the highlight spans it whatever the scroll. */}
        <div className={styles.lines}>
          {target !== undefined && (
            <span
              className={styles.highlight}
              style={{ '--line-index': target - 1 } as CSSProperties}
              aria-hidden="true"
            />
          )}
          <pre className={styles.gutter} aria-hidden="true">
            {code.lines.map((_, index) => index + 1).join('\n')}
          </pre>
          <pre ref={textRef} className={styles.text}>
            {code.lines.join('\n')}
          </pre>
        </div>
      </ScrollArea>
      {line !== undefined && target === undefined && (
        <p className={styles.footer}>
          {TEXT.beyond(line)}{' '}
          {githubHref && (
            <ExternalLink href={`${githubHref}#L${Math.trunc(line)}`}>
              {TEXT.openLine(line)}
            </ExternalLink>
          )}
        </p>
      )}
      <p className={styles.footer}>
        {shown < code.totalLines ? (
          <>
            {TEXT.partial(shown, code.totalLines)}{' '}
            {githubHref && <ExternalLink href={githubHref}>{TEXT.openFull}</ExternalLink>}
          </>
        ) : (
          TEXT.all(code.totalLines)
        )}
      </p>
    </div>
  )
}
