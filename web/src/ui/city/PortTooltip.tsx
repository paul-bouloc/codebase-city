import { exactCount } from '../count-format'
import styles from './CityTooltip.module.css'
import { Glass } from './Glass'
import { shortenFolder, splitPath } from './shorten-folder'
import type { Point, Rect } from './tooltip-placement'
import { useTooltipPlacement } from './use-tooltip-placement'

const TEXT = {
  links: (count: number) =>
    `${exactCount(count)} more ${count === 1 ? 'link' : 'links'} to other islands`,
  show: (count: number) => (count === 1 ? 'Click to show it' : 'Click to show them'),
}

// Characters of the path line, as on a folder's card.
const PATH_CHARS = 45

interface PortTooltipProps {
  // The island whose port it is.
  path: string
  // The links the port gathers.
  links: number
  pointer: Point
  obstacles?: readonly Rect[]
}

// The card of a port's badge: which island, how many links it gathers, and what a click shows.
export function PortTooltip({ path, links, pointer, obstacles }: PortTooltipProps) {
  const { ref, style } = useTooltipPlacement<HTMLDivElement>(pointer, obstacles)
  const { folder, name } = splitPath(path)
  const shortFolder = shortenFolder(folder, PATH_CHARS - name.length)

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
      <p className={styles.summary}>{TEXT.links(links)}</p>
      <p className={`${styles.summary} ${styles.action}`}>{TEXT.show(links)}</p>
    </Glass>
  )
}
