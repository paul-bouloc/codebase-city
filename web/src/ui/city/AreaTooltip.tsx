import styles from './CityTooltip.module.css'
import { Glass } from './Glass'
import { splitPath } from './shorten-folder'
import type { Point, Rect } from './tooltip-placement'
import { useTooltipPlacement } from './use-tooltip-placement'

const numbers = new Intl.NumberFormat('en-US')

const TEXT = {
  files: (count: number) => `${numbers.format(count)} ${count === 1 ? 'file' : 'files'}`,
  inIsland: (island: string, layer: number) => `in ${island}, layer ${layer}`,
  layer: (layer: number) => `layer ${layer}`,
}

interface AreaTooltipProps {
  // Folder path from the repository root, without a trailing slash.
  path: string
  files: number
  layer: number
  // The island a parcel stands on. Absent when the card is about the island itself.
  island?: string
  pointer: Point
  obstacles?: readonly Rect[]
}

// The short card of a parcel or an island: its folder and its size.
export function AreaTooltip({ path, files, layer, island, pointer, obstacles }: AreaTooltipProps) {
  const { ref, style } = useTooltipPlacement<HTMLDivElement>(pointer, obstacles)
  const { folder, name } = splitPath(path)
  const where = island ? TEXT.inIsland(island, layer) : TEXT.layer(layer)

  return (
    <Glass ref={ref} role="tooltip" className={`${styles.tooltip} ${styles.area}`} style={style}>
      <p className={`${styles.path} ${styles.areaPath}`}>
        <span className={styles.folder}>{folder}</span>
        <span className={styles.name}>{name}</span>
      </p>
      <p className={styles.summary}>{`${TEXT.files(files)} · ${where}`}</p>
    </Glass>
  )
}
