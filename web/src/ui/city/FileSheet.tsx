import { useState } from 'react'
import { Badge } from '../Badge'
import { Button } from '../Button'
import { exactCount, fileSize } from '../count-format'
import { Icon } from '../Icon'
import { LinkButton } from '../LinkButton'
import { LiveRegion } from '../LiveRegion'
import { type TabItem, Tabs } from '../Tabs'
import { Breadcrumb } from './Breadcrumb'
import { CodeView } from './CodeView'
import styles from './FileSheet.module.css'
import { safeGithubHref } from './github-links'
import { HeaderComment } from './HeaderComment'
import { ImportanceList } from './ImportanceList'
import { MetricPairs } from './MetricPairs'
import { RoleBadge } from './RoleBadge'
import { SheetFrame } from './SheetFrame'
import { Skeleton } from './Skeleton'
import { SymbolList } from './SymbolList'
import type { FileSheetData } from './sheet-data'
import { splitPath } from './shorten-folder'
import { UnanalyzedNote } from './UnanalyzedNote'

const TEXT = {
  github: 'Open on GitHub',
  copyPath: 'Copy path',
  copyLink: 'Copy link to this file',
  lines: 'Lines',
  complexity: 'Complexity',
  size: 'Size',
  rank: (top: number, rank: number, of: number) =>
    `top ${top}% · rank ${exactCount(rank)} of ${exactCount(of)}`,
  importedBy: 'Imported by',
  filesDirectly: (count: number) => ` ${count === 1 ? 'file' : 'files'} directly · `,
  inTotal: ' in total',
  showing: (shown: number, of: number) =>
    `Showing ${exactCount(shown)} of ${exactCount(of)} importers; the rest are grouped by island`,
  imports: 'Imports',
  filesSuffix: (count: number) => ` ${count === 1 ? 'file' : 'files'}`,
  layer: (index: number, of: number) => `Layer ${index} of ${of} · `,
  cycle: (files: number) => `Part of a cycle of ${exactCount(files)} files · `,
  showCycle: 'show it',
  tabs: 'File details',
  tabImports: 'Imports',
  tabImportedBy: 'Imported by',
  tabSymbols: 'Symbols',
  tabCode: 'Code',
  loading: 'Loading file details',
  loadingCode: 'Loading the code',
  unanalyzedTitle: (language: string) => `${language} isn’t analyzed yet.`,
  unanalyzedBody:
    'This file has no imports, symbols or complexity here: only its size and its code. It stands in raw concrete in the city.',
  showImpact: 'Show impact',
  findPath: 'Find a path to…',
}

export type FileTab = 'imports' | 'importedBy' | 'symbols' | 'code'

interface FileSheetProps {
  open: boolean
  file: FileSheetData
  // Details still on their way: the breadcrumb and the name are shown, the rest is a skeleton.
  loading?: boolean
  onClose: () => void
  onOpenFolder: (path: string) => void
  onSelectFile: (path: string) => void
  onShowCycle: (index: number) => void
  onCopyPath: () => void
  onCopyLink: () => void
  onRetryCode: () => void
  onShowImpact: () => void
  onFindPath: () => void
  // For the demonstration page: open on a given tab, list or comment unfolded.
  defaultTab?: FileTab
  defaultExpanded?: boolean
}

export function FileSheet({
  open,
  file,
  loading = false,
  onClose,
  onOpenFolder,
  onSelectFile,
  onShowCycle,
  onCopyPath,
  onCopyLink,
  onRetryCode,
  onShowImpact,
  onFindPath,
  defaultTab,
  defaultExpanded = false,
}: FileSheetProps) {
  const { folder, name } = splitPath(file.path)
  const folders = folder.split('/').filter(Boolean)
  const githubHref = safeGithubHref(file.githubUrl)

  const actions = (
    <>
      {githubHref && (
        <LinkButton href={githubHref} icon="external" newTab>
          {TEXT.github}
        </LinkButton>
      )}
      <Button
        iconOnly
        icon="copy"
        label={TEXT.copyPath}
        title={TEXT.copyPath}
        onClick={onCopyPath}
      />
      <Button
        iconOnly
        icon="link"
        label={TEXT.copyLink}
        title={TEXT.copyLink}
        onClick={onCopyLink}
      />
    </>
  )

  const footer =
    !loading && file.analyzed ? (
      <>
        <Button onClick={onShowImpact}>{TEXT.showImpact}</Button>
        <Button onClick={onFindPath}>{TEXT.findPath}</Button>
      </>
    ) : undefined

  return (
    <SheetFrame
      open={open}
      onClose={onClose}
      breadcrumb={<Breadcrumb folders={folders} onOpenFolder={onOpenFolder} />}
      icon="file"
      tone="accent"
      title={name}
      badges={loading ? <Skeleton width="180px" height="24px" /> : <FileBadges file={file} />}
      actions={actions}
      footer={footer}
      busy={loading}
      busyLabel={TEXT.loading}
      contentKey={file.path}
    >
      {loading ? (
        <div className={styles.loading}>
          <Skeleton width="100%" height="48px" />
          <Skeleton width="80%" height="14px" />
          <Skeleton width="65%" height="14px" />
          <Skeleton width="100%" height="120px" />
        </div>
      ) : (
        <FileDetails
          // A new file starts afresh: first tab, lists and comment folded.
          key={file.path}
          file={file}
          onOpenFolder={onOpenFolder}
          onSelectFile={onSelectFile}
          onShowCycle={onShowCycle}
          onRetryCode={onRetryCode}
          defaultTab={defaultTab}
          defaultExpanded={defaultExpanded}
        />
      )}
    </SheetFrame>
  )
}

function FileDetails({
  file,
  onOpenFolder,
  onSelectFile,
  onShowCycle,
  onRetryCode,
  defaultTab,
  defaultExpanded = false,
}: Pick<
  FileSheetProps,
  'file' | 'onOpenFolder' | 'onSelectFile' | 'onShowCycle' | 'onRetryCode' | 'defaultTab'
> & { defaultExpanded?: boolean }) {
  const tabs = fileTabs(file)
  const [tab, setTab] = useState<FileTab | undefined>(defaultTab)
  const [codeLine, setCodeLine] = useState<number>()
  // A tab that went away (or none chosen yet) falls back to the first one there is.
  const shownTab = tabs.find(({ id }) => id === tab)?.id ?? tabs[0]?.id ?? 'code'

  return (
    <>
      {/* Mounted with the details, before the Code tab is opened: the message is announced. */}
      <LiveRegion className="visually-hidden">
        {shownTab === 'code' && file.code.status === 'loading' ? TEXT.loadingCode : null}
      </LiveRegion>
      {!file.analyzed && (
        <UnanalyzedNote
          title={TEXT.unanalyzedTitle(file.languageName)}
          body={TEXT.unanalyzedBody}
        />
      )}

      <MetricPairs columns={2} metrics={fileMetrics(file)} />

      {file.analyzed && (
        <FileFacts file={file} onOpenFolder={onOpenFolder} onShowCycle={onShowCycle} />
      )}

      {file.headerComment && (
        <HeaderComment text={file.headerComment} defaultExpanded={defaultExpanded} />
      )}

      <div className={styles.tabs}>
        <Tabs
          label={TEXT.tabs}
          compact
          tabs={tabs}
          selected={shownTab}
          onSelect={(id) => {
            setCodeLine(undefined)
            setTab(id as FileTab)
          }}
        >
          {shownTab === 'imports' && (
            <ImportanceList
              rows={file.importList}
              direction="imports"
              onSelect={onSelectFile}
              defaultExpanded={defaultExpanded}
            />
          )}
          {shownTab === 'importedBy' && (
            <ImportanceList
              rows={file.importerList}
              direction="importedBy"
              onSelect={onSelectFile}
              defaultExpanded={defaultExpanded}
            />
          )}
          {shownTab === 'symbols' && (
            <SymbolList
              symbols={file.symbols}
              onOpenLine={(line) => {
                setCodeLine(line)
                setTab('code')
              }}
              defaultExpanded={defaultExpanded}
            />
          )}
          {shownTab === 'code' && (
            <CodeView
              code={file.code}
              githubUrl={file.githubUrl}
              onRetry={onRetryCode}
              line={codeLine}
            />
          )}
        </Tabs>
      </div>
    </>
  )
}

// No empty tabs: a list with nothing in it is removed, not greyed. An unanalyzed file keeps
// only its code.
function fileTabs(file: FileSheetData): (TabItem & { id: FileTab })[] {
  const lists: (TabItem & { id: FileTab })[] = file.analyzed
    ? [
        { id: 'imports', label: TEXT.tabImports, count: file.imports },
        { id: 'importedBy', label: TEXT.tabImportedBy, count: file.importers },
        { id: 'symbols', label: TEXT.tabSymbols, count: file.symbols.length },
      ]
    : []
  return [...lists.filter(({ count }) => count !== 0), { id: 'code', label: TEXT.tabCode }]
}

function fileMetrics(file: FileSheetData) {
  const lines = { label: TEXT.lines, value: exactCount(file.lines) }
  if (!file.analyzed) {
    // The analysis keeps no size: only the screen may know it.
    return file.sizeBytes === undefined
      ? [lines]
      : [lines, { label: TEXT.size, value: fileSize(file.sizeBytes) }]
  }
  const { complexityTop: top, complexityRank: rank, repoFiles: of } = file
  return [
    lines,
    {
      label: TEXT.complexity,
      value: file.complexity === undefined ? '—' : exactCount(file.complexity),
      note:
        top !== undefined && rank !== undefined && of !== undefined
          ? TEXT.rank(top, rank, of)
          : undefined,
    },
  ]
}

function FileBadges({ file }: { file: FileSheetData }) {
  return (
    <>
      <Badge kind="language" language={file.language} name={file.languageName} />
      {!file.analyzed && <Badge kind="language" language="other" />}
      {file.roles.map(({ role, reason }) => (
        <RoleBadge key={role} fileRole={role} reason={reason} />
      ))}
    </>
  )
}

function FileFacts({
  file,
  onOpenFolder,
  onShowCycle,
}: {
  file: FileSheetData
  onOpenFolder: (path: string) => void
  onShowCycle: (index: number) => void
}) {
  return (
    <ul className={styles.facts}>
      <li className={styles.fact}>
        <span className={`${styles.trait} ${styles.incoming}`} />
        <span>
          {TEXT.importedBy} <strong>{exactCount(file.importers)}</strong>
          {TEXT.filesDirectly(file.importers)}
          <strong>{exactCount(file.dependents)}</strong>
          {TEXT.inTotal}
          {file.shownImporters !== undefined && (
            <span className={styles.subFact}>
              {TEXT.showing(file.shownImporters, file.importers)}
            </span>
          )}
        </span>
      </li>
      <li className={styles.fact}>
        <span className={`${styles.trait} ${styles.outgoing}`} />
        <span>
          {TEXT.imports} <strong>{exactCount(file.imports)}</strong>
          {TEXT.filesSuffix(file.imports)}
        </span>
      </li>
      {file.layer && (
        <li className={styles.fact}>
          <Icon name="layers" size={16} className={styles.factIcon} />
          <span>
            {TEXT.layer(file.layer.index, file.layer.of)}
            <button
              type="button"
              className={`${styles.link} ${styles.mono}`}
              onClick={() => file.layer && onOpenFolder(file.layer.islandPath)}
            >
              {file.layer.island}
            </button>
          </span>
        </li>
      )}
      {file.cycles.map((files, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: cycles have no identity of their own here
        <li key={index} className={`${styles.fact} ${styles.cycle}`}>
          <Icon name="cycle" size={16} className={styles.factIcon} />
          <span>
            {TEXT.cycle(files)}
            <button type="button" className={styles.link} onClick={() => onShowCycle(index)}>
              {TEXT.showCycle}
            </button>
          </span>
        </li>
      ))}
    </ul>
  )
}
