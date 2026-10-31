import { type KeyboardEvent, type ReactNode, useEffect, useId } from 'react'
import { Button } from '../Button'
import { Icon } from '../Icon'
import { InlineAlert } from '../InlineAlert'
import styles from './AboutPanel.module.css'
import { ControlHint } from './ControlHint'
import { Glass } from './Glass'
import { LanguageBar } from './LanguageBar'
import { formatShare, LANGUAGE_NAMES } from './legend-content'
import type { AboutData } from './sheet-data'
import { usePanelFocus } from './use-panel-focus'

const numbers = new Intl.NumberFormat('en-US')

const TEXT = {
  title: 'About this repository',
  close: 'Close',
  closeKey: 'Esc',
  analyzed: 'files analyzed',
  skipped: 'files skipped',
  generated: (count: number) =>
    `${numbers.format(count)} generated ${count === 1 ? 'file' : 'files'}, shown but left out of the tour`,
  whySkipped: (count: number) => `Why ${numbers.format(count)} were skipped`,
  languages: 'Languages',
  files: (count: number) => `${numbers.format(count)} ${count === 1 ? 'file' : 'files'}`,
  imports: 'Imports',
  resolved: (share: number) => `${Math.round(share * 100)}%`,
  resolvedRest: ' of imports resolved to a file',
  noFlows:
    'No language in this repository is analyzed yet, so the city draws no flows between files.',
  unanalyzed: (name: string, count: number) =>
    `${numbers.format(count)} ${name} ${count === 1 ? 'file' : 'files'}`,
  unanalyzedRest: ' shown without dependencies',
  unanalyzedWhy: (name: string) => ` · ${name} imports aren’t resolved yet`,
  commit: 'Commit',
  analyzedAt: 'Analyzed',
  analyzer: 'Analyzer',
  newer: (commits: number | null) =>
    commits === null
      ? 'The repository has changed since.'
      : `The repository has ${numbers.format(commits)} new ${commits === 1 ? 'commit' : 'commits'}.`,
  rebuild: 'Rebuild with the latest commit',
  signInNote: 'Rebuilding uses 1 analysis and needs a GitHub sign-in.',
  signIn: 'Sign in with GitHub to rebuild',
}

// The same line as the rebuild banner, which stays here once the banner is closed.
export interface NewerVersion {
  // Null when GitHub does not say how far ahead the repository is.
  commits: number | null
  signedIn: boolean
  // "Rebuilding uses 1 analysis · 7 left today."
  quotaNote: string
  onRebuild: () => void
  onSignIn: () => void
}

interface AboutPanelProps {
  // Given to the repository button's `aria-controls`.
  id: string
  open: boolean
  about: AboutData
  newer?: NewerVersion
  // Esc, the close button or a click outside. The focus goes back to the repository button.
  onClose: () => void
}

// A popover, not a page: the city stays visible and interactive behind it.
export function AboutPanel({ id, open, about, newer, onClose }: AboutPanelProps) {
  const titleId = useId()
  const { panelRef, titleRef } = usePanelFocus<HTMLDivElement, HTMLHeadingElement>(open)

  // A click outside closes it, except on the button that toggles it.
  useEffect(() => {
    if (!open) {
      return
    }
    const handlePointer = (event: PointerEvent) => {
      const target = event.target as Element | null
      if (panelRef.current?.contains(target) || target?.closest(`[aria-controls="${id}"]`)) {
        return
      }
      onClose()
    }
    document.addEventListener('pointerdown', handlePointer)
    return () => document.removeEventListener('pointerdown', handlePointer)
  }, [open, id, onClose, panelRef])

  const handleEscape = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      onClose()
    }
  }

  const skipped = about.skipped.reduce((sum, { files }) => sum + files, 0)
  const languageFiles = about.languages.reduce((sum, { files }) => sum + files, 0)
  const languages = [...about.languages]
    .sort(
      (a, b) =>
        Number(a.language === 'other') - Number(b.language === 'other') || b.files - a.files,
    )
    .map((entry) => ({ ...entry, share: languageFiles > 0 ? entry.files / languageFiles : 0 }))

  return (
    <Glass
      ref={panelRef}
      id={id}
      role="dialog"
      aria-labelledby={titleId}
      className={open ? `${styles.panel} ${styles.open}` : styles.panel}
      inert={!open}
      onKeyDown={handleEscape}
    >
      <div className={styles.header}>
        <h2 ref={titleRef} id={titleId} className={styles.title} tabIndex={-1}>
          {TEXT.title}
        </h2>
        <ControlHint text={TEXT.close} shortcut={TEXT.closeKey} side="bottom-end">
          {(hintId) => (
            <Button
              variant="ghost"
              iconOnly
              icon="close"
              label={TEXT.close}
              aria-describedby={hintId}
              aria-keyshortcuts="Escape"
              onClick={onClose}
            />
          )}
        </ControlHint>
      </div>

      {newer && <NewerLine newer={newer} />}

      <div className={styles.tiles}>
        <p className={`${styles.tile} ${styles.analyzedTile}`}>
          <span className={styles.tileValue}>{numbers.format(about.analyzedFiles)}</span>
          {TEXT.analyzed}
        </p>
        <p className={`${styles.tile} ${styles.skippedTile}`}>
          <span className={styles.tileValue}>{numbers.format(skipped)}</span>
          {TEXT.skipped}
        </p>
      </div>
      {about.generatedFiles > 0 && (
        <p className={styles.note}>{TEXT.generated(about.generatedFiles)}</p>
      )}

      {skipped > 0 && (
        <details className={styles.details}>
          <summary className={styles.summary}>{TEXT.whySkipped(skipped)}</summary>
          <dl className={styles.reasons}>
            {about.skipped.map(({ reason, files }) => (
              <div key={reason} className={styles.reason}>
                <dt>{reason}</dt>
                <dd>{numbers.format(files)}</dd>
              </div>
            ))}
          </dl>
        </details>
      )}

      {languages.length > 0 && (
        <Section title={TEXT.languages}>
          <LanguageBar languages={languages} />
          <ul className={styles.languages}>
            {languages.map(({ language, files, share }) => (
              <li key={language} className={styles.language}>
                <span className={styles.dot} data-language={language} />
                <span>
                  {LANGUAGE_NAMES[language]}{' '}
                  <span className={styles.secondary}>· {TEXT.files(files)}</span>
                </span>
                <span className={styles.share}>{formatShare(share)}</span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      <Section title={TEXT.imports}>
        <ul className={styles.facts}>
          {about.resolvedImports === undefined ? (
            <li className={styles.fact}>
              <Icon name="info" size={16} className={styles.infoIcon} />
              <span>{TEXT.noFlows}</span>
            </li>
          ) : (
            <li className={styles.fact}>
              <Icon name="check" size={16} className={styles.checkIcon} />
              <span>
                <strong>{TEXT.resolved(about.resolvedImports)}</strong>
                {TEXT.resolvedRest}
              </span>
            </li>
          )}
          {about.unanalyzed.map(({ name, files }) => (
            <li key={name} className={styles.fact}>
              <Icon name="info" size={16} className={styles.infoIcon} />
              <span>
                <strong>{TEXT.unanalyzed(name, files)}</strong>
                {TEXT.unanalyzedRest}
                <span className={styles.secondary}>{TEXT.unanalyzedWhy(name)}</span>
              </span>
            </li>
          ))}
        </ul>
      </Section>

      <dl className={styles.card}>
        <dt>{TEXT.commit}</dt>
        <dd>
          <a className={styles.commit} href={about.commitUrl}>
            {about.commit}
          </a>{' '}
          · {about.branch}
        </dd>
        <dt>{TEXT.analyzedAt}</dt>
        <dd>
          {about.analyzedAt} · {about.analyzedAgo}
        </dd>
        <dt>{TEXT.analyzer}</dt>
        <dd className={styles.mono}>{about.analyzer}</dd>
      </dl>
    </Glass>
  )
}

function NewerLine({ newer }: { newer: NewerVersion }) {
  return (
    <InlineAlert
      tone="info"
      title={TEXT.newer(newer.commits)}
      action={
        newer.signedIn ? (
          <Button variant="primary" onClick={newer.onRebuild}>
            {TEXT.rebuild}
          </Button>
        ) : (
          <Button variant="github" icon="github" onClick={newer.onSignIn}>
            {TEXT.signIn}
          </Button>
        )
      }
    >
      {newer.signedIn ? newer.quotaNote : TEXT.signInNote}
    </InlineAlert>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className={styles.section} aria-label={title}>
      <h3 className={styles.eyebrow}>{title}</h3>
      {children}
    </section>
  )
}
