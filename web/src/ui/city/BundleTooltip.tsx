import { Glass } from '../../screen/parts/Glass'
import { shortenFolder, splitPath } from '../../screen/parts/shorten-folder'
import { exactCount } from '../count-format'
import styles from './CityTooltip.module.css'
import type { Point, Rect } from './tooltip-placement'
import { useTooltipPlacement } from './use-tooltip-placement'

const files = (count: number, more: boolean) =>
  `${exactCount(count)} ${more ? 'more ' : ''}${count === 1 ? 'file' : 'files'}`

const TEXT = {
  importers: (count: number, more: boolean) =>
    `${files(count, more)} here ${count === 1 ? 'imports' : 'import'} this file`,
  imported: (count: number, more: boolean) => `This file imports ${files(count, more)} here`,
  showNearest: (count: number) => `Click to show the ${exactCount(count)} nearest`,
  showOne: 'Click to show it',
  showAll: 'Click to show them',
}

// Characters of the path line, as on a folder's card.
const PATH_CHARS = 45

interface BundleTooltipProps {
  // The island the bundle gathers files of.
  path: string
  // `incoming`: the files import the selection; `outgoing`: it imports them.
  direction: 'incoming' | 'outgoing'
  files: number
  // Some of the island's files were shown already: these are the rest.
  more: boolean
  // How many arcs a click shows.
  opens: number
  pointer: Point
  obstacles?: readonly Rect[]
}

// The card of a bundle of arcs: which island, how many files, and what a click shows.
export function BundleTooltip({
  path,
  direction,
  files: count,
  more,
  opens,
  pointer,
  obstacles,
}: BundleTooltipProps) {
  const { ref, style } = useTooltipPlacement<HTMLDivElement>(pointer, obstacles)
  const { folder, name } = splitPath(path)
  const shortFolder = shortenFolder(folder, PATH_CHARS - name.length)
  const summary =
    direction === 'incoming' ? TEXT.importers(count, more) : TEXT.imported(count, more)
  const action = opens < count ? TEXT.showNearest(opens) : count === 1 ? TEXT.showOne : TEXT.showAll

  return (
    <Glass
      ref={ref}
      role="tooltip"
      radius="md"
      className={`${styles.tooltip} ${styles.area}`}
      style={style}
    >
      <p className={`${styles.path} ${styles.areaPath}`}>
        <span className="visually-hidden">{path}</span>
        <span className={styles.folder} aria-hidden="true">
          {shortFolder}
        </span>
        <span className={styles.name} aria-hidden="true">
          {name}
        </span>
      </p>
      <p className={styles.summary}>{summary}</p>
      <p className={`${styles.summary} ${styles.action}`}>{action}</p>
    </Glass>
  )
}
