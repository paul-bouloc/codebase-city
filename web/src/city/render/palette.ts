import { mixSrgb } from '../world/units'

// Colours of the places between the buildings, from the art direction. The legend draws its
// samples with them, so a sample is exactly what the city shows.

export const BRIDGE_STONE = '#E9DDC7'
// The railings: the stone mixed with 45 % black.
export const BRIDGE_RAIL = mixHex(BRIDGE_STONE, '#000000', 0.45)
// A ferry line, drawn on the sea as on a chart: the Harbor accent.
export const FERRY_LINE = '#1D6F78'
// Imports that go up the layers, and nothing else: the city's only red.
export const UPWARD = '#D1435B'
// Around a selected file: Marine toward what it imports, Sun from what imports it.
export const OUTGOING_LINK = '#1F4E9E'
export const INCOMING_LINK = '#E3872D'
// The quay of a canal and of a port.
export const QUAY = '#C9B894'
export const CANAL_WATER = '#79BFC0'
export const TEST_PARK = '#B3D58B'
export const TEST_PARK_EDGE = '#93BC6E'

// `mixSrgb`, written back as `#RRGGBB` for the interface (the legend's samples).
export function mixHex(a: string, b: string, amount: number): string {
  const mixed = mixSrgb(a, b, amount).map((channel) =>
    Math.round(channel * 255)
      .toString(16)
      .padStart(2, '0'),
  )
  return `#${mixed.join('').toUpperCase()}`
}
