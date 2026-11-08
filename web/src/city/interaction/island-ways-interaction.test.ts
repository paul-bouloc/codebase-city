import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createBuildings } from '../buildings/buildings'
import { indexCycles } from '../flows/cycles'
import { ExtraFerries } from '../flows/extra-ferries'
import { indexImports } from '../flows/selection-links'
import { createFading } from '../render/dimming'
import { islandShapes } from '../terrain/island-shape'
import { cityLinks } from '../waterways/links'
import { boundsOf, type CityLayout, type IslandLink, type Rect } from '../world/layout'
import { type CityHover, CityInteraction, type PortList } from './city-interaction'

// A hub between six islands, far apart: four ferries leave it, its two smallest links go to its
// port (the largest first), and the last one is too small to draw.
const RING: Rect[] = [
  { x: 100, y: 100, width: 20, height: 20 },
  ...Array.from({ length: 7 }, (_, k) => ({
    x: 40 * k,
    y: k % 2 === 0 ? 0 : 200,
    width: 16,
    height: 12,
  })),
]
const LINKS: IslandLink[] = [
  ...[1, 2, 3, 4, 5].map((island) => ({ from: island, to: 0, imports: 1000 - island, upward: 0 })),
  { from: 0, to: 6, imports: 900, upward: 0 },
  { from: 6, to: 0, imports: 5, upward: 0 },
  { from: 0, to: 7, imports: 3, upward: 0 },
]

const LAYOUT: CityLayout = {
  islands: RING.map((plateau, index) => ({
    path: `island-${index}`,
    layer: index === 0 ? 1 : 3,
    plateau,
    parcels: [],
    lots: [
      {
        x: plateau.x + 2,
        y: plateau.y + 2,
        file: {
          path: `island-${index}/main.ts`,
          language: 'typescript',
          lines: 100,
          complexity: 5,
          test: false,
        },
      },
    ],
  })),
  bounds: boundsOf(RING),
  links: LINKS,
}

function setup(layout = LAYOUT) {
  const shapes = islandShapes(layout)
  const links = cityLinks(layout, shapes)
  const fading = createFading()
  const ports: (PortList | null)[] = []
  const hovers: (CityHover | null)[] = []
  const interaction = new CityInteraction(
    layout,
    shapes,
    createBuildings(layout, 1, fading),
    {
      imports: indexImports(layout),
      cycles: indexCycles(layout),
      bridges: links.bridges,
      ferries: links.ferries,
      unshown: links.unshown,
      extra: new ExtraFerries(layout, shapes, links),
      ports: links.ports,
    },
    fading,
    1,
    () => ({ port: (list) => ports.push(list), hover: (hover) => hovers.push(hover) }),
    () => {},
  )
  return { interaction, links, ports, hovers }
}

describe('the ways between islands', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    // The badges' pills are drawn on a canvas: none here, they stay blank.
    vi.stubGlobal('document', { createElement: () => ({ getContext: () => null }) })
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('shows its badge, and on hover a card with its island and its count', () => {
    const { interaction, links, hovers } = setup()
    const port = links.ports[0]
    if (!port) {
      throw new Error('no port')
    }
    expect(interaction.portBadges.group.visible).toBe(true)
    interaction.point({ kind: 'port', port }, { x: 5, y: 5 })
    vi.advanceTimersByTime(1000)
    expect(hovers.at(-1)).toMatchObject({ path: 'island-0', port: { links: 2 } })
  })

  it('lists its links on a click and sails them out, each the way it goes', () => {
    const { interaction, links, ports } = setup()
    const port = links.ports[0]
    if (!port) {
      throw new Error('no port')
    }
    interaction.openPort(port, { x: 20, y: 30 })
    expect(interaction.openedPort).toBe(port)
    expect(ports.at(-1)).toEqual({
      path: 'island-0',
      links: [
        { path: 'island-5', imports: 995, outgoing: false, incoming: true },
        { path: 'island-6', imports: 905, outgoing: true, incoming: true },
      ],
      more: 0,
      pointer: { x: 20, y: 30 },
    })
    // Two lines for the link that goes both ways, one for the other.
    expect(interaction.portLinks.group.visible).toBe(true)
    const drawn = interaction.portLinks.group.children.length
    interaction.focusPortLink(0)
    expect(interaction.portLinks.group.children.length).toBeGreaterThan(drawn)
    interaction.focusPortLink(null)
    expect(interaction.portLinks.group.children.length).toBe(drawn)

    interaction.closePort()
    expect(interaction.openedPort).toBeNull()
    expect(interaction.portLinks.group.visible).toBe(false)
    expect(ports.at(-1)).toBeNull()
  })

  it('moves an open port’s card with its badge, hidden while out of the view', () => {
    const { interaction, links, ports } = setup()
    const port = links.ports[0]
    if (!port) {
      throw new Error('no port')
    }
    interaction.openPort(port, { x: 20, y: 30 })
    const count = ports.length
    interaction.movePort({ x: 20.2, y: 30 })
    expect(ports).toHaveLength(count)
    interaction.movePort({ x: 120, y: 30 })
    expect(ports.at(-1)).toMatchObject({ path: 'island-0', pointer: { x: 120, y: 30 } })
    interaction.movePort(null)
    expect(ports.at(-1)?.pointer).toBeNull()
    expect(ports.at(-1)?.links).toHaveLength(2)
    interaction.closePort()
    interaction.movePort({ x: 0, y: 0 })
    expect(ports.at(-1)).toBeNull()
  })

  it('lets go of the link that stood out once the card is hidden', () => {
    const { interaction, links } = setup()
    const port = links.ports[0]
    if (!port) {
      throw new Error('no port')
    }
    interaction.openPort(port, { x: 20, y: 30 })
    const drawn = interaction.portLinks.group.children.length
    interaction.focusPortLink(0)
    interaction.movePort(null)
    expect(interaction.portLinks.group.children).toHaveLength(drawn)
  })

  it('closes the port open when another one opens', () => {
    const { interaction, links, ports } = setup()
    const port = links.ports[0]
    if (!port) {
      throw new Error('no port')
    }
    interaction.openPort(port, { x: 20, y: 30 })
    interaction.focusPortLink(0)
    const count = ports.length
    interaction.openPort(port, { x: 40, y: 30 })
    // Closed, then opened again: the card hears of both, and nothing stands out.
    expect(ports.slice(count).map((list) => list?.pointer ?? null)).toEqual([
      null,
      { x: 40, y: 30 },
    ])
    expect(ports[count]).toBeNull()
  })

  it('withdraws an open port’s card when it goes', () => {
    const { interaction, links, ports } = setup()
    const port = links.ports[0]
    if (!port) {
      throw new Error('no port')
    }
    interaction.openPort(port, { x: 0, y: 0 })
    interaction.dispose()
    expect(ports.at(-1)).toBeNull()
  })

  it('leaves its links and the small ones to a selected island too', () => {
    const { interaction, links } = setup()
    expect(links.ports[0]?.pairs.map((pair) => pair.b)).toEqual([5, 6])
    expect(links.unshown.map((pair) => pair.b)).toEqual([5, 6, 7])
    interaction.select({ kind: 'island', island: 7 })
    // Island 7 has one link, too small to draw: it sails out.
    expect(interaction.folderLinks.group.visible).toBe(true)
  })

  it('outlines the ways a cycle takes between islands, sailing out an undrawn one', () => {
    // A loop from the hub to island 1 (a ferry) and island 7 (too small to draw), and back.
    const looped: CityLayout = {
      ...LAYOUT,
      cycles: [
        {
          members: [
            { island: 0, lot: 0 },
            { island: 1, lot: 0 },
            { island: 7, lot: 0 },
          ],
          loop: [0, 1, 2],
          imports: [
            [0, 1],
            [1, 2],
            [2, 0],
          ],
        },
      ],
    }
    const { interaction } = setup(looped)
    interaction.select({ kind: 'building', index: 0 })
    // A broad red line under the ferry lines, and their own lines over it: no bridge here.
    expect(interaction.cycleWays.group.visible).toBe(true)
    expect(interaction.cycleWays.group.children).toHaveLength(2)
    interaction.select({ kind: 'island', island: 0 })
    expect(interaction.cycleWays.group.visible).toBe(false)
  })
})
