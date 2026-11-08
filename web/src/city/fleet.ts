import { type InstancedMesh, Matrix4 } from 'three'
import { createBoats } from './decor-mesh'
import type { Fading } from './dimming'
import type { Boat, Ferry } from './links'
import { Route, sail } from './sailing'
import { boardToThree } from './world/units'

// The boats that sail the ferry lines, moved at every frame of the animation. They cast no
// shadow: the shadow map is drawn once per city, and would keep them where they started.

export class Fleet {
  readonly mesh: InstancedMesh
  private readonly sailors: { route: Route; share: number }[]
  private readonly matrix = new Matrix4()

  /** `boats`: those on a line only. */
  constructor(boats: readonly Boat[], ferries: readonly Ferry[], fading: Fading) {
    const routes = new Map<number, Route>()
    this.sailors = boats.map(({ line }) => {
      const ferry = line?.ferry ?? 0
      let route = routes.get(ferry)
      if (!route) {
        route = new Route(ferries[ferry]?.path ?? [])
        routes.set(ferry, route)
      }
      return { route, share: line?.share ?? 0 }
    })
    this.mesh = createBoats(boats, fading)
    this.mesh.castShadow = false
  }

  /** Whether there is any boat to sail. */
  get sails(): boolean {
    return this.sailors.length > 0
  }

  /** Puts every boat where it is after this many seconds. */
  update(seconds: number): void {
    this.sailors.forEach(({ route, share }, index) => {
      const { x, y, angle } = sail(route, share, seconds)
      this.matrix.makeRotationY(angle).setPosition(...boardToThree(x, y, 0))
      this.mesh.setMatrixAt(index, this.matrix)
    })
    this.mesh.instanceMatrix.needsUpdate = true
  }
}
