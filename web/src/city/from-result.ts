import type { AnalysisResult } from '../data/generated/AnalysisResult'
import type {
  BuildingLanguage,
  CityLayout,
  ConcreteFamily,
  IslandLayout,
  Lot,
  Rect,
} from './layout'
import { slabTop } from './units'

/** The layout is in tenths of a unit. */
const TENTHS = 10

/** The languages the analyzer reads; it reports the others' lines only. */
const ANALYZED = new Set(['TypeScript', 'JavaScript', 'Python', 'Go'])

/** Languages the analyzer does not read, by the shade of concrete they take; docs otherwise. */
const FAMILIES: Record<string, ConcreteFamily> = {
  HTML: 'markup',
  XML: 'markup',
  SVG: 'markup',
  Vue: 'markup',
  Svelte: 'markup',
  JSON: 'data',
  YAML: 'data',
  TOML: 'data',
  SQL: 'data',
  'Protocol Buffers': 'data',
  CSS: 'styles',
  SCSS: 'styles',
  Less: 'styles',
  Shell: 'scripts',
  Dockerfile: 'scripts',
  Makefile: 'scripts',
}

const LANGUAGES: Record<string, BuildingLanguage> = {
  TypeScript: 'typescript',
  JavaScript: 'javascript',
  CSS: 'css',
  Python: 'python',
  Go: 'go',
}

function rect(x: number, y: number, width: number, height: number): Rect {
  return { x: x / TENTHS, y: y / TENTHS, width: width / TENTHS, height: height / TENTHS }
}

/** A lot is 2 × 2 u. */
const LOT_TENTHS = 2 * TENTHS

/** Room between a parcel's edge and its lots, as the analyzer lays them out. */
const LOT_MARGIN = 0.3

function withMargin({ x, y, width, height }: Rect): Rect {
  return {
    x: round(x - LOT_MARGIN),
    y: round(y - LOT_MARGIN),
    width: round(width + 2 * LOT_MARGIN),
    height: round(height + 2 * LOT_MARGIN),
  }
}

/** Keeps tenths exact: 4.5 - 0.3 is 4.2, not 4.199999999999999. */
function round(value: number): number {
  return Math.round(value * TENTHS) / TENTHS
}

/** The city of an analysis result, from the layout the analyzer computed. */
export function cityFromResult(result: AnalysisResult): CityLayout {
  const { dirs, files, layout } = result
  // How many folders below its island each folder is: 0 for the island's own folder
  const islandDirs = new Set(result.islands.dir)
  const level = new Array<number>(dirs.parent.length).fill(0)
  dirs.parent.forEach((parent, dir) => {
    if (parent !== null && !islandDirs.has(dir)) {
      level[dir] = (level[parent] ?? 0) + 1
    }
  })

  const islands: IslandLayout[] = result.islands.dir.map((dir, island) => ({
    path: dirs.name[dir] || '/',
    layer: result.islands.layer[island] ?? 1,
    plateau: rect(
      layout.islands.x[island] ?? 0,
      layout.islands.y[island] ?? 0,
      layout.islands.width[island] ?? 0,
      layout.islands.height[island] ?? 0,
    ),
    parcels: [],
    lots: [],
  }))
  const parcels = layout.parcels
  // A folder whose subfolders have parcels is paved: the gaps between them are its streets.
  const paved = new Set<number>()
  for (const dir of parcels.dir) {
    const parent = dirs.parent[dir]
    if (parent !== null && parent !== undefined && !islandDirs.has(parent)) {
      paved.add(parent)
    }
  }
  const order = parcels.dir.map((_, row) => row)
  // Outer parcels first: a folder comes after its parent
  order.sort((a, b) => (level[parcels.dir[a] ?? 0] ?? 0) - (level[parcels.dir[b] ?? 0] ?? 0))
  for (const row of order) {
    const dir = parcels.dir[row] ?? 0
    islands[dirs.island[dir] ?? 0]?.parcels.push({
      rect: rect(
        parcels.x[row] ?? 0,
        parcels.y[row] ?? 0,
        parcels.width[row] ?? 0,
        parcels.height[row] ?? 0,
      ),
      level: level[dir] ?? 1,
      nature: parcels.nature[row] ?? 'normal',
      paved: paved.has(dir),
    })
  }

  // The own files of a paved folder stand on a slab one level up, with the margin of a parcel;
  // those of an island's folder stand on its plateau, in a square.
  const natureOf = new Map(parcels.dir.map((dir, row) => [dir, parcels.nature[row]]))
  const { grids } = layout
  grids.dir.forEach((dir, row) => {
    const island = islands[dirs.island[dir] ?? 0]
    const lots = withMargin(
      rect(
        grids.x[row] ?? 0,
        grids.y[row] ?? 0,
        (grids.columns[row] ?? 0) * LOT_TENTHS,
        (grids.rows[row] ?? 0) * LOT_TENTHS,
      ),
    )
    if (!island) {
      return
    }
    if (islandDirs.has(dir)) {
      island.square = lots
    } else if (paved.has(dir)) {
      island.parcels.push({
        rect: lots,
        level: (level[dir] ?? 1) + 1,
        nature: natureOf.get(dir) ?? 'normal',
        paved: false,
      })
    }
  })
  const groundLevel = (dir: number) => (level[dir] ?? 0) + (paved.has(dir) ? 1 : 0)

  files.dir.forEach((dir, file) => {
    const scope = files.scope[file]
    const language = result.languages[files.language[file] ?? 0] ?? ''
    const lot: Lot = {
      x: (layout.lots.x[file] ?? 0) / TENTHS,
      y: (layout.lots.y[file] ?? 0) / TENTHS,
      base: slabTop(groundLevel(dir)),
      ground: natureOf.get(dir) ?? 'normal',
      file: {
        language: LANGUAGES[language] ?? 'other',
        lines: files.lines[file] ?? 0,
        complexity: files.complexity[file] ?? 0,
        test: scope === 'test' || scope === 'fixture',
        analyzed: ANALYZED.has(language),
        ...(ANALYZED.has(language) ? {} : { family: FAMILIES[language] ?? 'docs' }),
        generated: files.generated[file] ?? false,
      },
    }
    islands[dirs.island[dir] ?? 0]?.lots.push(lot)
  })

  return { islands, bounds: rect(0, 0, layout.width, layout.height) }
}
