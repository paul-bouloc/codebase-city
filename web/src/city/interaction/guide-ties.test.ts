import { describe, expect, it } from 'vitest'
import { guideTies } from './guide-ties'

const square = (x: number, y: number) => ({ x, y, width: 10, height: 10 })

describe('guideTies', () => {
  it('joins the plateaux by the shortest ties, from shore to shore', () => {
    // C is nearer B than A: B ties to both, A and C are not tied
    expect(guideTies([square(0, 0), square(60, 0), square(20, 0)])).toEqual([
      [
        { x: 11.2, y: 5 },
        { x: 18.8, y: 5 },
      ],
      [
        { x: 31.2, y: 5 },
        { x: 58.8, y: 5 },
      ],
    ])
  })

  it('leaves a shore where the line between middles crosses it', () => {
    const [tie] = guideTies([square(0, 0), square(20, 20)])
    // Out of the corner, 1.2 u past the plateau each way
    expect(tie?.[0].x).toBeCloseTo(11.2)
    expect(tie?.[0].y).toBeCloseTo(11.2)
  })

  it('ties nothing for a single plateau', () => {
    expect(guideTies([square(0, 0)])).toEqual([])
    expect(guideTies([])).toEqual([])
  })
})
