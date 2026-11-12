import { describe, expect, it } from 'vitest'
import { decodeResult } from '../../data/decode-result'
import type { AnalysisResult } from '../../data/generated/AnalysisResult'
import sample from '../../data/generated/sample-result.json'
import type { GuideUnit } from '../../guide/guide-units'
import {
  FULL_LABELS,
  guideUnitLabels,
  MAX_LABELS,
  shortName,
  unitCaption,
} from './guide-unit-labels'

const sampleResult = decodeResult(sample)

// Packages `web` (0, at the root), `ui` (1) and `billing-api` (2); the group `billing`.
const result: AnalysisResult = {
  ...sampleResult,
  packages: {
    ...sampleResult.packages,
    dir: [0, 3, 4],
    name: ['web', 'ui', 'billing-api'],
  },
  packageGroups: { prefix: ['billing'], linked: [false] },
}

function unit(change: Partial<GuideUnit>): GuideUnit {
  return {
    kind: 'app',
    packages: [2],
    packageKind: 'app',
    group: null,
    folders: [4],
    host: null,
    framework: null,
    codeFiles: 510,
    importers: null,
    ...change,
  }
}

describe('unitCaption', () => {
  it('gives an app its framework and its files', () => {
    expect(unitCaption(unit({ framework: 'nextjs', codeFiles: 7878 }), result)).toBe(
      'app · Next.js · 7,878 files',
    )
    expect(unitCaption(unit({ codeFiles: 1 }), result)).toBe('app · 1 file')
  })

  it('gives a library the packages that import it, when there are some', () => {
    const library = { kind: 'library', packageKind: 'library' } as const
    expect(unitCaption(unit({ ...library, codeFiles: 24, importers: 27 }), result)).toBe(
      'library · 24 files · by 27 packages',
    )
    expect(unitCaption(unit({ ...library, importers: 1 }), result)).toBe(
      'library · 510 files · by 1 package',
    )
    expect(unitCaption(unit({ ...library, importers: 0 }), result)).toBe('library · 510 files')
  })

  it('counts the apps of a group', () => {
    const group = unit({ kind: 'group', packages: [1, 2, 0], group: 0, codeFiles: 2516 })
    expect(unitCaption(group, result)).toBe('3 apps · 2,516 files')
  })

  it('says how many islands the root stands on, and of how many past 24', () => {
    const root = unit({ kind: 'root', packages: [0], folders: [0, 1, 2], codeFiles: 2490 })
    expect(unitCaption(root, result)).toBe('app · repository root · 3 islands · 2,490 files')
    const islands = Array.from({ length: 216 }, (_, at) => at)
    const wide = { ...result, islands: { dir: islands, layer: islands.map(() => null) } }
    const many = unit({ kind: 'root', packages: [0], folders: islands.slice(0, 190) })
    expect(unitCaption(many, wide)).toBe('app · repository root · 190 of 216 islands · 510 files')
  })

  it('names the package a package lies inside, the root by the repository', () => {
    const inside = {
      kind: 'library',
      packageKind: 'library',
      importers: 3,
      codeFiles: 412,
    } as const
    expect(unitCaption(unit({ ...inside, host: 1 }), result)).toBe(
      'library inside ui · 412 files · by 3 packages',
    )
    expect(unitCaption(unit({ ...inside, host: 0 }), result)).toBe(
      'library inside harbor · 412 files · by 3 packages',
    )
  })
})

describe('shortName', () => {
  it('keeps a name that fits', () => {
    expect(shortName('@grafana/data', 26)).toBe('@grafana/data')
  })

  it('keeps the last two segments, else the last, else cuts its end', () => {
    expect(shortName('github.com/grafana/grafana/pkg/storage/unified/resourceclient', 26)).toBe(
      '…/unified/resourceclient',
    )
    expect(shortName('github.com/grafana/grafana/pkg/storage/unified/resourceclient', 18)).toBe(
      '…/resourceclient',
    )
    expect(shortName('@grafana-plugins/grafana-testdata-datasource', 26)).toBe(
      '…/grafana-testdata-dataso…',
    )
    expect(shortName('@grafana-plugins/grafana-testdata-datasource', 18)).toHaveLength(18)
  })
})

describe('guideUnitLabels', () => {
  it('gives figures to the first labels, the name alone to the next, nothing past them', () => {
    const units = Array.from({ length: MAX_LABELS + 2 }, () => unit({}))
    const labels = guideUnitLabels(units, result)
    expect(labels[0]).toEqual({ name: 'billing-api', caption: 'app · 510 files' })
    expect(labels[FULL_LABELS]).toEqual({ name: 'billing-api', caption: null })
    expect(labels.filter((label) => label?.caption).length).toBe(FULL_LABELS)
    expect(labels.filter((label) => label !== null).length).toBe(MAX_LABELS)
  })

  it('names a group by its prefix and the root by the repository', () => {
    const labels = guideUnitLabels(
      [unit({ kind: 'group', group: 0 }), unit({ kind: 'root', packages: [0] })],
      result,
    )
    expect(labels.map((label) => label?.name)).toEqual(['billing', 'harbor'])
  })
})
