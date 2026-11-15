import { selectionOfHash } from '../selection/selection-hash'

// The tour opens on its own the first time a city is seen in this browser, unless the link points
// at a file or a folder: whoever sent it wants that seen first.

/** The storage this needs: the browser's own, which may be missing or refuse. */
export type TourStorage = Pick<Storage, 'getItem' | 'setItem'>

const SEEN = 'codebase-city.tour-seen'

/** Where the browser remembers it has seen this repository's city. */
export function tourSeenKey(owner: string, name: string): string {
  return `${SEEN}:${owner}/${name}`
}

/**
 * Whether the tour starts on its own, and the city noted as seen if so. Storage that throws (site
 * data blocked) starts no tour: it could never remember it did.
 */
export function startsFirstTour(storage: TourStorage | null, key: string, hash: string): boolean {
  if (storage === null || selectionOfHash(hash) !== null) {
    return false
  }
  try {
    if (storage.getItem(key) !== null) {
      return false
    }
    storage.setItem(key, '1')
    return true
  } catch {
    return false
  }
}

/** The browser's local storage, or null where reading it throws. */
export function localTourStorage(): TourStorage | null {
  try {
    return window.localStorage
  } catch {
    return null
  }
}
