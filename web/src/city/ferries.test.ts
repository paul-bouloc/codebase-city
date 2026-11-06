import type { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js'
import { describe, expect, it } from 'vitest'
import { createFerries } from './ferries'

describe('createFerries', () => {
  it('draws each line as wide as it says, in CSS pixels, whatever the screen', () => {
    const group = createFerries([
      {
        a: 0,
        b: 1,
        imports: 10,
        upward: false,
        pixels: 3.2,
        path: [
          { x: 0, y: 0 },
          { x: 10, y: 0 },
        ],
      },
    ])
    const [line] = group.children
    expect((line as unknown as { material: LineMaterial }).material.linewidth).toBe(3.2)
  })
})
