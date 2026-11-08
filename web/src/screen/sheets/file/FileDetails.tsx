import { useEffect, useState } from 'react'
import { type TabItem, Tabs } from '../../../ui/actions/Tabs'
import { exactCount, fileSize } from '../../../ui/display/count-format'
import { LiveRegion } from '../../../ui/feedback/LiveRegion'
import { MetricPairs } from '../MetricPairs'
import type { FileSheetData } from '../sheet-data'
import { UnanalyzedNote } from '../UnanalyzedNote'
import { CodeView } from './CodeView'
import styles from './FileDetails.module.css'
import { FileFacts } from './FileFacts'
import { HeaderComment } from './HeaderComment'
import { ImportanceList } from './ImportanceList'
import { SymbolList } from './SymbolList'

const TEXT = {
  lines: 'Lines',
  complexity: 'Complexity',
  size: 'Size',
  rank: (top: number, rank: number, of: number) =>
    `top ${top}% · rank ${exactCount(rank)} of ${exactCount(of)}`,
  tabs: 'File details',
  tabImports: 'Imports',
  tabImportedBy: 'Imported by',
  tabSymbols: 'Symbols',
  tabCode: 'Code',
  loadingCode: 'Loading the code',
  unanalyzedTitle: (language: string) => `${language} isn’t analyzed yet.`,
  unanalyzedBody:
    'This file has no imports, symbols or complexity here: only its size and its code. It stands in raw concrete in the city.',
}

export type FileTab = 'imports' | 'importedBy' | 'symbols' | 'code'

interface FileDetailsProps {
  file: FileSheetData
  onOpenFolder: (path: string) => void
  onSelectFile: (path: string) => void
  onShowCycle: (index: number) => void
  onRetryCode: () => void
  onOpenCode?: () => void
  defaultTab?: FileTab
  defaultExpanded?: boolean
  openLine?: { line: number; request: number }
}

export function FileDetails({
  file,
  onOpenFolder,
  onSelectFile,
  onShowCycle,
  onRetryCode,
  onOpenCode,
  defaultTab,
  defaultExpanded = false,
  openLine,
}: FileDetailsProps) {
  const tabs = fileTabs(file)
  const [tab, setTab] = useState<FileTab | undefined>(defaultTab)
  const [codeLine, setCodeLine] = useState<number>()
  // Each request of a line, even the line already shown, brings it back into view.
  const [lineShown, setLineShown] = useState(0)
  const showLine = (line: number) => {
    setCodeLine(line)
    setLineShown((count) => count + 1)
    setTab('code')
  }
  // A tab that went away (or none chosen yet) falls back to the first one there is.
  const shownTab = tabs.find(({ id }) => id === tab)?.id ?? tabs[0]?.id ?? 'code'
  const codeShown = shownTab === 'code'
  // Each new request, not each render: the tabs stay free to change.
  const lineRequest = openLine?.request
  const requestedLine = openLine?.line
  useEffect(() => {
    if (lineRequest !== undefined && requestedLine !== undefined) {
      setCodeLine(requestedLine)
      setLineShown((count) => count + 1)
      setTab('code')
    }
  }, [lineRequest, requestedLine])
  useEffect(() => {
    if (codeShown) {
      onOpenCode?.()
    }
  }, [codeShown, onOpenCode])

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
              onOpenLine={showLine}
              defaultExpanded={defaultExpanded}
            />
          )}
          {shownTab === 'code' && (
            <CodeView
              key={lineShown}
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
