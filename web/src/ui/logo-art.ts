// The logo is artwork, not themed UI: its colours stay fixed whatever the surface.
export const LOGO_COLORS = {
  sea: '#86C8C5',
  sand: '#F2E2BE',
  meadow: '#C5DFA4',
  cliff: '#D2AE84',
  cliffShadow: '#B88E66',
  ink: '#23313A',
  towerShade: '#4A5C66',
  cream: '#FFFAF0',
  soleil: '#E3872D',
} as const

// The empty-state island adds a tree and a Harbor flag to the logo's palette.
export const ISLAND_COLORS = {
  tree: '#7BB06A',
  flag: '#1D6F78',
} as const

export interface Shape {
  d: string
  fill: string
}

// Terraces are ellipses in the 2:1 iso ratio of the city.
function ellipse(cx: number, cy: number, rx: number, ry: number): string {
  return `M${cx - rx} ${cy} a${rx} ${ry} 0 1 0 ${2 * rx} 0 a${rx} ${ry} 0 1 0 ${-2 * rx} 0Z`
}

// An iso tower standing on (cx, cy): half-width w, half-height of the top hh, height h.
function tower(cx: number, cy: number, w: number, hh: number, h: number): Shape[] {
  const top = cy - h
  return [
    {
      d: `M${cx - w} ${top} L${cx} ${top + hh} L${cx} ${cy + hh} L${cx - w} ${cy}Z`,
      fill: LOGO_COLORS.ink,
    },
    {
      d: `M${cx} ${top + hh} L${cx + w} ${top} L${cx + w} ${cy} L${cx} ${cy + hh}Z`,
      fill: LOGO_COLORS.towerShade,
    },
    {
      d: `M${cx} ${top - hh} L${cx + w} ${top} L${cx} ${top + hh} L${cx - w} ${top}Z`,
      fill: LOGO_COLORS.cream,
    },
  ]
}

// On a 48 unit grid. The sea disc is drawn separately: only on light surfaces.
export const MARK_SIZE = 48

export const MARK_DISC: Shape = { d: ellipse(24, 24, 24, 24), fill: LOGO_COLORS.sea }

export const MARK_SHAPES: Shape[] = [
  { d: ellipse(24, 33, 17, 7.5), fill: LOGO_COLORS.cliff },
  { d: ellipse(24, 31, 17, 7.5), fill: LOGO_COLORS.sand },
  { d: ellipse(24, 28.6, 11, 5), fill: LOGO_COLORS.cliffShadow },
  { d: ellipse(24, 26.6, 11, 5), fill: LOGO_COLORS.meadow },
  ...tower(25, 25.5, 3, 1.5, 15),
  ...tower(20, 27, 3, 1.5, 9),
  ...tower(29.5, 27.5, 3, 1.5, 6),
  { d: ellipse(25, 7.4, 1.5, 1.5), fill: LOGO_COLORS.soleil },
]

// Favicons carry their own rounded sea square.
const FAVICON_32: Shape[] = [
  {
    d: 'M7 0h18a7 7 0 0 1 7 7v18a7 7 0 0 1-7 7H7a7 7 0 0 1-7-7V7a7 7 0 0 1 7-7Z',
    fill: LOGO_COLORS.sea,
  },
  { d: ellipse(16, 23, 11, 4.5), fill: LOGO_COLORS.cliff },
  { d: ellipse(16, 21.5, 11, 4.5), fill: LOGO_COLORS.sand },
  ...tower(17, 21, 3, 1.5, 12),
  ...tower(12.5, 22, 3, 1.5, 6),
  { d: ellipse(17, 5.9, 1.3, 1.3), fill: LOGO_COLORS.soleil },
]

const FAVICON_16: Shape[] = [
  {
    d: 'M3.5 0h9a3.5 3.5 0 0 1 3.5 3.5v9a3.5 3.5 0 0 1-3.5 3.5h-9A3.5 3.5 0 0 1 0 12.5v-9A3.5 3.5 0 0 1 3.5 0Z',
    fill: LOGO_COLORS.sea,
  },
  { d: ellipse(8, 11.5, 6, 2.5), fill: LOGO_COLORS.sand },
  ...tower(8.5, 11, 2, 1, 6),
]

export const FAVICON_SHAPES = { 16: FAVICON_16, 32: FAVICON_32 } as const

export function faviconSvg(size: keyof typeof FAVICON_SHAPES): string {
  const paths = FAVICON_SHAPES[size].map(({ d, fill }) => `<path d="${d}" fill="${fill}"/>`)
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"><title>Codebase City</title>${paths.join('')}</svg>\n`
}
