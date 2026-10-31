import type { Ref } from 'react'
import { AccountMenu } from '../AccountMenu'
import { Button } from '../Button'
import { Icon } from '../Icon'
import { Logo } from '../Logo'
import { SegmentedControl, type SegmentedOption } from '../SegmentedControl'
import { CitySearchField } from './CitySearchField'
import styles from './CityTopBar.module.css'
import { ControlHint } from './ControlHint'
import { Glass } from './Glass'

const TEXT = {
  home: 'Codebase City, home',
  about: 'About this repository',
  analyzed: (when: string) => ` · analyzed ${when}`,
  github: 'Open on GitHub',
  githubLabel: (repo: string, commit: string) => `Open ${repo} at ${commit} on GitHub`,
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
  // "2 days ago".
  analyzed: string
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
  searchValue: string
  onSearchChange: (value: string) => void
  searchExpanded?: boolean
  searchListboxId?: string
  searchInputRef?: Ref<HTMLInputElement>
  mode: BuildingMode
  onModeChange: (mode: BuildingMode) => void
  // While the city is building.
  modeDisabled?: boolean
  // The text fallback view has no building style.
  showMode?: boolean
  shareOpen: boolean
  onShareToggle: () => void
  sharePanelId?: string
  // Null for a visitor: looking at a city never needs an account.
  account: CityAccount | null
  onSignIn: () => void
}

// Floats over the city. No quota chip here: the city is for looking, not building.
export function CityTopBar({
  repo,
  homeHref,
  aboutOpen,
  onAboutToggle,
  aboutPanelId,
  searchValue,
  onSearchChange,
  searchExpanded,
  searchListboxId,
  searchInputRef,
  mode,
  onModeChange,
  modeDisabled = false,
  showMode = true,
  shareOpen,
  onShareToggle,
  sharePanelId,
  account,
  onSignIn,
}: CityTopBarProps) {
  const fullName = `${repo.owner}/${repo.name}`

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
                {TEXT.analyzed(repo.analyzed)}
              </span>
            </span>
            <Icon name="chevron-down" size={16} className={styles.chevron} />
          </button>
        )}
      </ControlHint>

      <ControlHint text={TEXT.github}>
        {(hintId) => (
          <a
            href={repo.githubUrl}
            className={styles.github}
            aria-label={TEXT.githubLabel(fullName, repo.commit)}
            aria-describedby={hintId}
          >
            <Icon name="external" size={18} />
          </a>
        )}
      </ControlHint>

      <span className={styles.search}>
        <CitySearchField
          value={searchValue}
          onChange={onSearchChange}
          expanded={searchExpanded}
          listboxId={searchListboxId}
          inputRef={searchInputRef}
        />
      </span>

      {showMode && (
        <ControlHint text={TEXT.modeHint} shortcut={TEXT.modeShortcut}>
          {() => (
            <SegmentedControl
              label={TEXT.mode}
              options={MODES}
              value={mode}
              onChange={onModeChange}
              disabled={modeDisabled}
            />
          )}
        </ControlHint>
      )}

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

      {account ? (
        <AccountMenu
          login={account.login}
          avatarSrc={account.avatarSrc}
          quota={account.quota}
          accountHref={account.accountHref}
          onSignOut={account.onSignOut}
        />
      ) : (
        <Button variant="github" icon="github" onClick={onSignIn}>
          {TEXT.signIn}
        </Button>
      )}
    </Glass>
  )
}
