// Colours of the places between the buildings, from the art direction. The legend draws its
// samples with them, so a sample is exactly what the city shows.

export const BRIDGE_STONE = '#E9DDC7'
// The railings: the stone mixed with 45 % black.
export const BRIDGE_RAIL = mixHex(BRIDGE_STONE, '#000000', 0.45)
export const FERRY_WAKE = '#FFFFFF'
// The quay of a canal and of a port.
export const QUAY = '#C9B894'
export const CANAL_WATER = '#79BFC0'
export const TEST_PARK = '#B3D58B'
export const TEST_PARK_EDGE = '#93BC6E'

// Mixes two `#RRGGBB` colours in sRGB, as the art direction writes `mix(a, b, amount)`.
export function mixHex(a: string, b: string, amount: number): string {
  const channel = (hex: string, index: number) =>
    Number.parseInt(hex.slice(1 + 2 * index, 3 + 2 * index), 16)
  const mixed = [0, 1, 2].map((index) =>
    Math.round(channel(a, index) * (1 - amount) + channel(b, index) * amount)
      .toString(16)
      .padStart(2, '0'),
  )
  return `#${mixed.join('').toUpperCase()}`
}
