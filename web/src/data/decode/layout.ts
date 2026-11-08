import type { Dirs } from '../generated/Dirs'
import type { Files } from '../generated/Files'
import type { Grids } from '../generated/Grids'
import type { Islands } from '../generated/Islands'
import type { Layout } from '../generated/Layout'
import type { Parcels } from '../generated/Parcels'
import type { Rects } from '../generated/Rects'
import {
  column,
  fail,
  inBounds,
  isParcelNature,
  object,
  sameLength,
  u32,
  u32Column,
} from './checks'

/** Lots are 2 × 2 u, in tenths. */
const LOT = 20
/** A city of n files spans at most (n + 16) × 1,000 u², in tenths, as the Rust model checks. */
const MAX_AREA_PER_FILE = 100_000
const SLACK_FILES = 16
/** At most 8 lots a file, and 256 more. */
const MAX_LOTS_PER_FILE = 8
const SLACK_LOTS = 256

interface Box {
  x: number
  y: number
  width: number
  height: number
}

function contains(outer: Box, inner: Box): boolean {
  return (
    inner.width > 0 &&
    inner.height > 0 &&
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.width <= outer.x + outer.width &&
    inner.y + inner.height <= outer.y + outer.height
  )
}

function overlaps(a: Box, b: Box): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height
}

function decodeRects(value: unknown, path: string, count: number): Rects {
  const fields = object(value, path)
  const rects: Rects = {
    x: u32Column(fields.x, `${path}.x`),
    y: u32Column(fields.y, `${path}.y`),
    width: u32Column(fields.width, `${path}.width`),
    height: u32Column(fields.height, `${path}.height`),
  }
  sameLength(`${path}.x`, count, rects.x)
  sameLength(`${path}.y`, count, rects.y)
  sameLength(`${path}.width`, count, rects.width)
  sameLength(`${path}.height`, count, rects.height)
  return rects
}

function box(rects: Rects, row: number): Box {
  return {
    x: rects.x[row] as number,
    y: rects.y[row] as number,
    width: rects.width[row] as number,
    height: rects.height[row] as number,
  }
}

/**
 * Islands lie in the city, parcels and grids in their island or parent
 * parcel without overlapping, and each file on a lot of its folder's grid.
 */
export function decodeLayout(value: unknown, dirs: Dirs, islands: Islands, files: Files): Layout {
  const fields = object(value, 'layout')
  const dirCount = dirs.parent.length
  const plateaux = decodeRects(fields.islands, 'layout.islands', islands.dir.length)
  const parcelFields = object(fields.parcels, 'layout.parcels')
  const parcelDirs = u32Column(parcelFields.dir, 'layout.parcels.dir')
  const parcels: Parcels = {
    dir: parcelDirs,
    ...decodeRects(parcelFields, 'layout.parcels', parcelDirs.length),
    nature: column(parcelFields.nature, 'layout.parcels.nature', isParcelNature, 'a nature'),
  }
  sameLength('layout.parcels.nature', parcelDirs.length, parcels.nature)
  inBounds('layout.parcels.dir', parcels.dir, dirCount)
  const gridFields = object(fields.grids, 'layout.grids')
  const grids: Grids = {
    dir: u32Column(gridFields.dir, 'layout.grids.dir'),
    x: u32Column(gridFields.x, 'layout.grids.x'),
    y: u32Column(gridFields.y, 'layout.grids.y'),
    columns: u32Column(gridFields.columns, 'layout.grids.columns'),
    rows: u32Column(gridFields.rows, 'layout.grids.rows'),
    nature: column(gridFields.nature, 'layout.grids.nature', isParcelNature, 'a nature'),
  }
  const gridCount = grids.dir.length
  sameLength('layout.grids.x', gridCount, grids.x)
  sameLength('layout.grids.y', gridCount, grids.y)
  sameLength('layout.grids.columns', gridCount, grids.columns)
  sameLength('layout.grids.rows', gridCount, grids.rows)
  sameLength('layout.grids.nature', gridCount, grids.nature)
  inBounds('layout.grids.dir', grids.dir, dirCount)
  const lotFields = object(fields.lots, 'layout.lots')
  const lots = {
    x: u32Column(lotFields.x, 'layout.lots.x'),
    y: u32Column(lotFields.y, 'layout.lots.y'),
  }
  sameLength('layout.lots.x', files.dir.length, lots.x)
  sameLength('layout.lots.y', files.dir.length, lots.y)
  for (const [table, dirColumn] of [
    ['layout.parcels', parcels.dir],
    ['layout.grids', grids.dir],
  ] as const) {
    for (let row = 1; row < dirColumn.length; row++) {
      if ((dirColumn[row - 1] as number) >= (dirColumn[row] as number)) {
        fail(`${table}[${row}] must come after the previous row, by folder`)
      }
    }
  }

  const own = new Array<number>(dirCount).fill(0)
  for (const dir of files.dir) {
    own[dir] = (own[dir] as number) + 1
  }
  const below = [...own]
  for (let dir = dirCount - 1; dir > 0; dir--) {
    const parent = dirs.parent[dir]
    if (parent !== null && parent !== undefined) {
      below[parent] = (below[parent] as number) + (below[dir] as number)
    }
  }
  const parcelOf = new Map(parcels.dir.map((dir, row) => [dir, row]))
  const container = (dir: number): Box | null => {
    const island = dirs.island[dir]
    if (island === null || island === undefined) {
      return null
    }
    if (islands.dir[island] === dir) {
      return box(plateaux, island)
    }
    const row = parcelOf.get(dir)
    return row === undefined ? null : box(parcels, row)
  }
  const width = u32(fields.width, 'layout.width')
  const height = u32(fields.height, 'layout.height')
  const city = { x: 0, y: 0, width, height }
  // However it came, a layout stays in proportion to its files: the city draws every lot and
  // every metre of shore of it.
  const fileCount = files.dir.length
  if (width * height > (fileCount + SLACK_FILES) * MAX_AREA_PER_FILE) {
    fail('the layout is too large for its files: layout.width and layout.height')
  }
  let lotCount = 0
  grids.columns.forEach((columns, row) => {
    lotCount += columns * (grids.rows[row] as number)
  })
  if (lotCount > MAX_LOTS_PER_FILE * fileCount + SLACK_LOTS) {
    fail('the layout is too large for its files: layout.grids')
  }
  // The rectangles that share a container: the islands of the city, or what
  // holds a folder's content
  const groups = new Map<number, { table: string; row: number; box: Box }[]>()
  const join = (key: number, table: string, row: number, rect: Box) => {
    const group = groups.get(key) ?? []
    group.push({ table, row, box: rect })
    groups.set(key, group)
  }
  for (let island = 0; island < islands.dir.length; island++) {
    if (!contains(city, box(plateaux, island))) {
      fail(`layout.islands[${island}] must have a size and lie inside its island, parcel or city`)
    }
    join(-1, 'layout.islands', island, box(plateaux, island))
  }
  parcels.dir.forEach((dir, row) => {
    const island = dirs.island[dir]
    const parent = dirs.parent[dir]
    const valid =
      (below[dir] as number) > 0 &&
      island !== null &&
      island !== undefined &&
      islands.dir[island] !== dir
    const outer = valid && parent !== null && parent !== undefined ? container(parent) : null
    if (outer === null || parent === null || parent === undefined) {
      fail(
        `layout.parcels.dir[${row}] must be a folder with files, inside an island, not the one the island is named after, whose parent has a parcel or is that folder`,
      )
    }
    if (!contains(outer, box(parcels, row))) {
      fail(`layout.parcels[${row}] must have a size and lie inside its island, parcel or city`)
    }
    join(parent, 'layout.parcels', row, box(parcels, row))
  })
  grids.dir.forEach((dir, row) => {
    const outer = (own[dir] as number) > 0 ? container(dir) : null
    if (outer === null) {
      fail(`layout.grids.dir[${row}] must be a folder of an island with files of its own`)
    }
    const rect = {
      x: grids.x[row] as number,
      y: grids.y[row] as number,
      width: (grids.columns[row] as number) * LOT,
      height: (grids.rows[row] as number) * LOT,
    }
    if (!contains(outer, rect)) {
      fail(`layout.grids[${row}] must have a size and lie inside its island, parcel or city`)
    }
    join(dir, 'layout.grids', row, rect)
  })
  for (const group of groups.values()) {
    group.sort((a, b) => a.box.x - b.box.x)
    group.forEach((item, index) => {
      // Indexed rather than sliced: a slice copies the rest of the group on every item.
      for (let next = index + 1; next < group.length; next++) {
        const other = group[next] as (typeof group)[number]
        if (other.box.x >= item.box.x + item.box.width) {
          break
        }
        if (overlaps(item.box, other.box)) {
          fail(
            `${other.table}[${other.row}] overlaps another rectangle of the same island or parcel`,
          )
        }
      }
    })
  }

  const gridOf = new Map(grids.dir.map((dir, row) => [dir, row]))
  const onAxis = (at: number, start: number, count: number) => {
    const offset = at - start - LOT / 2
    return offset >= 0 && offset % LOT === 0 && offset / LOT < count
  }
  const taken = new Set<string>()
  files.dir.forEach((dir, row) => {
    const grid = gridOf.get(dir)
    const x = lots.x[row] as number
    const y = lots.y[row] as number
    if (
      grid === undefined ||
      !onAxis(x, grids.x[grid] as number, grids.columns[grid] as number) ||
      !onAxis(y, grids.y[grid] as number, grids.rows[grid] as number)
    ) {
      fail(`layout.lots[${row}] must be the centre of a lot of its folder's grid`)
    }
    const key = `${x},${y}`
    if (taken.has(key)) {
      fail(`layout.lots[${row}] shares its lot with another file`)
    }
    taken.add(key)
  })
  return { width, height, islands: plateaux, parcels, grids, lots }
}
