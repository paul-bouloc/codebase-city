import { describe, expect, it } from 'vitest'
import { pickVariant, quarterTurnsFor, type VariantContext } from './variants'
import { KIT, type Rule, type VariantArchetype } from './variants-kit'

/** The sides and floors each archetype takes from the data. */
const RANGES: Record<VariantArchetype, { sides: [number, number]; floors: number[] }> = {
  house: { sides: [0.75, 1.5], floors: [1, 2] },
  pavilion: { sides: [0.75, 1.54], floors: [1, 2] },
  concreteBlock: { sides: [0.75, 1.7], floors: [1, 2, 3, 4] },
}

/** Many buildings across the archetype's sides and floors, each with a path of its own. */
function* sample(archetype: VariantArchetype, count: number) {
  const { sides, floors } = RANGES[archetype]
  for (let i = 0; i < count; i++) {
    const context: VariantContext = {
      side: sides[0] + ((sides[1] - sides[0]) * (i % 97)) / 96,
      floors: floors[i % floors.length] ?? 1,
    }
    yield { context, pieces: pickVariant(archetype, `src/module-${i}.ts`, context) }
  }
}

const ARCHETYPES = ['house', 'pavilion', 'concreteBlock'] as const

describe('pickVariant', () => {
  it('gives a file the same pieces on every visit', () => {
    const context = { side: 1.2, floors: 1 }
    for (const archetype of ARCHETYPES) {
      expect(pickVariant(archetype, 'src/a.ts', context)).toEqual(
        pickVariant(archetype, 'src/a.ts', context),
      )
    }
  })

  it('picks one piece for each slot of one, and keeps to every rule', () => {
    for (const archetype of ARCHETYPES) {
      const { slots, pieces } = KIT[archetype]
      for (const { context, pieces: chosen } of sample(archetype, 4000)) {
        for (const slot of slots.filter((slot) => slot.one)) {
          expect(
            chosen.filter((id) => pieces.find((p) => p.id === id)?.slot === slot.id),
          ).toHaveLength(1)
        }
        for (const id of chosen) {
          const rule: Rule = pieces.find((piece) => piece.id === id)?.rule ?? {}
          const others = chosen.filter((other) => other !== id)
          if (rule.sMin !== undefined) expect(context.side).toBeGreaterThanOrEqual(rule.sMin - 1e-9)
          if (rule.sMax !== undefined) expect(context.side).toBeLessThanOrEqual(rule.sMax + 1e-9)
          if (rule.floors) expect(rule.floors).toContain(context.floors)
          if (rule.needs) expect(rule.needs.some((need) => others.includes(need))).toBe(true)
          for (const need of rule.needsAll ?? []) expect(others).toContain(need)
          for (const excluded of rule.excludes ?? []) expect(others).not.toContain(excluded)
        }
      }
    }
  })

  it('follows the boards: houses never have an annex below a side of 1 or above 1.4', () => {
    for (const { context, pieces } of sample('house', 4000)) {
      if (pieces.includes('ax')) {
        expect(context.side).toBeGreaterThanOrEqual(1)
        expect(context.side).toBeLessThanOrEqual(1.4)
      }
      if (pieces.includes('dm')) expect(context.floors).toBe(1)
    }
    for (const { context, pieces } of sample('concreteBlock', 4000)) {
      if (pieces.includes('W')) expect(context.floors).toBeGreaterThanOrEqual(2)
    }
  })

  it('reaches every combination of the boards, the reference most often', () => {
    const expected = { house: 54, pavilion: 32, concreteBlock: 40 }
    const reference = { house: 'S.G', pavilion: 'BW.D.F', concreteBlock: 'S.F' }
    for (const archetype of ARCHETYPES) {
      const counts = new Map<string, number>()
      for (const { pieces } of sample(archetype, 20000)) {
        const key = pieces.join('.')
        counts.set(key, (counts.get(key) ?? 0) + 1)
      }
      expect(counts.size).toBe(expected[archetype])
      // The bare reference body and roof stay common: no variant takes over
      const most = Math.max(...counts.values())
      expect(most / 20000).toBeLessThan(0.2)
      expect(counts.get(reference[archetype]) ?? 0).toBeGreaterThan(0)
    }
  })

  it('draws the combinations about as often as the boards measured them', () => {
    // Shares the boards measured over 20,000 files
    const measured = [
      ['house', 'S.G', 0.117],
      ['house', 'S.G.cn', 0.093],
      ['pavilion', 'BW.D.F.bn', 0.107],
      ['concreteBlock', 'S.R', 0.151],
    ] as const
    for (const [archetype, key, share] of measured) {
      let count = 0
      for (const { pieces } of sample(archetype, 20000)) {
        if (pieces.join('.') === key) count++
      }
      expect(Math.abs(count / 20000 - share)).toBeLessThan(0.03)
    }
  })
})

describe('quarterTurnsFor', () => {
  it('turns by a whole quarter, the same for a path, every quarter in use', () => {
    const turns = Array.from({ length: 400 }, (_, i) => quarterTurnsFor(`docs/page-${i}.md`))
    expect(new Set(turns)).toEqual(new Set([0, 1, 2, 3]))
    expect(quarterTurnsFor('docs/a.md')).toBe(quarterTurnsFor('docs/a.md'))
  })
})
