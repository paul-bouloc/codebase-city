import type { ExtraFerries } from '../flows/extra-ferries'
import { FolderLinkMarks, folderWays } from '../flows/folder-link-marks'
import { PORT_ROWS, portLabels, portRows } from '../flows/port-links'
import { ArcLayer } from '../render/arc-mesh'
import type { Ferry, Port } from '../waterways/links'
import type { CityLayout } from '../world/layout'

/** A link of an open port, as its card lists it. */
export interface PortLinkRow {
  /** The island across. */
  path: string
  imports: number
  /** The port's island imports the other one. */
  outgoing: boolean
  /** The other island imports the port's. */
  incoming: boolean
}

/** An open port's card: its island, its links (the largest, `PORT_ROWS` at most) and the rest. */
export interface PortList {
  path: string
  links: PortLinkRow[]
  /** Links past those listed. */
  more: number
  /** Where its badge stands, in the page's pixels; null while out of the view. */
  pointer: { x: number; y: number } | null
}

interface PortLine {
  outgoing: boolean
  incoming: boolean
  ferry: Ferry | null
}

/**
 * The ports' badges, and the one port open at a time: its links sail out of its quay, Marine
 * where its island imports the other one, Sun the other way, and its card lists them.
 */
export class OpenPort {
  readonly links: FolderLinkMarks
  readonly badges: ArcLayer
  private at: Port | null = null
  private list: PortList | null = null
  private lines: PortLine[] = []

  constructor(
    private readonly layout: CityLayout,
    readonly ports: readonly Port[],
    private readonly extra: ExtraFerries | undefined,
    pixelRatio: number,
  ) {
    this.links = new FolderLinkMarks(pixelRatio)
    this.badges = new ArcLayer(pixelRatio)
    this.badges.show({ lines: [], dots: [], stems: [], labels: portLabels(ports) })
  }

  /** The port open, if any. */
  get port(): Port | null {
    return this.at
  }

  /** Whether this port can open: one of the city's, with its links able to sail out. */
  canOpen(port: Port): boolean {
    return this.extra !== undefined && this.ports.includes(port)
  }

  /** Opens a port, opened at this point of the page; the one open must be closed first. */
  open(port: Port, pointer: { x: number; y: number } | null): PortList {
    const { extra } = this
    const rows = portRows(port, this.layout.links ?? [])
    this.at = port
    this.lines = rows.map((row, at) => {
      const pair = port.pairs[at]
      return {
        outgoing: row.outgoing,
        incoming: row.incoming,
        ferry: pair && extra ? extra.route(pair, port) : null,
      }
    })
    this.draw(null)
    this.list = {
      path: this.layout.islands[port.island]?.path ?? '',
      links: rows.slice(0, PORT_ROWS).map((row) => ({
        path: this.layout.islands[row.island]?.path ?? '',
        imports: row.imports,
        outgoing: row.outgoing,
        incoming: row.incoming,
      })),
      more: Math.max(rows.length - PORT_ROWS, 0),
      pointer,
    }
    return this.list
  }

  /**
   * The open port's badge now stands here on the page, or out of the view: its card, to show
   * again, or null when nothing changes.
   */
  move(pointer: { x: number; y: number } | null): PortList | null {
    const list = this.list
    if (!list) {
      return null
    }
    const was = list.pointer
    const same =
      was === pointer ||
      (was && pointer && Math.abs(was.x - pointer.x) < 0.5 && Math.abs(was.y - pointer.y) < 0.5)
    if (same) {
      return null
    }
    // A hidden card takes the pointer off its rows with it: no link stands out any more.
    if (!pointer) {
      this.draw(null)
    }
    this.list = { ...list, pointer }
    return this.list
  }

  /** One of the open port's links stands out, the others faded; or none does. False if none open. */
  focus(index: number | null): boolean {
    if (!this.at) {
      return false
    }
    this.draw(index)
    return true
  }

  /** Closes the open port; false if none was. */
  close(): boolean {
    if (!this.at) {
      return false
    }
    this.at = null
    this.list = null
    this.lines = []
    this.links.show(null)
    return true
  }

  dispose(): void {
    this.links.dispose()
    this.badges.dispose()
  }

  /** The open port's lines, `focus` the index of the one that stands out. */
  private draw(focus: number | null): void {
    const port = this.at
    if (!port) {
      this.links.show(null)
      return
    }
    const ways = (lines: readonly PortLine[]) => {
      const flows = new Map<number, { outgoing: boolean; incoming: boolean }>()
      const ferries: Ferry[] = []
      for (const { ferry, outgoing, incoming } of lines) {
        if (ferry) {
          flows.set(ferry.a === port.island ? ferry.b : ferry.a, { outgoing, incoming })
          ferries.push(ferry)
        }
      }
      return folderWays(port.island, flows, [], ferries)
    }
    const focused = focus === null ? undefined : this.lines[focus]
    this.links.show(ways(this.lines), focused ? ways([focused]) : null)
  }
}
