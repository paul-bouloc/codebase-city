import { describe, expect, it } from 'vitest'
import { startsFirstTour, type TourStorage, tourSeenKey } from './first-tour'

function memory(): TourStorage & { items: Map<string, string> } {
  const items = new Map<string, string>()
  return {
    items,
    getItem: (key) => items.get(key) ?? null,
    setItem: (key, value) => {
      items.set(key, value)
    },
  }
}

const KEY = tourSeenKey('nestjs', 'nest')

describe('startsFirstTour', () => {
  it('starts the tour the first time a city is seen, and never again', () => {
    const storage = memory()
    expect(startsFirstTour(storage, KEY, '')).toBe(true)
    expect(storage.items.get(KEY)).toBe('1')
    expect(startsFirstTour(storage, KEY, '')).toBe(false)
  })

  it('counts each city apart', () => {
    const storage = memory()
    startsFirstTour(storage, KEY, '')
    expect(startsFirstTour(storage, tourSeenKey('microsoft', 'vscode'), '')).toBe(true)
  })

  it('starts none when the link points at a file or a folder, and keeps it unseen', () => {
    const storage = memory()
    expect(startsFirstTour(storage, KEY, '#file=src/main.ts')).toBe(false)
    expect(startsFirstTour(storage, KEY, '#dir=packages/core')).toBe(false)
    expect(storage.items.size).toBe(0)
    expect(startsFirstTour(storage, KEY, '#something-else')).toBe(true)
  })

  it('starts none when the storage is missing or throws', () => {
    const throwing: TourStorage = {
      getItem: () => {
        throw new Error('blocked')
      },
      setItem: () => {
        throw new Error('blocked')
      },
    }
    expect(startsFirstTour(null, KEY, '')).toBe(false)
    expect(startsFirstTour(throwing, KEY, '')).toBe(false)
  })
})
