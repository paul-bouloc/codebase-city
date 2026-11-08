import type { LinkStats } from '../../city/engine/frame-stats'
import { languageOf, type ResultIndex } from '../result-index'
import type { LegendPlace, RepoContents } from './legend-content'

/**
 * What the legend lists for this city: what the result holds, and how the engine drew the links
 * between islands. Landmark buildings are not drawn yet, so none is listed.
 */
export function repoContents(index: ResultIndex, links: LinkStats): RepoContents {
  const { result } = index
  const { files } = result
  const byLanguage = new Map<ReturnType<typeof languageOf>, number>()
  let testFiles = 0
  files.language.forEach((language, file) => {
    // Tests are drawn in the test colour, whatever their language.
    if (files.scope[file] === 'test') {
      testFiles++
      return
    }
    const shown = languageOf(result.languages[language] ?? '')
    byLanguage.set(shown, (byLanguage.get(shown) ?? 0) + 1)
  })

  const { parcels } = result.layout
  const places = new Set<LegendPlace>()
  if (links.bridges > 0) {
    places.add('bridge')
  }
  if (links.ferries > 0) {
    places.add('ferry')
  }
  if (links.inPorts > 0) {
    places.add('port')
  }
  if (result.links.upward.some((count) => count > 0)) {
    places.add('upward')
  }
  if (result.cycles.members.length > 0) {
    places.add('cycle')
  }
  // Folders inside an island stand apart across canals.
  if (parcels.dir.length > 0) {
    places.add('canal')
  }
  // Tests stand in a park: a parcel's ground, or a grid's.
  if (parcels.nature.includes('tests') || result.layout.grids.nature.includes('tests')) {
    places.add('park')
  }

  return {
    languages: [...byLanguage].map(([language, files]) => ({ language, files })),
    testFiles,
    places,
    landmarks: new Set(),
  }
}
