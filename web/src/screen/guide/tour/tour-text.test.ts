import { describe, expect, it } from 'vitest'
import { decodeResult } from '../../../data/decode-result'
import type { AnalysisResult } from '../../../data/generated/AnalysisResult'
import sample from '../../../data/generated/sample-result.json'
import type { TourStep } from '../../../data/generated/TourStep'
import { indexResult } from '../../result-index'
import { counted, listed, share, type TourSpan, type TourText, tourContext } from './tour-spans'
import { tourNote, tourText } from './tour-text'

/** The sample, changed. */
function result(change: (result: AnalysisResult) => void = () => {}): AnalysisResult {
  const decoded = decodeResult(structuredClone(sample))
  change(decoded)
  return decoded
}

/** A text as it reads: chips in backticks, islands in brackets, names in stars. */
function plain(spans: readonly TourSpan[]): string {
  return spans
    .map((span) => {
      if (typeof span === 'string') {
        return span
      }
      switch (span.kind) {
        case 'file':
        case 'folder':
          return `\`${span.path}\``
        case 'island':
          return `[${span.name}${span.count === null ? '' : ` ×${span.count}`}]`
        default:
          return `*${span.text}*`
      }
    })
    .join('')
}

function textOf(of: AnalysisResult, step: TourStep): TourText {
  return tourText(tourContext(indexResult(of)), step)
}

function stepOf<K extends TourStep['kind']>(
  of: AnalysisResult,
  kind: K,
): Extract<TourStep, { kind: K }> {
  return of.tour.steps.find((step) => step.kind === kind) as Extract<TourStep, { kind: K }>
}

describe('tour words', () => {
  it('lists one, two or three items', () => {
    expect(plain(listed([['a']]))).toBe('a')
    expect(plain(listed([['a'], ['b']]))).toBe('a and b')
    expect(plain(listed([['a'], ['b'], ['c']]))).toBe('a, b and c')
  })

  it('counts in the singular and the plural', () => {
    expect(counted(1, 'file')).toBe('1 file')
    expect(counted(1204, 'file')).toBe('1,204 files')
    expect(counted(2, 'library', 'libraries')).toBe('2 libraries')
  })

  it('never rounds a share to its edges', () => {
    expect(share(1, 1000)).toBe('<1%')
    expect(share(94, 100)).toBe('94%')
    expect(share(41862, 41903)).toBe('99.9%')
    expect(share(99999, 100000)).toBe('99.9%')
    expect(share(5, 5)).toBe('100%')
    expect(share(0, 0)).toBe('0%')
  })
})

describe('tourText', () => {
  it('opens on the repository, its islands and its main language', () => {
    const of = result()
    const text = textOf(of, stepOf(of, 'overview'))
    expect(text.title).toBe('Overview')
    expect(plain(text.text)).toBe(
      '*acme/harbor*: 19 files across 8 islands. Most of the code is TypeScript (94%).',
    )
    expect(text.closer.map((chip) => plain(chip.spans))).toEqual([
      'The biggest island: [core] · 5 files',
      '[tests] · no production code',
    ])
    expect(text.closer[0]?.target).toEqual({ kind: 'islands', folders: ['src/core'] })
  })

  it('says a language it does not read is shown only, and how many the docs come in', () => {
    const of = result()
    const step = { ...stepOf(of, 'overview'), languageRead: false, docLanguages: 12 }
    expect(plain(textOf(of, step).text)).toBe(
      '*acme/harbor*: 19 files across 8 islands. Most of the code is TypeScript (94%), shown but not analyzed. The documentation comes in 12 languages.',
    )
  })

  it('tells a declared entry point from a guessed one, with its command', () => {
    const of = result()
    const step = stepOf(of, 'entryPoints')
    expect(plain(textOf(of, step).text)).toBe(
      'The application starts here: `src/main.ts`. package.json names it as the package’s main file.',
    )
    const guessed = result((changed) => {
      changed.roles.entries.reasons[0] = ['noImporter']
      changed.roles.entries.command[0] = 'harbor'
    })
    expect(plain(textOf(guessed, step).text)).toBe(
      'Likely the entry point: `src/main.ts`. Nothing in the project imports it. It runs as *harbor*.',
    )
  })

  it('names the next conductors and foundations under LOOK CLOSER', () => {
    const of = result()
    const conductors = textOf(of, stepOf(of, 'conductors'))
    expect(plain(conductors.text)).toBe(
      '`src/app.ts` pulls together 11 files, directly or not. It likely assembles the application.',
    )
    const foundations = textOf(of, stepOf(of, 'foundations'))
    expect(plain(foundations.text)).toBe(
      'Most foundations sit on [core]. 11 files depend on `src/core/utils.ts`, directly or not.',
    )
    expect(foundations.closer.map((chip) => plain(chip.spans))).toEqual([
      '`src/core/types.ts` · 9 dependents',
      '`src/core/events.ts` · 7 dependents',
    ])
    expect(foundations.closer[0]?.target).toEqual({ kind: 'file', path: 'src/core/types.ts' })
  })

  it('says the layers from the bottom up, and where imports go up', () => {
    const of = result()
    const step = stepOf(of, 'layers')
    expect(plain(textOf(of, step).text)).toBe(
      'The islands stand in 3 layers, from [core] at the bottom to [src] at the top. No import between them goes up.',
    )
    const upward = result((changed) => {
      changed.links.productionUpward[3] = 3
    })
    const text = textOf(upward, { ...step, down: 997, up: 3, worstLink: 3 })
    expect(plain(text.text)).toContain('99.7% of the imports between them go down or across.')
    expect(text.closer.map((chip) => plain(chip.spans))).toEqual([
      '3 imports up from [ui] to [core]',
    ])
    expect(text.closer[0]?.target).toEqual({ kind: 'islands', folders: ['src/ui', 'src/core'] })
  })

  it('says how large the loop is, among how many', () => {
    const of = result()
    expect(plain(textOf(of, stepOf(of, 'cycles')).text)).toBe(
      '2 files in `src/core` import each other in a loop, the largest of 2.',
    )
  })

  it('says where tests and configuration live', () => {
    const of = result()
    const step = stepOf(of, 'rest')
    expect(plain(textOf(of, step).text)).toBe(
      'Tests live in 1 park (2 files). Configuration sits at the root (2 files).',
    )
    const scattered = { ...step, parkCount: 0, parkTests: 0, rootConfig: 0, examples: 1, docs: 4 }
    expect(plain(textOf(of, scattered).text)).toBe(
      '2 files of tests stand among the code. 2 configuration files. Also 1 example and 4 files of documentation.',
    )
  })

  it('names what the code builds on and where it is declared', () => {
    const of = result()
    const text = textOf(of, stepOf(of, 'builtOn'))
    expect(plain(text.text)).toMatch(/^The code builds on \*[^*]+\* \(\d+% of the code files\)\.$/)
    expect(text.closer.map((chip) => plain(chip.spans))).toEqual(['`package.json` declares them'])
  })

  it('gives the mark over a roof its measure', () => {
    const of = result()
    const context = tourContext(indexResult(of))
    expect(tourNote(context, stepOf(of, 'entryPoints'))).toBe('entry point')
    expect(tourNote(context, stepOf(of, 'foundations'))).toBe('11 dependents')
    expect(tourNote(context, stepOf(of, 'layers'))).toBe('')
  })
})

describe('tourText of packages', () => {
  /** The sample with `src`, `ui` and `api` as apps, `ui` and `api` a group, `core` a library. */
  function monorepo(): AnalysisResult {
    return result((changed) => {
      changed.workspaces = [{ kind: 'npm', manifest: 0 }]
      changed.packages = {
        dir: [1, 2, 3, 4],
        name: ['web', '@acme/core', 'acme-ui', 'acme-api'],
        kind: ['app', 'library', 'app', 'app'],
        framework: ['nextjs', null, null, 'nestjs'],
        manifest: [null, null, null, null],
        group: [null, null, 0, 0],
        codeFiles: [2, 5, 4, 2],
        entry: [2, null, null, null],
        routes: [null, null, null, null],
        routeCount: [0, 0, 0, 0],
        apiRouteCount: [0, 0, 0, 0],
      }
      changed.packageGroups = { prefix: ['acme'], linked: [false] }
    })
  }

  it('names the main apps, a group with its count, and the smaller ones next', () => {
    const of = monorepo()
    of.tour.steps = [
      stepOf(of, 'overview'),
      {
        kind: 'applications',
        units: [
          { group: 0, apps: [2, 3], files: 6 },
          { group: null, apps: [0], files: 2 },
        ],
        appFiles: 8,
      },
      { kind: 'otherApps', apps: [0] },
    ]
    const text = textOf(of, of.tour.steps[1] as TourStep)
    expect(plain(text.text)).toBe(
      '8 files are apps. The main ones: [acme ×2] (2 apps, 6 files) and [web] (Next.js, 2).',
    )
    expect(text.closer).toEqual([
      { target: { kind: 'next' }, spans: ['1 smaller app · next step'] },
    ])
  })

  it('says whether apps import each other, and what they share', () => {
    const of = monorepo()
    const step: TourStep = {
      kind: 'appLinks',
      appImports: 0,
      shared: [{ library: 1, apps: [0, 2], files: [2, 3], typeOnly: [1, 0] }],
    }
    expect(plain(textOf(of, step).text)).toBe(
      'The apps don’t import each other. [web] and [acme-ui] share [@acme/core]: 5 files import it, 1 for types only.',
    )
    expect(plain(textOf(of, { ...step, appImports: 1, shared: [] }).text)).toBe(
      '1 import goes from one app to another.',
    )
  })

  it('looks inside the main app, and where it starts from', () => {
    const of = monorepo()
    const text = textOf(of, { kind: 'insidePackage', package: 0, dirs: [1], files: [2] })
    expect(text.title).toBe('Inside the main app')
    expect(plain(text.text)).toBe('Inside [web]: `src` (2 files).')
    expect(text.closer.map((chip) => plain(chip.spans))).toEqual(['It starts from `src/main.ts`'])
  })
})
