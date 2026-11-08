import { Glass } from '../../screen/parts/Glass'
import { shortenFolder, splitPath } from '../../screen/parts/shorten-folder'
import { exactCount } from '../count-format'
import tooltip from './CityTooltip.module.css'
import styles from './PortCard.module.css'
import type { Point, Rect } from './tooltip-placement'
import { useTooltipPlacement } from './use-tooltip-placement'

const TEXT = {
  label: (path: string) => `Links at the port of ${path}`,
  summary: (count: number) =>
    count === 1
      ? 'This link isn’t drawn on the map: it waits at this port.'
      : `These ${exactCount(count)} links aren’t drawn on the map: they wait at this port. Largest first, in imports.`,
  imports: (count: number) => `${exactCount(count)} ${count === 1 ? 'import' : 'imports'}`,
  outgoing: (name: string) => `imported by ${name}`,
  incoming: (name: string) => `imports ${name}`,
  both: 'both ways',
  more: (count: number) => `and ${exactCount(count)} more`,
}

// Characters of the folder beside the title, and of a row's path.
const FOLDER_CHARS = 32
const PATH_CHARS = 30

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

// An open port's card: the links it gathers, the largest first, each the way it goes.
export function PortCard({ path, links, more, pointer, obstacles, onFocusLink }: PortCardProps) {
  const { ref, style } = useTooltipPlacement<HTMLDivElement>(pointer, obstacles)
  const { folder, name } = splitPath(path)

  return (
    <Glass
      ref={ref}
      role="group"
      aria-label={TEXT.label(path)}
      radius="lg"
      className={`${tooltip.tooltip} ${styles.card}`}
      style={style}
    >
      <div className={styles.header}>
        <p className={styles.title}>
          <span className={styles.name}>{name}</span>
          {folder && (
            <span className={styles.folder} title={path}>
              {shortenFolder(folder, FOLDER_CHARS)}
            </span>
          )}
        </p>
        <p className={styles.summary}>{TEXT.summary(links.length + more)}</p>
      </div>
      <ul className={styles.list} onMouseLeave={() => onFocusLink?.(null)}>
        {links.map((link, index) => (
          <li key={link.path} className={styles.row} onMouseEnter={() => onFocusLink?.(index)}>
            <span className={styles.count} aria-hidden="true">
              {exactCount(link.imports)}
            </span>
            <span className="visually-hidden">{TEXT.imports(link.imports)}</span>
            <IslandName path={link.path} />
            <Way link={link} name={name} />
          </li>
        ))}
      </ul>
      {more > 0 && <p className={styles.more}>{TEXT.more(more)}</p>}
    </Glass>
  )
}

// The island across: its name, its folder under it.
function IslandName({ path }: { path: string }) {
  const { folder, name } = splitPath(path)
  return (
    <span className={styles.names} title={path}>
      <span className={styles.island}>{name}</span>
      {folder && <span className={styles.path}>{shortenFolder(folder, PATH_CHARS)}</span>}
    </span>
  )
}

// Which way a link goes, from the port's island, `name`.
function Way({ link, name }: { link: PortCardLink; name: string }) {
  if (link.outgoing && link.incoming) {
    return (
      <span className={`${styles.way} ${styles.both}`}>
        <span className={styles.dots} aria-hidden="true">
          <span className={`${styles.dot} ${styles.outgoing}`} />
          <span className={`${styles.dot} ${styles.incoming}`} />
        </span>
        {TEXT.both}
      </span>
    )
  }
  const way = link.outgoing ? 'outgoing' : 'incoming'
  return (
    <span className={`${styles.way} ${styles[way]}`}>
      <span className={styles.dot} aria-hidden="true" />
      {link.outgoing ? TEXT.outgoing(name) : TEXT.incoming(name)}
    </span>
  )
}
