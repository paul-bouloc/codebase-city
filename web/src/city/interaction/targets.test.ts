import { describe, expect, it } from 'vitest'
import { decodeResult } from '../../data/decode-result'
import sample from '../../data/generated/sample-result.json'
import { cityFromResult } from '../world/from-result'
import { cityTargets } from './targets'

const layout = cityFromResult(decodeResult(sample))
const targets = cityTargets(layout)

describe('cityTargets', () => {
  it('finds a file’s building by its index across islands', () => {
    const target = targets.at('src/ui/view.ts')
    expect(target?.kind).toBe('building')
    const lots = layout.islands.flatMap((island) => island.lots)
    const index = target?.kind === 'building' ? target.index : -1
    expect(lots[index]?.file.path).toBe('src/ui/view.ts')
    expect(targets.lotOf('src/ui/view.ts')).toEqual({ x: lots[index]?.x, y: lots[index]?.y })
  })

  it('finds an island by its folder', () => {
    const island = layout.islands.findIndex((each) => each.path === 'src/core')
    expect(targets.at('src/core')).toEqual({ kind: 'island', island })
  })

  it('knows no path outside the city', () => {
    expect(targets.at('src/nowhere.ts')).toBeNull()
    expect(targets.lotOf('src/core')).toBeNull()
  })
})
