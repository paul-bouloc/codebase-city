import { type KeyboardEvent, useEffect, useId } from 'react'
import { Button } from '../../ui/actions/Button'
import { ExternalLink } from '../../ui/actions/ExternalLink'
import { Icon } from '../../ui/brand/Icon'
import { exactCount, percent } from '../../ui/display/count-format'
import { ScrollArea } from '../../ui/display/ScrollArea'
import { InlineAlert } from '../../ui/feedback/InlineAlert'
import { safeGithubHref } from '../github-links'
import { LanguageBar } from '../legend/LanguageBar'
import { LANGUAGE_NAMES } from '../legend/legend-content'
import { ControlHint } from '../parts/ControlHint'
import { Glass } from '../parts/Glass'
import { LanguageDot } from '../parts/LanguageDot'
import { SheetSection } from '../sheets/SheetSection'
import type { AboutData } from '../sheets/sheet-data'
import { usePanelFocus } from '../sheets/use-panel-focus'
import styles from './AboutPanel.module.css'

const TEXT = {
  title: 'About this repository',
  close: 'Close',
  closeKey: 'Esc',
  analyzed: (count: number) => (count === 1 ? 'file analyzed' : 'files analyzed'),
  skipped: (count: number) => (count === 1 ? 'file skipped' : 'files skipped'),
  generated: (count: number) =>
    `${exactCount(count)} generated ${count === 1 ? 'file' : 'files'}, shown but left out of the tour`,
  whySkipped: (count: number) => `Why ${exactCount(count)} ${count === 1 ? 'was' : 'were'} skipped`,
  languages: 'Languages',
  files: (count: number) => `${exactCount(count)} ${count === 1 ? 'file' : 'files'}`,
  imports: 'Imports',
  // Never "100%" while one import is left unresolved.
  resolved: (share: number) => percent(share),
  resolvedRest: ' of imports resolved to a file',
  noFlows:
    'No language in this repository is analyzed yet, so the city draws no flows between files.',
  unanalyzed: (name: string, count: number) =>
    `${exactCount(count)} ${name} ${count === 1 ? 'file' : 'files'}`,
  unanalyzedRest: ' shown without dependencies',
  unanalyzedWhy: (name: string) => ` · ${name} imports aren’t resolved yet`,
  commit: 'Commit',
  analyzedAt: 'Analyzed',
  analyzer: 'Analyzer',
  newer: (commits: number | null) =>
    commits === null
      ? 'The repository has changed since.'
      : `The repository has ${exactCount(commits)} new ${commits === 1 ? 'commit' : 'commits'}.`,
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
  // Esc, the close button or a click outside. After Esc or the button, the focus goes back to
  // the repository button; after a click outside, it stays where the click put it.
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

  const commitHref = safeGithubHref(about.commitUrl)
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
        <ControlHint text={TEXT.close} shortcut={TEXT.closeKey} side="bottom-end" describes={false}>
          {() => (
            <Button
              variant="ghost"
              iconOnly
              icon="close"
              label={TEXT.close}
              aria-keyshortcuts="Escape"
              onClick={onClose}
            />
          )}
        </ControlHint>
      </div>

      <ScrollArea className={styles.scroll} viewportClassName={styles.content}>
        {newer && <NewerLine newer={newer} />}

        <div className={styles.tiles}>
          <p className={`${styles.tile} ${styles.analyzedTile}`}>
            <span className={styles.tileValue}>{exactCount(about.analyzedFiles)}</span>
            {TEXT.analyzed(about.analyzedFiles)}
          </p>
          <p className={`${styles.tile} ${styles.skippedTile}`}>
            <span className={styles.tileValue}>{exactCount(skipped)}</span>
            {TEXT.skipped(skipped)}
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
                  <dd>{exactCount(files)}</dd>
                </div>
              ))}
            </dl>
          </details>
        )}

        {languages.length > 0 && (
          <SheetSection title={TEXT.languages}>
            <LanguageBar languages={languages} />
            <ul className={styles.languages}>
              {languages.map(({ language, files, share }) => (
                <li key={language} className={styles.language}>
                  <LanguageDot language={language} size={8} />
                  <span>
                    {LANGUAGE_NAMES[language]}{' '}
                    <span className={styles.secondary}>· {TEXT.files(files)}</span>
                  </span>
                  <span className={styles.share}>{percent(share)}</span>
                </li>
              ))}
            </ul>
          </SheetSection>
        )}

        <SheetSection title={TEXT.imports}>
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
        </SheetSection>

        <dl className={styles.card}>
          <dt>{TEXT.commit}</dt>
          <dd>
            {commitHref ? (
              <ExternalLink className={styles.commit} href={commitHref}>
                {about.commit}
              </ExternalLink>
            ) : (
              <span className={styles.commit}>{about.commit}</span>
            )}
            {about.branch && ` · ${about.branch}`}
          </dd>
          {about.analyzedAt && (
            <>
              <dt>{TEXT.analyzedAt}</dt>
              <dd>
                {about.analyzedAt}
                {about.analyzedAgo && ` · ${about.analyzedAgo}`}
              </dd>
            </>
          )}
          <dt>{TEXT.analyzer}</dt>
          <dd className={styles.mono}>{about.analyzer}</dd>
        </dl>
      </ScrollArea>
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
