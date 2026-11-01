import type { AnalysisResult } from '../data/generated/AnalysisResult'
import type { BuildingLanguage, CityLayout, IslandLayout, Lot, Rect } from './layout'
import { slabTop } from './units'

/** The layout is in tenths of a unit. */
const TENTHS = 10

/** The languages the analyzer reads; it reports the others' lines only. */
const ANALYZED = new Set(['TypeScript', 'JavaScript', 'Python', 'Go'])

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
    })
  }

  files.dir.forEach((dir, file) => {
    const scope = files.scope[file]
    const language = result.languages[files.language[file] ?? 0] ?? ''
    const lot: Lot = {
      x: (layout.lots.x[file] ?? 0) / TENTHS,
      y: (layout.lots.y[file] ?? 0) / TENTHS,
      base: slabTop(level[dir] ?? 0),
      file: {
        language: LANGUAGES[language] ?? 'other',
        lines: files.lines[file] ?? 0,
        complexity: files.complexity[file] ?? 0,
        test: scope === 'test' || scope === 'fixture',
        analyzed: ANALYZED.has(language),
        generated: files.generated[file] ?? false,
      },
    }
    islands[dirs.island[dir] ?? 0]?.lots.push(lot)
  })

  return { islands, bounds: rect(0, 0, layout.width, layout.height) }
}
