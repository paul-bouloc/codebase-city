import type { AnalysisResult } from '../data/generated/AnalysisResult'
import type {
  BuildingLanguage,
  CityLayout,
  ConcreteFamily,
  FileImport,
  GridRef,
  IslandLayout,
  Lot,
  LotRef,
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

/**
 * Every folder's full path, `/` for the root. The full path, not the name: two islands may share
 * a name (`test` and `src/test`), and an island's path seeds its coast and its decor.
 */
export function folderPaths(dirs: AnalysisResult['dirs']): string[] {
  const paths: string[] = []
  // A folder comes after its parent: its parent's path is known.
  dirs.parent.forEach((parent, dir) => {
    const name = dirs.name[dir] ?? ''
    const above = parent === null ? '' : (paths[parent] ?? '')
    paths[dir] = above === '/' || above === '' ? name : `${above}/${name}`
  })
  return paths.map((path) => path || '/')
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

  const paths = folderPaths(dirs)
  const pathOf = (dir: number): string => paths[dir] ?? '/'
  const islands: IslandLayout[] = result.islands.dir.map((dir, island) => ({
    path: pathOf(dir),
    layer: result.islands.layer[island] ?? 1,
    plateau: rect(
      layout.islands.x[island] ?? 0,
      layout.islands.y[island] ?? 0,
      layout.islands.width[island] ?? 0,
      layout.islands.height[island] ?? 0,
    ),
    parcels: [],
    lots: [],
    grids: [],
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
      path: pathOf(dir),
      level: level[dir] ?? 1,
      nature: parcels.nature[row] ?? 'normal',
      paved: paved.has(dir),
    })
  }

  // The own files of a paved folder stand on a slab one level up, with the margin of a parcel;
  // those of an island's folder stand on its plateau, in a square, and on a slab of their own when
  // they are not ordinary code. The ground under a grid is what most of its own files are.
  const { grids } = layout
  const natureOf = new Map(grids.dir.map((dir, row) => [dir, grids.nature[row] ?? 'normal']))
  const slabbed = new Set(paved)
  for (const dir of grids.dir) {
    if (islandDirs.has(dir) && natureOf.get(dir) !== 'normal') {
      slabbed.add(dir)
    }
  }
  const groundLevel = (dir: number) => (level[dir] ?? 0) + (slabbed.has(dir) ? 1 : 0)
  const gridOf = new Map<number, Rect>()
  const gridRefOf = new Map<number, GridRef>()
  grids.dir.forEach((dir, row) => {
    const island = islands[dirs.island[dir] ?? 0]
    const cells = rect(
      grids.x[row] ?? 0,
      grids.y[row] ?? 0,
      (grids.columns[row] ?? 0) * LOT_TENTHS,
      (grids.rows[row] ?? 0) * LOT_TENTHS,
    )
    gridOf.set(dir, cells)
    const lots = withMargin(cells)
    if (!island) {
      return
    }
    gridRefOf.set(dir, { island: dirs.island[dir] ?? 0, grid: island.grids?.length ?? 0 })
    island.grids?.push({
      rect: cells,
      nature: natureOf.get(dir) ?? 'normal',
      base: slabTop(groundLevel(dir)),
      ...(islandDirs.has(dir) ? { square: true } : {}),
    })
    if (islandDirs.has(dir)) {
      // Its slab, if any, is drawn from the grid: the square stays apart from the folders
      island.square = lots
    } else if (slabbed.has(dir)) {
      island.parcels.push({
        rect: lots,
        level: (level[dir] ?? 1) + 1,
        nature: natureOf.get(dir) ?? 'normal',
        paved: false,
      })
    }
  })

  const filePath = (dir: number, file: number): string => {
    const folder = pathOf(dir)
    const name = files.name[file] ?? ''
    return folder === '/' ? name : `${folder}/${name}`
  }

  const lotOf: (LotRef | undefined)[] = []
  files.dir.forEach((dir, file) => {
    const scope = files.scope[file]
    const language = result.languages[files.language[file] ?? 0] ?? ''
    const lot: Lot = {
      x: (layout.lots.x[file] ?? 0) / TENTHS,
      y: (layout.lots.y[file] ?? 0) / TENTHS,
      base: slabTop(groundLevel(dir)),
      ground: natureOf.get(dir) ?? 'normal',
      ...(gridOf.has(dir) ? { grid: gridOf.get(dir) } : {}),
      file: {
        path: filePath(dir, file),
        language: LANGUAGES[language] ?? 'other',
        lines: files.lines[file] ?? 0,
        complexity: files.complexity[file] ?? 0,
        test: scope === 'test' || scope === 'fixture',
        analyzed: ANALYZED.has(language),
        ...(ANALYZED.has(language) ? {} : { family: FAMILIES[language] ?? 'docs' }),
        generated: files.generated[file] ?? false,
      },
    }
    const island = dirs.island[dir] ?? 0
    const lots = islands[island]?.lots
    if (lots) {
      lotOf[file] = { island, lot: lots.length }
      lots.push(lot)
    }
  })

  const links = result.links.from.map((from, row) => ({
    from,
    to: result.links.to[row] ?? from,
    imports: result.links.imports[row] ?? 0,
    upward: result.links.upward[row] ?? 0,
  }))
  return {
    islands,
    bounds: rect(0, 0, layout.width, layout.height),
    links,
    imports: fileImports(result, lotOf, gridRefOf),
  }
}

/**
 * Imports between files, by their lots, or to a folder's grid. One goes up the layers when its
 * file's island is lower than the island it imports, as the analyzer counts them between islands:
 * a barrel's re-exports never do, and an island with no layer (tests only) is on none.
 */
function fileImports(
  result: AnalysisResult,
  lotOf: readonly (LotRef | undefined)[],
  gridOf: ReadonlyMap<number, GridRef>,
): FileImport[] {
  const { edges, dirs, files } = result
  const layer = result.islands.layer
  const imports: FileImport[] = []
  edges.from.forEach((file, row) => {
    const from = lotOf[file]
    const toFile = edges.to[row]
    const toDir = edges.toDir[row]
    const to =
      toFile !== null && toFile !== undefined
        ? lotOf[toFile]
        : toDir !== null && toDir !== undefined
          ? gridOf.get(toDir)
          : undefined
    if (!from || !to) {
      return
    }
    const fromLayer = layer[dirs.island[files.dir[file] ?? 0] ?? 0]
    const toLayer = layer[to.island]
    const upward =
      edges.kind[row] !== 'reexport' &&
      fromLayer !== null &&
      fromLayer !== undefined &&
      toLayer !== null &&
      toLayer !== undefined &&
      toLayer > fromLayer
    imports.push({ from, to, upward })
  })
  return imports
}
