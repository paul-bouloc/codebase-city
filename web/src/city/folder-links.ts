import { type CityLayout, type Rect, rectContains } from './world/layout'

// Which other islands a selected folder imports and which import it: their bridges and ferry
// lines stand out, Marine one way, Sun the other.

/** Between a selected folder and another island. */
export interface FolderFlow {
  /** The folder imports some of the other island's files. */
  outgoing: boolean
  /** Some of the other island's files import the folder. */
  incoming: boolean
}

/** A selected folder: an island, or a parcel's rectangle on its island. */
export interface Folder {
  island: number
  rect?: Rect
}

/** The other islands a folder is linked with, both ways. */
export function folderFlows(layout: CityLayout, folder: Folder): Map<number, FolderFlow> {
  const flows = new Map<number, FolderFlow>()
  const add = (other: number, way: keyof FolderFlow) => {
    if (other === folder.island) {
      return
    }
    const flow = flows.get(other) ?? { outgoing: false, incoming: false }
    flow[way] = true
    flows.set(other, flow)
  }
  const { rect } = folder
  if (!rect) {
    // An island's links are counted between islands already.
    for (const link of layout.links ?? []) {
      if (link.from === folder.island) {
        add(link.to, 'outgoing')
      } else if (link.to === folder.island) {
        add(link.from, 'incoming')
      }
    }
    return flows
  }
  // A parcel's, from the imports of its files.
  const lots = layout.islands[folder.island]?.lots ?? []
  const grids = layout.islands[folder.island]?.grids ?? []
  const inside = (at: { x: number; y: number } | undefined) =>
    at !== undefined && rectContains(rect, at.x, at.y)
  for (const { from, to } of layout.imports ?? []) {
    if (from.island === folder.island && inside(lots[from.lot])) {
      add(to.island, 'outgoing')
    }
    if (to.island === folder.island && from.island !== folder.island) {
      if (inside('lot' in to ? lots[to.lot] : middle(grids[to.grid]?.rect))) {
        add(from.island, 'incoming')
      }
    }
  }
  return flows
}

/** A folder's grid is imported where its middle stands (a Go package). */
function middle(rect: Rect | undefined) {
  return rect && { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }
}
