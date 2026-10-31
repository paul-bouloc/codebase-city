import type { Language } from '../Badge'

// Ways files link up and places of the city, in the legend's order.
export const LEGEND_PLACES = [
  'bridge',
  'ferry',
  'port',
  'upward',
  'cycle',
  'canal',
  'park',
] as const
export type LegendPlace = (typeof LEGEND_PLACES)[number]

// The five landmark buildings, named after the role they mark.
export const LANDMARKS = ['entry-point', 'conductor', 'foundation', 'facade', 'config'] as const
export type Landmark = (typeof LANDMARKS)[number]

// What one repository's city shows, as the analysis counts it.
export interface RepoContents {
  // Files per language, tests left out: they are drawn in the test colour.
  languages: readonly { language: Language; files: number }[]
  testFiles: number
  places: ReadonlySet<LegendPlace>
  landmarks: ReadonlySet<Landmark>
}

export interface LegendLanguage {
  language: Language
  // "94%", or "<1%" for a language too small to round to 1.
  share: string
}

export interface LegendContent {
  languages: LegendLanguage[]
  tests: boolean
  places: LegendPlace[]
  landmarks: Landmark[]
}

// The legend lists only what this city shows. Languages go from the most files to the fewest,
// with unanalyzed files last whatever their count.
export function legendContent(repo: RepoContents): LegendContent {
  const present = repo.languages.filter(({ files }) => files > 0)
  const total = present.reduce((sum, { files }) => sum + files, 0)
  const rank = (language: Language) => (language === 'other' ? 1 : 0)
  const languages = [...present]
    .sort((a, b) => rank(a.language) - rank(b.language) || b.files - a.files)
    .map(({ language, files }) => ({ language, share: formatShare(files / total) }))

  return {
    languages,
    tests: repo.testFiles > 0,
    places: LEGEND_PLACES.filter((place) => repo.places.has(place)),
    landmarks: LANDMARKS.filter((landmark) => repo.landmarks.has(landmark)),
  }
}

function formatShare(share: number): string {
  const percent = Math.round(share * 100)
  return percent === 0 ? '<1%' : `${percent}%`
}
