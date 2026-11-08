import type { FocusEvent, KeyboardEvent, ReactNode, Ref } from 'react'
import { AccountMenu } from '../ui/AccountMenu'
import { Button } from '../ui/Button'
import { CitySearchField } from '../ui/city/CitySearchField'
import { Icon } from '../ui/Icon'
import { Logo } from '../ui/Logo'
import { SegmentedControl, type SegmentedOption } from '../ui/SegmentedControl'
import styles from './CityTopBar.module.css'
import { safeGithubHref } from './github-links'
import { ControlHint } from './parts/ControlHint'
import { Glass } from './parts/Glass'

const TEXT = {
  home: 'Codebase City, home',
  about: 'About this repository',
  analyzed: (when: string) => ` · analyzed ${when}`,
  github: 'Open on GitHub',
  githubLabel: (repo: string, commit: string) =>
    `Open ${repo} at ${commit} on GitHub (opens in a new tab)`,
  mode: 'Building style',
  modeHint: 'Switch mode',
  modeShortcut: 'M',
  share: 'Share',
  signIn: 'Sign in',
}

export type BuildingMode = 'simplified' | 'realistic'

const MODES: SegmentedOption<BuildingMode>[] = [
  { value: 'simplified', label: 'Simplified', icon: 'mode-simplified' },
  { value: 'realistic', label: 'Realistic', icon: 'mode-realistic' },
]

export interface CityRepo {
  owner: string
  name: string
  // Short hash of the analysed commit.
  commit: string
  // "2 days ago"; absent until the screen knows when the analysis ran.
  analyzed?: string
  // The repository at that commit.
  githubUrl: string
}

export interface CityAccount {
  login: string
  avatarSrc?: string
  quota?: string
  accountHref: string
  onSignOut: () => void
}

interface CityTopBarProps {
  repo: CityRepo
  homeHref: string
  aboutOpen: boolean
  onAboutToggle: () => void
  // Given once the About panel exists, so `aria-controls` never points at nothing.
  aboutPanelId?: string
  // The controls below show only once their feature exists: search, building style, share and
  // account each come with their own handler.
  searchValue?: string
  onSearchChange?: (value: string) => void
  searchExpanded?: boolean
  searchListboxId?: string
  searchActiveDescendant?: string
  searchInputRef?: Ref<HTMLInputElement>
  // Keys pressed in the field or in its results.
  onSearchKeyDown?: (event: KeyboardEvent) => void
  onSearchClick?: () => void
  // The focus coming into the search (field or results), and leaving it.
  onSearchFocus?: (event: FocusEvent) => void
  onSearchBlur?: (event: FocusEvent) => void
  // The results, hung under the field.
  searchPalette?: ReactNode
  // Until the search index has arrived.
  searchDisabled?: boolean
  mode?: BuildingMode
  onModeChange?: (mode: BuildingMode) => void
  // While the city is building.
  modeDisabled?: boolean
  // The text fallback view has no building style.
  showMode?: boolean
  shareOpen?: boolean
  onShareToggle?: () => void
  sharePanelId?: string
  // Null for a visitor: looking at a city never needs an account.
  account?: CityAccount | null
  onSignIn?: () => void
}

// Floats over the city. No quota chip here: the city is for looking, not building.
export function CityTopBar({
  repo,
  homeHref,
  aboutOpen,
  onAboutToggle,
  aboutPanelId,
  searchValue = '',
  onSearchChange,
  searchExpanded,
  searchListboxId,
  searchActiveDescendant,
  searchInputRef,
  onSearchKeyDown,
  onSearchClick,
  onSearchFocus,
  onSearchBlur,
  searchPalette,
  searchDisabled = false,
  mode = 'simplified',
  onModeChange,
  modeDisabled = false,
  showMode = true,
  shareOpen = false,
  onShareToggle,
  sharePanelId,
  account = null,
  onSignIn,
}: CityTopBarProps) {
  const fullName = `${repo.owner}/${repo.name}`
  const githubHref = safeGithubHref(repo.githubUrl)

  return (
    <Glass as="header" className={styles.bar}>
      <a href={homeHref} className={styles.home} aria-label={TEXT.home}>
        <Logo variant="mark" size={32} />
      </a>
      <span className={styles.rule} aria-hidden="true" />

      <ControlHint text={TEXT.about}>
        {(hintId) => (
          <button
            type="button"
            className={styles.repo}
            aria-haspopup="dialog"
            aria-expanded={aboutOpen}
            aria-controls={aboutOpen ? aboutPanelId : undefined}
            aria-describedby={hintId}
            onClick={onAboutToggle}
          >
            <span className={styles.repoText}>
              <span className={styles.repoName}>
                <span className={styles.owner}>{repo.owner}/</span>
                <strong>{repo.name}</strong>
              </span>
              <span className={styles.repoMeta}>
                <span className={styles.commit}>{repo.commit}</span>
                {repo.analyzed && TEXT.analyzed(repo.analyzed)}
              </span>
            </span>
            <Icon name="chevron-down" size={16} className={styles.chevron} />
          </button>
        )}
      </ControlHint>

      {githubHref && (
        <ControlHint text={TEXT.github} describes={false}>
          {() => (
            <a
              href={githubHref}
              target="_blank"
              rel="noopener noreferrer"
              className={styles.github}
              aria-label={TEXT.githubLabel(fullName, repo.commit)}
            >
              <Icon name="external" size={18} />
            </a>
          )}
        </ControlHint>
      )}

      {/* Holds the middle even empty: the controls on the right stay on the right. */}
      <span className={styles.search}>
        {onSearchChange && (
          // The search keeps the focus while it moves between the field and its results (the
          // suggestion of a query that found nothing): leaving both is leaving the search.
          // biome-ignore lint/a11y/noStaticElementInteractions: follows the focus and keys of its children only
          <span
            className={styles.searchBox}
            onKeyDown={onSearchKeyDown}
            onFocus={onSearchFocus}
            onBlur={(event) => {
              if (
                !(event.relatedTarget instanceof Node) ||
                !event.currentTarget.contains(event.relatedTarget)
              ) {
                onSearchBlur?.(event)
              }
            }}
          >
            <CitySearchField
              value={searchValue}
              onChange={onSearchChange}
              expanded={searchExpanded}
              listboxId={searchListboxId}
              activeDescendant={searchActiveDescendant}
              inputRef={searchInputRef}
              onClick={onSearchClick}
              disabled={searchDisabled}
            />
            {searchPalette && <span className={styles.palette}>{searchPalette}</span>}
          </span>
        )}
      </span>

      {showMode && onModeChange && (
        <ControlHint text={TEXT.modeHint} shortcut={TEXT.modeShortcut}>
          {(hintId) => (
            <SegmentedControl
              label={TEXT.mode}
              describedBy={hintId}
              options={MODES}
              value={mode}
              onChange={onModeChange}
              disabled={modeDisabled}
            />
          )}
        </ControlHint>
      )}

      {onShareToggle && (
        <Button
          variant="secondary"
          icon="share"
          className={styles.share}
          aria-haspopup="dialog"
          aria-expanded={shareOpen}
          aria-controls={shareOpen ? sharePanelId : undefined}
          onClick={onShareToggle}
        >
          {TEXT.share}
        </Button>
      )}

      {account ? (
        <AccountMenu
          login={account.login}
          avatarSrc={account.avatarSrc}
          quota={account.quota}
          accountHref={account.accountHref}
          onSignOut={account.onSignOut}
        />
      ) : (
        onSignIn && (
          <Button variant="github" icon="github" onClick={onSignIn}>
            {TEXT.signIn}
          </Button>
        )
      )}
    </Glass>
  )
}
