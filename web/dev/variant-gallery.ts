import { buildingFor, floorsFor } from '../src/city/archetypes'
import type { CityLayout, FileMetrics, IslandLayout, Lot } from '../src/city/layout'
import { LOT_SIZE } from '../src/city/units'

// Every combination of the low buildings' pieces, an island per archetype, to compare with the
// design's boards: each one stands on a file whose path draws it.

const COLUMNS = 10
const MARGIN = 0.9
const GAP = 6
const TRIES = 20000

/** Metrics of a building of these floors and footprint, as the archetype gallery makes them. */
function metrics(floors: number, side: number, extra: Partial<FileMetrics>): FileMetrics {
  let complexity = 1
  while (floorsFor(complexity) < floors) {
    complexity++
  }
  const lines = Math.round(3000 * ((side - 0.75) / 0.95) ** 2)
  return { language: 'typescript', lines, complexity, test: false, ...extra }
}

/**
 * The sides and floors that, together, let every combination of an archetype appear, each new
 * combination once; then a row of other colours and of generated files.
 */
const FAMILIES: { name: string; files: FileMetrics[]; rows?: FileMetrics[] }[] = [
  {
    name: 'house',
    files: [metrics(1, 1.2, {}), metrics(2, 1.2, {}), metrics(1, 1.45, {}), metrics(1, 0.9, {})],
    rows: [
      metrics(1, 1.2, { language: 'css' }),
      metrics(1, 1.2, { language: 'javascript', generated: true }),
    ],
  },
  {
    name: 'pavilion',
    files: [
      metrics(1, 1.2, { test: true }),
      metrics(2, 1.2, { test: true }),
      metrics(1, 1.45, { test: true }),
    ],
    rows: [metrics(1, 1.2, { test: true, generated: true })],
  },
  {
    // Concrete rises with its lines: a floor per 150 lines
    name: 'concrete',
    files: [100, 250, 400, 600, 900].map((lines) => ({
      language: 'other',
      lines,
      complexity: 0,
      test: false,
      analyzed: false,
      family: 'docs',
    })),
    rows: [
      {
        language: 'other',
        lines: 400,
        complexity: 0,
        test: false,
        analyzed: false,
        family: 'data',
        generated: true,
      },
    ],
  },
]

/** A file for each combination the files reach, in the order they were found, `limit` at most. */
function combinations(name: string, files: FileMetrics[], limit = Number.POSITIVE_INFINITY) {
  const found = new Map<string, FileMetrics>()
  files.forEach((file, kind) => {
    for (let i = 0; i < TRIES && found.size < limit; i++) {
      const path = `${name}/${kind}/${i}`
      const key = buildingFor({ ...file, path }).pieces.join('.')
      if (!found.has(key)) {
        found.set(key, { ...file, path })
      }
    }
  })
  return [...found.values()]
}

export function variantGallery(): CityLayout {
  let top = 0
  const islands: IslandLayout[] = FAMILIES.map(({ name, files, rows = [] }) => {
    const found = [
      ...combinations(name, files),
      ...rows.flatMap((row, index) => combinations(`${name}-row${index}`, [row], COLUMNS)),
    ]
    const height = Math.ceil(found.length / COLUMNS) * LOT_SIZE + 2 * MARGIN
    const width = COLUMNS * LOT_SIZE + 2 * MARGIN
    const plateau = { x: -width / 2, y: top - height, width, height }
    top -= height + GAP
    const lots: Lot[] = found.map((file, index) => ({
      x: plateau.x + MARGIN + ((index % COLUMNS) + 0.5) * LOT_SIZE,
      y: plateau.y + height - MARGIN - (Math.floor(index / COLUMNS) + 0.5) * LOT_SIZE,
      file,
    }))
    return { path: `variants/${name}`, layer: 1, plateau, parcels: [], lots }
  })
  const plateaux = islands.map((island) => island.plateau)
  const x = Math.min(...plateaux.map((p) => p.x))
  const y = Math.min(...plateaux.map((p) => p.y))
  const right = Math.max(...plateaux.map((p) => p.x + p.width))
  return {
    islands,
    bounds: { x, y, width: right - x, height: -y },
  }
}
