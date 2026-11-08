import { Glass } from '../../screen/parts/Glass'
import { shortenFolder, splitPath } from '../../screen/parts/shorten-folder'
import { exactCount } from '../count-format'
import styles from './CityTooltip.module.css'
import type { Point, Rect } from './tooltip-placement'
import { useTooltipPlacement } from './use-tooltip-placement'

const TEXT = {
  files: (count: number) => `${exactCount(count)} ${count === 1 ? 'file' : 'files'}`,
  inIsland: (island: string) => `in ${island}`,
  layer: (layer: number) => `layer ${layer}`,
}

// Characters of the path line: 380 px wide, 14 px padding each side, mono 13 at 7.8 px.
const PATH_CHARS = 45

interface AreaTooltipProps {
  // Folder path from the repository root, without a trailing slash.
  path: string
  files: number
  // Absent for an island without production code, which has no layer.
  layer?: number
  // The island a parcel stands on. Absent when the card is about the island itself.
  island?: string
  pointer: Point
  obstacles?: readonly Rect[]
}

// The short card of a parcel or an island: its folder and its size.
export function AreaTooltip({ path, files, layer, island, pointer, obstacles }: AreaTooltipProps) {
  const { ref, style } = useTooltipPlacement<HTMLDivElement>(pointer, obstacles)
  const { folder, name } = splitPath(path)
  // The folder gives way first, from its start, as on a file's card.
  const shortFolder = shortenFolder(folder, PATH_CHARS - name.length)
  const where = [
    island !== undefined && TEXT.inIsland(island),
    layer !== undefined && TEXT.layer(layer),
  ].filter(Boolean)

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
      <p className={styles.summary}>
        {[TEXT.files(files), where.join(', ')].filter(Boolean).join(' · ')}
      </p>
    </Glass>
  )
}
