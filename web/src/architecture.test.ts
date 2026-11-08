import { describe, expect, it } from 'vitest'

// Imports only go one way: each top folder lists the folders it may import from, and the city's
// folders form layers, each importing only from the layers before it (tests may use any layer).

const SOURCES = import.meta.glob<string>(['./**/*.{ts,tsx}', '!./data/generated/**'], {
  query: '?raw',
  import: 'default',
  eager: true,
})

const ALLOWED: Record<string, readonly string[]> = {
  data: [],
  ui: ['data'],
  city: ['data'],
  screen: ['data', 'ui', 'city'],
  app: ['data', 'ui', 'city', 'screen'],
}

const CITY_LAYERS = [
  'world',
  'render',
  'terrain',
  'buildings',
  'waterways',
  'decor',
  'flows',
  'interaction',
  'engine',
]

const IMPORT = /(?:from|import)\s*\(?\s*['"](\.{1,2}\/[^'"?]+)/g

function resolve(from: string, specifier: string): string {
  const parts = from.split('/').slice(0, -1)
  for (const part of specifier.split('/')) {
    if (part === '..') parts.pop()
    else if (part !== '.') parts.push(part)
  }
  return parts.join('/')
}

function imports(): [string, string][] {
  const pairs: [string, string][] = []
  for (const [file, source] of Object.entries(SOURCES)) {
    for (const match of source.matchAll(IMPORT)) {
      const specifier = match[1]
      const target = specifier && resolve(file, specifier)
      if (target?.startsWith('./')) pairs.push([file, target])
    }
  }
  return pairs
}

/** `./city/world/layout.ts` → `['city', 'world']`. */
function folders(path: string): [string, string | undefined] {
  const [, top = '', sub] = path.split('/')
  return [top, sub]
}

describe('the architecture', () => {
  it('reads the sources', () => {
    expect(Object.keys(SOURCES).length).toBeGreaterThan(100)
  })

  it('keeps imports between top folders one way', () => {
    const wrong = imports().filter(([file, target]) => {
      const [from] = folders(file)
      const [to] = folders(target)
      const allowed = ALLOWED[from]
      return allowed !== undefined && from !== to && !allowed.includes(to)
    })
    expect(wrong).toEqual([])
  })

  it('keeps each city layer to the layers before it', () => {
    const wrong = imports().filter(([file, target]) => {
      const [fromTop, from = ''] = folders(file)
      const [toTop, to = ''] = folders(target)
      if (file.includes('.test.') || fromTop !== 'city' || toTop !== 'city') return false
      if (from === to) return false
      return CITY_LAYERS.indexOf(to) > CITY_LAYERS.indexOf(from)
    })
    expect(wrong).toEqual([])
  })

  it('places every city module in a known layer', () => {
    const unknown = Object.keys(SOURCES)
      .map(folders)
      .filter(([top, sub]) => top === 'city' && !CITY_LAYERS.includes(sub ?? ''))
    expect(unknown).toEqual([])
  })
})
