import { type ReactNode, useEffect, useRef } from 'react'
import { AboutPanel, type NewerVersion } from '../src/screen/about/AboutPanel'
import { FileSheet, type FileTab } from '../src/screen/sheets/file/FileSheet'
import { FolderSheet } from '../src/screen/sheets/folder/FolderSheet'
import type { FileSheetData, FolderSheetData } from '../src/screen/sheets/sheet-data'
import styles from './SheetsBoard.module.css'
import {
  ABOUT,
  ABOUT_NO_FLOWS,
  FILE,
  FILE_CODE_GONE,
  FILE_CODE_TIMEOUT,
  FILE_CYCLES,
  FOLDER,
  FOLDER_NO_README,
  TEST_PARK,
  UNANALYZED_FILE,
  UNANALYZED_FOLDER,
} from './sheet-samples'

const TEXT = {
  title: 'Sheets and About',
  intro:
    'Compare with the “City UI · File selected”, “Folder selected” and “About repo” boards. Hover or focus the “likely” badge for its reason.',
  file: 'File sheet',
  folder: 'Folder sheet',
  about: 'About this repository',
  quota: 'Rebuilding uses 1 analysis · 7 left today.',
}

const noop = () => {}

const FILE_CASES: {
  label: string
  file: FileSheetData
  tab?: FileTab
  expanded?: boolean
  loading?: boolean
}[] = [
  { label: 'Imports', file: FILE },
  { label: 'Imported by', file: FILE, tab: 'importedBy' },
  { label: 'Symbols', file: FILE, tab: 'symbols' },
  { label: 'Code', file: FILE, tab: 'code' },
  { label: 'Comment and list unfolded', file: FILE, expanded: true },
  { label: 'Three cycles', file: FILE_CYCLES },
  { label: 'Loading', file: FILE, loading: true },
  { label: 'Language not analyzed', file: UNANALYZED_FILE },
  { label: 'Code: GitHub timed out', file: FILE_CODE_TIMEOUT, tab: 'code' },
  { label: 'Code: gone from GitHub', file: FILE_CODE_GONE, tab: 'code' },
]

const FOLDER_CASES: { label: string; folder: FolderSheetData; loading?: boolean }[] = [
  { label: 'Island', folder: FOLDER },
  { label: 'Loading', folder: FOLDER, loading: true },
  { label: 'No README', folder: FOLDER_NO_README },
  { label: 'Not analyzed, a parcel', folder: UNANALYZED_FOLDER },
  { label: 'Test park', folder: TEST_PARK },
]

const NEWER: NewerVersion = {
  commits: 48,
  signedIn: true,
  quotaNote: TEXT.quota,
  onRebuild: noop,
  onSignIn: noop,
}

const ABOUT_CASES: { label: string; newer?: NewerVersion; noFlows?: boolean }[] = [
  { label: 'As analyzed' },
  { label: 'Newer version, signed in', newer: NEWER },
  { label: 'Repository changed, signed out', newer: { ...NEWER, commits: null, signedIn: false } },
  { label: 'No analyzed language', noFlows: true },
]

// Every state of the panels, open side by side over the sea.
export function SheetsBoard() {
  return (
    <main className={styles.board}>
      <header className={styles.header}>
        <h1 className="heading-1">{TEXT.title}</h1>
        <p className="body-m">{TEXT.intro}</p>
      </header>

      <Group title={TEXT.file}>
        {FILE_CASES.map(({ label, file, tab, expanded, loading }) => (
          <Case key={label} label={label} scrollToTabs={tab !== undefined}>
            <FileSheet
              open
              file={file}
              loading={loading}
              defaultTab={tab}
              defaultExpanded={expanded}
              onClose={noop}
              onOpenFolder={noop}
              onSelectFile={noop}
              onShowCycle={noop}
              onCopyPath={noop}
              onCopyLink={noop}
              onRetryCode={noop}
              onShowImpact={noop}
              onFindPath={noop}
            />
          </Case>
        ))}
      </Group>

      <Group title={TEXT.folder}>
        {FOLDER_CASES.map(({ label, folder, loading }) => (
          <Case key={label} label={label}>
            <FolderSheet
              open
              folder={folder}
              loading={loading}
              onClose={noop}
              onOpenFolder={noop}
              onSelectFile={noop}
              onCopyLink={noop}
            />
          </Case>
        ))}
      </Group>

      <Group title={TEXT.about}>
        {ABOUT_CASES.map(({ label, newer, noFlows }) => (
          <Case key={label} label={label} short>
            <AboutPanel
              id={`about-${label}`}
              open
              about={noFlows ? ABOUT_NO_FLOWS : ABOUT}
              newer={newer}
              onClose={noop}
            />
          </Case>
        ))}
      </Group>
    </main>
  )
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className={styles.group}>
      <h2 className="heading-2">{title}</h2>
      <div className={styles.cases}>{children}</div>
    </section>
  )
}

function Case({
  label,
  short = false,
  scrollToTabs = false,
  children,
}: {
  label: string
  short?: boolean
  // As the board draws a tab: the figures and the comment scrolled out of view.
  scrollToTabs?: boolean
  children: ReactNode
}) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const tabs = ref.current?.querySelector<HTMLElement>('[role="tablist"]')
    let scroller = tabs?.parentElement ?? null
    while (scroller && getComputedStyle(scroller).overflowY !== 'auto') {
      scroller = scroller.parentElement
    }
    if (scrollToTabs && tabs && scroller) {
      scroller.scrollTop =
        tabs.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop
    }
  }, [scrollToTabs])

  return (
    <figure className={styles.case}>
      <figcaption className="eyebrow-mono">{label}</figcaption>
      <div ref={ref} className={short ? `${styles.sea} ${styles.short}` : styles.sea}>
        {children}
      </div>
    </figure>
  )
}
