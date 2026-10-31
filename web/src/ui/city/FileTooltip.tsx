import { Badge, type FileRole, LANGUAGE_LABELS, type Language } from '../Badge'
import styles from './CityTooltip.module.css'
import { Glass } from './Glass'
import { shortenFolder, splitPath } from './shorten-folder'
import type { Point, Rect } from './tooltip-placement'
import { useTooltipPlacement } from './use-tooltip-placement'

const numbers = new Intl.NumberFormat('en-US')

const TEXT = {
  lines: (count: number) => `${numbers.format(count)} ${count === 1 ? 'line' : 'lines'}`,
  complexity: (value: number) => `complexity ${numbers.format(value)}`,
  top: (percent: number) => `(top ${percent}%)`,
  importedBy: (count: number) =>
    `Imported by ${numbers.format(count)} ${count === 1 ? 'file' : 'files'}`,
  imports: (count: number) => `imports ${numbers.format(count)}`,
}

// Characters of the path line: 380 px wide, 16 px padding each side, mono 12 at 7.2 px.
const PATH_CHARS = 48

interface FileTooltipProps {
  // Full path from the repository root, file name included.
  path: string
  language: Language
  lines: number
  // Absent for a file the analysis does not read.
  complexity?: number
  // Rank of the complexity in the repository: 1 for the top 1%.
  complexityTop?: number
  incoming: number
  outgoing: number
  // Only for a file that has a role. Roles are inferred from the code, so always "likely".
  fileRole?: FileRole
  pointer: Point
  // Open panels the card must not cover.
  obstacles?: readonly Rect[]
}

// The card shown while the pointer rests on a building.
export function FileTooltip({
  path,
  language,
  lines,
  complexity,
  complexityTop,
  incoming,
  outgoing,
  fileRole,
  pointer,
  obstacles,
}: FileTooltipProps) {
  const { ref, style } = useTooltipPlacement<HTMLDivElement>(pointer, obstacles)
  const { folder, name } = splitPath(path)
  // The folder gives way first; the name keeps at least 24 characters (CSS).
  const shortFolder = shortenFolder(folder, PATH_CHARS - name.length)
  const facts = [
    LANGUAGE_LABELS[language],
    TEXT.lines(lines),
    complexity !== undefined && TEXT.complexity(complexity),
  ].filter(Boolean)

  return (
    <Glass ref={ref} role="tooltip" className={`${styles.tooltip} ${styles.file}`} style={style}>
      {fileRole && <Badge kind="role" fileRole={fileRole} likely />}
      <p className={styles.path}>
        <span className="visually-hidden">{path}</span>
        <span className={styles.folder} aria-hidden="true">
          {shortFolder}
        </span>
        <span className={styles.name} aria-hidden="true">
          {name}
        </span>
      </p>
      <p className={styles.facts}>
        <span className={styles.dot} data-language={language} />
        <span>
          {facts.join(' · ')}
          {complexityTop !== undefined && (
            <span className={styles.secondary}> {TEXT.top(complexityTop)}</span>
          )}
        </span>
      </p>
      <p className={styles.relations}>
        <span className={styles.relation}>
          <span className={`${styles.trait} ${styles.incoming}`} />
          {TEXT.importedBy(incoming)}
        </span>
        <span className={styles.relation}>
          <span className={`${styles.trait} ${styles.outgoing}`} />
          {TEXT.imports(outgoing)}
        </span>
      </p>
    </Glass>
  )
}
