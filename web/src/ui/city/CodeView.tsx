import { Button } from '../Button'
import { InlineAlert } from '../InlineAlert'
import { LinkButton } from '../LinkButton'
import styles from './CodeView.module.css'
import { Skeleton } from './Skeleton'
import type { CodeState } from './sheet-data'

const numbers = new Intl.NumberFormat('en-US')

const TEXT = {
  label: 'Code',
  loading: 'Loading the code',
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
  retry: 'Try again',
  github: 'Open on GitHub',
}

const SKELETON_LINES = ['70%', '45%', '85%', '60%', '30%', '75%']

interface CodeViewProps {
  code: CodeState
  githubUrl: string
  onRetry: () => void
}

// The start of the file, read from GitHub at the analyzed commit, up to the limit (2,000 lines
// or 200 KB); beyond it, a link. Line numbers are left out of what screen readers read.
export function CodeView({ code, githubUrl, onRetry }: CodeViewProps) {
  if (code.status === 'loading') {
    return (
      <div className={styles.loading} role="status">
        <span className="visually-hidden">{TEXT.loading}</span>
        {SKELETON_LINES.map((width, index) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: fixed placeholder lines
          <Skeleton key={index} width={width} height="12px" />
        ))}
      </div>
    )
  }

  if (code.status === 'error') {
    return (
      <div role="alert" className={styles.error}>
        <InlineAlert
          tone="error"
          title={TEXT.errorTitle}
          action={
            <span className={styles.errorActions}>
              <Button variant="secondary" icon="refresh" onClick={onRetry}>
                {TEXT.retry}
              </Button>
              <LinkButton href={githubUrl} icon="external">
                {TEXT.github}
              </LinkButton>
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
      {/* Focusable, so the keyboard can scroll it sideways. */}
      {/* biome-ignore lint/a11y/noNoninteractiveTabindex: a scrolling region must take the focus */}
      <section className={styles.scroll} aria-label={TEXT.label} tabIndex={0}>
        <pre className={styles.gutter} aria-hidden="true">
          {code.lines.map((_, index) => index + 1).join('\n')}
        </pre>
        <pre className={styles.text}>{code.lines.join('\n')}</pre>
      </section>
      <p className={styles.footer}>
        {shown < code.totalLines ? (
          <>
            {TEXT.partial(shown, code.totalLines)} <a href={githubUrl}>{TEXT.openFull}</a>
          </>
        ) : (
          TEXT.all(code.totalLines)
        )}
      </p>
    </div>
  )
}
