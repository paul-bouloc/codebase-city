import { floorsFor } from '../../src/city/buildings/archetypes'
import type { BuildingLanguage, CityLayout, FileMetrics, Lot } from '../../src/city/world/layout'
import { LOT_SIZE } from '../../src/city/world/units'

interface Sample {
  language: BuildingLanguage
  floors: number
  side: number
  test?: boolean
  analyzed?: boolean
  generated?: boolean
}

// The examples of the design's archetype board, then each archetype at its smallest and largest.
const ROWS: Sample[][] = [
  [
    { language: 'css', floors: 2, side: 1.4 },
    { language: 'javascript', floors: 4, side: 1.3 },
    { language: 'typescript', floors: 9, side: 1.5 },
    { language: 'other', floors: 13, side: 1.4 },
    { language: 'typescript', floors: 20, side: 1.5 },
    { language: 'javascript', floors: 2, side: 1.6 },
    { language: 'other', floors: 1, side: 1.2, test: true },
  ],
  [
    { language: 'css', floors: 1, side: 0.75 },
    { language: 'javascript', floors: 3, side: 0.75 },
    { language: 'typescript', floors: 6, side: 0.75 },
    { language: 'other', floors: 11, side: 0.75 },
    { language: 'typescript', floors: 17, side: 0.75 },
    { language: 'javascript', floors: 1, side: 1.5 },
    { language: 'other', floors: 1, side: 0.75, test: true },
  ],
  [
    { language: 'css', floors: 2, side: 1.49 },
    { language: 'javascript', floors: 5, side: 1.7 },
    { language: 'typescript', floors: 10, side: 1.7 },
    { language: 'other', floors: 16, side: 1.7 },
    { language: 'typescript', floors: 40, side: 1.7 },
    { language: 'javascript', floors: 2, side: 1.7 },
    { language: 'other', floors: 1, side: 1.7, test: true },
  ],
  // Python and Go, generated files, then files of unread languages, short and long
  [
    { language: 'python', floors: 4, side: 1.3 },
    { language: 'go', floors: 9, side: 1.5 },
    { language: 'typescript', floors: 2, side: 1.2, generated: true },
    { language: 'javascript', floors: 4, side: 1.4, generated: true },
    { language: 'typescript', floors: 13, side: 1.5, generated: true },
    { language: 'other', floors: 1, side: 0.9, analyzed: false },
    { language: 'other', floors: 1, side: 1.7, analyzed: false },
  ],
]

const MARGIN = 0.9

/** Metrics that give a building of these floors and footprint. */
function metricsFor({
  language,
  floors,
  side,
  test = false,
  analyzed = true,
  generated = false,
}: Sample): FileMetrics {
  let complexity = 1
  while (floorsFor(complexity) < floors) {
    complexity++
  }
  const lines = Math.round(3000 * ((side - 0.75) / 0.95) ** 2)
  return { language, lines, complexity, test, analyzed, generated }
}

/** One island holding every archetype, to compare with the design. */
export function archetypeGallery(): CityLayout {
  const columns = Math.max(...ROWS.map((row) => row.length))
  const width = columns * LOT_SIZE + 2 * MARGIN
  const height = ROWS.length * LOT_SIZE + 2 * MARGIN
  const plateau = { x: -width / 2, y: -height / 2, width, height }
  const lots: Lot[] = ROWS.flatMap((row, r) =>
    row.map((sample, c) => ({
      x: plateau.x + MARGIN + (c + 0.5) * LOT_SIZE,
      // The board's y points north: the first row is the northernmost.
      y: plateau.y + height - MARGIN - (r + 0.5) * LOT_SIZE,
      file: metricsFor(sample),
    })),
  )
  return { islands: [{ path: 'gallery', layer: 1, plateau, parcels: [], lots }], bounds: plateau }
}
