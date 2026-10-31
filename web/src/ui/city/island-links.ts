import type { IslandLink } from './sheet-data'

// Upward imports last, in red: they break the layers.
export function orderedLinks(links: readonly IslandLink[]): IslandLink[] {
  return [...links.filter((link) => !link.upward), ...links.filter((link) => link.upward)]
}
