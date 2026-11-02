import { BufferGeometry, Float32BufferAttribute } from 'three'
import { boardToThree, type Vec3 } from './units'

/**
 * Flat-shaded triangles, one colour each, given in board coordinates (x, y on the ground, z up).
 * Each triangle says which way it should face: the builder winds it to face that way and gives
 * it that face's normal, so callers never think about winding.
 */
export class MeshBuilder {
  private readonly positions: number[] = []
  private readonly normals: number[] = []
  private readonly colors: number[] = []

  get triangles(): number {
    return this.positions.length / 9
  }

  /** `colour` is the whole triangle's, or one per corner. */
  triangle(a: Vec3, b: Vec3, c: Vec3, colour: Vec3 | [Vec3, Vec3, Vec3], facing: Vec3): void {
    const [p, q, r] = [boardToThree(...a), boardToThree(...b), boardToThree(...c)]
    const u = [q[0] - p[0], q[1] - p[1], q[2] - p[2]]
    const v = [r[0] - p[0], r[1] - p[1], r[2] - p[2]]
    let normal: Vec3 = [
      (u[1] ?? 0) * (v[2] ?? 0) - (u[2] ?? 0) * (v[1] ?? 0),
      (u[2] ?? 0) * (v[0] ?? 0) - (u[0] ?? 0) * (v[2] ?? 0),
      (u[0] ?? 0) * (v[1] ?? 0) - (u[1] ?? 0) * (v[0] ?? 0),
    ]
    const length = Math.hypot(...normal)
    if (length < 1e-12) {
      // A sliver with no area: nothing to see.
      return
    }
    normal = [normal[0] / length, normal[1] / length, normal[2] / length]
    const expected = boardToThree(...facing)
    const turned = normal[0] * expected[0] + normal[1] * expected[1] + normal[2] * expected[2] < 0
    const perCorner: [Vec3, Vec3, Vec3] = isPerCorner(colour) ? colour : [colour, colour, colour]
    const corners = turned ? [p, r, q] : [p, q, r]
    const colours = turned ? [perCorner[0], perCorner[2], perCorner[1]] : perCorner
    if (turned) {
      normal = [-normal[0], -normal[1], -normal[2]]
    }
    corners.forEach((corner, index) => {
      this.positions.push(...corner)
      this.normals.push(...normal)
      this.colors.push(...(colours[index] ?? perCorner[0]))
    })
  }

  /** Four corners in order around the quad; `colour` is the quad's, or one per corner. */
  quad(
    a: Vec3,
    b: Vec3,
    c: Vec3,
    d: Vec3,
    colour: Vec3 | [Vec3, Vec3, Vec3, Vec3],
    facing: Vec3,
  ): void {
    if (colour.length === 4) {
      const [ca, cb, cc, cd] = colour
      this.triangle(a, b, c, [ca, cb, cc], facing)
      this.triangle(a, c, d, [ca, cc, cd], facing)
    } else {
      this.triangle(a, b, c, colour, facing)
      this.triangle(a, c, d, colour, facing)
    }
  }

  /** A box without a bottom, from its south-west corner, `z0` to `z1`. */
  box(
    x: number,
    y: number,
    width: number,
    depth: number,
    z0: number,
    z1: number,
    top: Vec3,
    side: Vec3,
  ): void {
    const x1 = x + width
    const y1 = y + depth
    this.quad([x, y, z1], [x1, y, z1], [x1, y1, z1], [x, y1, z1], top, [0, 0, 1])
    this.quad([x, y, z0], [x1, y, z0], [x1, y, z1], [x, y, z1], side, [0, -1, 0])
    this.quad([x1, y, z0], [x1, y1, z0], [x1, y1, z1], [x1, y, z1], side, [1, 0, 0])
    this.quad([x1, y1, z0], [x, y1, z0], [x, y1, z1], [x1, y1, z1], side, [0, 1, 0])
    this.quad([x, y1, z0], [x, y, z0], [x, y, z1], [x, y1, z1], side, [-1, 0, 0])
  }

  build(): BufferGeometry {
    const geometry = new BufferGeometry()
    geometry.setAttribute('position', new Float32BufferAttribute(this.positions, 3))
    geometry.setAttribute('normal', new Float32BufferAttribute(this.normals, 3))
    geometry.setAttribute('color', new Float32BufferAttribute(this.colors, 3))
    return geometry
  }
}

function isPerCorner(colour: Vec3 | [Vec3, Vec3, Vec3]): colour is [Vec3, Vec3, Vec3] {
  return Array.isArray(colour[0])
}
