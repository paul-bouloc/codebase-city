import { useEffect } from 'react'
import { Badge, type FileRole } from '../Badge'
import { exactCount } from '../count-format'
import { Icon } from '../Icon'
import { Kbd } from '../Kbd'
import styles from './SearchPalette.module.css'
import {
  type FileHit,
  type FolderHit,
  highlightRuns,
  type SearchHit,
  type SearchResults,
  type SymbolHit,
  searchOptions,
} from './search-data'

const TEXT = {
  results: 'Search results',
  files: 'Files',
  folders: 'Folders',
  symbols: 'Symbols',
  matches: (count: number) => `${exactCount(count)} ${count === 1 ? 'match' : 'matches'}`,
  fileCount: (count: number) => `${exactCount(count)} ${count === 1 ? 'file' : 'files'}`,
  line: (line: number) => `line ${exactCount(line)}`,
  nothing: 'Nothing matches',
  where: 'Search looks at file, folder and symbol names, not inside the code.',
  didYouMean: 'Did you mean',
  move: 'move',
  fly: 'fly there',
  close: 'close',
}

/** Roles the graph infers: they say "likely". The others are read from the path. */
const INFERRED: ReadonlySet<FileRole> = new Set([
  'entry-point',
  'conductor',
  'foundation',
  'facade',
])

/** The id of the option at `index` of the palette `listboxId`. */
export function searchOptionId(listboxId: string, index: number): string {
  return `${listboxId}-option-${index}`
}

interface SearchPaletteProps {
  /** The listbox's id, which the search field points at. */
  id: string
  query: string
  results: SearchResults
  /** The active option's index, in the order of `searchOptions`. */
  active: number
  /** A name close to a query that found nothing. */
  suggestion: string | null
  onActiveChange: (index: number) => void
  onChoose: (hit: SearchHit) => void
  onSuggest: (name: string) => void
}

// The results under the search field. The field keeps the focus: the palette is pointed at
// (`aria-activedescendant`), never focused, and a press on it does not take the focus away.
export function SearchPalette({
  id,
  query,
  results,
  active,
  suggestion,
  onActiveChange,
  onChoose,
  onSuggest,
}: SearchPaletteProps) {
  const options = searchOptions(results)

  // The active option stays in view as the arrows move it.
  useEffect(() => {
    document.getElementById(searchOptionId(id, active))?.scrollIntoView?.({ block: 'nearest' })
  }, [id, active])

  const groups = [
    { title: TEXT.files, group: results.files, first: 0 },
    { title: TEXT.folders, group: results.folders, first: results.files.hits.length },
    {
      title: TEXT.symbols,
      group: results.symbols,
      first: results.files.hits.length + results.folders.hits.length,
    },
  ]

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: keeps the focus in the field, not a control
    <div className={styles.palette} onMouseDown={(event) => event.preventDefault()}>
      {options.length === 0 ? (
        <div role="status" className={styles.empty}>
          <p className={styles.emptyTitle}>
            {TEXT.nothing} “<span className={styles.query}>{query}</span>”.
          </p>
          <p className={styles.emptyBody}>
            {TEXT.where}
            {suggestion && (
              <>
                {' '}
                {TEXT.didYouMean}{' '}
                <button
                  type="button"
                  className={styles.suggestion}
                  onClick={() => onSuggest(suggestion)}
                >
                  {suggestion}
                </button>
                ?
              </>
            )}
          </p>
        </div>
      ) : (
        <div id={id} role="listbox" aria-label={TEXT.results} className={styles.list}>
          {groups.map(
            ({ title, group, first }) =>
              group.hits.length > 0 && (
                // biome-ignore lint/a11y/useSemanticElements: a group of options, not of form fields
                <div
                  key={title}
                  role="group"
                  aria-label={`${title}, ${TEXT.matches(group.total)}`}
                  className={styles.group}
                >
                  <div className={styles.groupTitle} aria-hidden="true">
                    <span>{title}</span>
                    <span>{TEXT.matches(group.total)}</span>
                  </div>
                  {group.hits.map((hit, offset) => {
                    const index = first + offset
                    const selected = index === active
                    return (
                      // biome-ignore lint/a11y/useKeyWithClickEvents: the field owns the keyboard
                      <div
                        key={optionKey(hit)}
                        id={searchOptionId(id, index)}
                        role="option"
                        aria-selected={selected}
                        // Pointed at by the field, never focused (aria-activedescendant).
                        tabIndex={-1}
                        className={selected ? `${styles.option} ${styles.active}` : styles.option}
                        onMouseMove={() => {
                          if (!selected) {
                            onActiveChange(index)
                          }
                        }}
                        onClick={() => onChoose(hit)}
                      >
                        <OptionContent hit={hit} />
                        {selected && (
                          <span className={styles.enter} aria-hidden="true">
                            <Kbd>↵</Kbd>
                          </span>
                        )}
                      </div>
                    )
                  })}
                </div>
              ),
          )}
        </div>
      )}

      <div className={styles.footer} aria-hidden="true">
        <span>
          <Kbd>↑</Kbd> <Kbd>↓</Kbd> {TEXT.move}
        </span>
        <span>
          <Kbd>↵</Kbd> {TEXT.fly}
        </span>
        <span>
          <Kbd>Esc</Kbd> {TEXT.close}
        </span>
      </div>
    </div>
  )
}

function optionKey(hit: SearchHit): string {
  return hit.kind === 'symbol'
    ? `symbol:${hit.file}:${hit.line}:${hit.name}`
    : `${hit.kind}:${hit.path}`
}

function OptionContent({ hit }: { hit: SearchHit }) {
  switch (hit.kind) {
    case 'file':
      return <FileOption hit={hit} />
    case 'folder':
      return <FolderOption hit={hit} />
    case 'symbol':
      return <SymbolOption hit={hit} />
  }
}

function FileOption({ hit }: { hit: FileHit }) {
  return (
    <>
      <Icon name="file" size={20} className={styles.icon} />
      <PathText path={hit.path} nameStart={hit.nameStart} positions={hit.positions} />
      <span className={styles.badges}>
        <Badge
          kind="language"
          language={hit.language}
          name={hit.language === 'other' && hit.languageName ? hit.languageName : undefined}
        />
        {hit.role && <Badge kind="role" fileRole={hit.role} likely={INFERRED.has(hit.role)} />}
      </span>
    </>
  )
}

function FolderOption({ hit }: { hit: FolderHit }) {
  return (
    <>
      <Icon name="folder" size={20} className={styles.icon} />
      <PathText path={hit.path} nameStart={hit.nameStart} positions={hit.positions} />
      <span className={styles.badges}>
        <Badge kind="tag" label={TEXT.fileCount(hit.files)} />
      </span>
    </>
  )
}

function SymbolOption({ hit }: { hit: SymbolHit }) {
  return (
    <>
      <Icon name="symbol" size={20} className={styles.icon} />
      <span className={styles.text}>
        <span className={styles.path}>
          <Runs text={hit.name} positions={hit.positions} className={styles.name} />
        </span>
        {/* The file gives way from its start; its line always shows. */}
        <span className={styles.subline} title={hit.file}>
          <span className={styles.folder}>
            <span className={styles.folderText}>{hit.file}</span>
          </span>
          <span className={styles.lineNumber}>
            {' · '}
            {TEXT.line(hit.line)}
          </span>
        </span>
      </span>
      <span className={styles.badges}>
        <Badge kind="tag" label={hit.symbolKind} />
      </span>
    </>
  )
}

/** A path on one line: its folder in grey, cut from the start if need be; its name in bold. */
function PathText({
  path,
  nameStart,
  positions,
}: {
  path: string
  nameStart: number
  positions: readonly number[]
}) {
  return (
    <span className={styles.text}>
      <span className={styles.path} title={path}>
        {nameStart > 0 && (
          <span className={styles.folder}>
            {/* Isolated left to right inside a right-to-left box: the start is what overflows. */}
            <span className={styles.folderText}>
              <Runs text={path} positions={positions} to={nameStart} />
            </span>
          </span>
        )}
        <Runs text={path} positions={positions} from={nameStart} className={styles.name} />
      </span>
    </span>
  )
}

function Runs({
  text,
  positions,
  from,
  to,
  className,
}: {
  text: string
  positions: readonly number[]
  from?: number
  to?: number
  className?: string
}) {
  return (
    <span className={className}>
      {highlightRuns(text, positions, from, to).map((run, index) =>
        run.match ? (
          // biome-ignore lint/suspicious/noArrayIndexKey: runs never move
          <mark key={index} className={styles.match}>
            {run.text}
          </mark>
        ) : (
          run.text
        ),
      )}
    </span>
  )
}
