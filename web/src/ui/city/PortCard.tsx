import { exactCount } from '../count-format'
import styles from './CityTooltip.module.css'
import { Glass } from './Glass'
import own from './PortCard.module.css'
import { shortenFolder, splitPath } from './shorten-folder'
import type { Point, Rect } from './tooltip-placement'
import { useTooltipPlacement } from './use-tooltip-placement'

const TEXT = {
  label: (path: string) => `Links at the port of ${path}`,
  links: (count: number) =>
    `${exactCount(count)} ${count === 1 ? 'link' : 'links'} not drawn, waiting at this port`,
  imports: (count: number) => `${exactCount(count)} ${count === 1 ? 'import' : 'imports'}`,
  outgoing: (name: string) => `${name} imports it`,
  incoming: (name: string) => `imports ${name}`,
  more: (count: number) => `and ${exactCount(count)} more`,
}

// Characters of the path line, as on a folder's card.
const PATH_CHARS = 45

export interface PortCardLink {
  // The island across.
  path: string
  imports: number
  // The port's island imports the other one.
  outgoing: boolean
  // The other island imports the port's.
  incoming: boolean
}

interface PortCardProps {
  // The island whose port it is.
  path: string
  // Its links, the largest first, as many as are listed.
  links: readonly PortCardLink[]
  // Links past those listed.
  more: number
  pointer: Point
  obstacles?: readonly Rect[]
  // The pointer rests on the link at this index, or on none.
  onFocusLink?(index: number | null): void
}

// An open port's card: the links it gathers, each the way it goes, the largest first.
export function PortCard({ path, links, more, pointer, obstacles, onFocusLink }: PortCardProps) {
  const { ref, style } = useTooltipPlacement<HTMLDivElement>(pointer, obstacles)
  const { folder, name } = splitPath(path)
  const shortFolder = shortenFolder(folder, PATH_CHARS - name.length)
  const total = links.length + more

  return (
    <Glass
      ref={ref}
      role="group"
      aria-label={TEXT.label(path)}
      radius="md"
      className={`${styles.tooltip} ${styles.area} ${own.card}`}
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
      <p className={styles.summary}>{TEXT.links(total)}</p>
      <p className={`${styles.relations} ${styles.secondary}`}>
        <span className={styles.relation}>
          <span className={`${styles.trait} ${styles.outgoing}`} aria-hidden="true" />
          {TEXT.outgoing(name)}
        </span>
        <span className={styles.relation}>
          <span className={`${styles.trait} ${styles.incoming}`} aria-hidden="true" />
          {TEXT.incoming(name)}
        </span>
      </p>
      <ul className={own.list} onMouseLeave={() => onFocusLink?.(null)}>
        {links.map((link, index) => (
          <li key={link.path} className={own.row} onMouseEnter={() => onFocusLink?.(index)}>
            <span className={own.ways}>
              {link.outgoing && (
                <span
                  className={`${styles.trait} ${styles.outgoing}`}
                  title={TEXT.outgoing(name)}
                />
              )}
              {link.incoming && (
                <span
                  className={`${styles.trait} ${styles.incoming}`}
                  title={TEXT.incoming(name)}
                />
              )}
            </span>
            <span className={own.island}>{link.path}</span>
            <span className={own.imports}>{TEXT.imports(link.imports)}</span>
          </li>
        ))}
      </ul>
      {more > 0 && <p className={`${styles.summary} ${styles.action}`}>{TEXT.more(more)}</p>}
    </Glass>
  )
}
