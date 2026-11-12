import type { AreaLabelText } from '../../city/interaction/city-items'
import type { CityLayout } from '../../city/world/layout'
import { exactCount } from '../../ui/display/count-format'

// What the labels of islands and folders say: "core" over "≈ 1,200 files · layer 2"; "src".

/** Counts from this one up are rounded to two figures, after "≈". */
const ROUNDED_FROM = 100

/** The folder of the repository's root, which the root island is named after the repository. */
const ROOT = '/'

/** The text of every island's and folder's label, by path; the root island bears `rootName`. */
export function areaLabelTexts(layout: CityLayout, rootName: string): Map<string, AreaLabelText> {
  const texts = new Map<string, AreaLabelText>()
  const names = islandNames(layout.islands.map((island) => island.path))
  const layered = new Set(layout.islands.map((island) => island.layer)).size > 1
  layout.islands.forEach((island, at) => {
    const files = filesCount(island.lots.length)
    texts.set(island.path, {
      name: island.path === ROOT ? rootName : (names[at] ?? island.path),
      caption: layered ? `${files} · layer ${island.layer}` : files,
    })
    for (const parcel of island.parcels) {
      if (parcel.path !== undefined) {
        texts.set(parcel.path, { name: lastFolder(parcel.path), caption: null })
      }
    }
  })
  return texts
}

/**
 * Each island's name: its last folder, with as many folders before it as it takes to tell it
 * from the others (`a/src`, `b/src`).
 */
export function islandNames(paths: readonly string[]): string[] {
  const parts = paths.map((path) => path.split('/').filter((part) => part !== ''))
  const depths = parts.map(() => 1)
  for (;;) {
    const names = parts.map((folders, at) => folders.slice(-(depths[at] ?? 1)).join('/'))
    const seen = new Map<string, number>()
    for (const name of names) {
      seen.set(name, (seen.get(name) ?? 0) + 1)
    }
    let longer = false
    names.forEach((name, at) => {
      const depth = depths[at] ?? 1
      if ((seen.get(name) ?? 0) > 1 && depth < (parts[at]?.length ?? 0)) {
        depths[at] = depth + 1
        longer = true
      }
    })
    if (!longer) {
      return names.map((name, at) => (name === '' ? (paths[at] ?? '') : name))
    }
  }
}

/** "1 file", "42 files", "≈ 7,900 files". */
export function filesCount(files: number): string {
  if (files < ROUNDED_FROM) {
    return `${exactCount(files)} ${files === 1 ? 'file' : 'files'}`
  }
  const step = 10 ** (Math.floor(Math.log10(files)) - 1)
  return `≈ ${exactCount(Math.round(files / step) * step)} files`
}

function lastFolder(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1)
}
