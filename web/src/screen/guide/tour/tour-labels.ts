import { shortName } from '../guide-unit-labels'
import type { TourSpan } from './tour-spans'

// What a chip of the tour shows, cut to fit a line of the panel, and its whole name.

/** A path longer than this is cut from its start, */
const PATH = 32
/** a package's name too, as on its label. */
const NAME = 26

export interface ChipLabel {
  text: string
  /** The whole name, when the text is cut or is not the name itself. */
  title: string
}

/** A chip's text: a path cut from its start, the root as the repository, a package's name cut. */
export function chipLabel(span: Exclude<TourSpan, string>, repoName: string): ChipLabel {
  switch (span.kind) {
    case 'file':
      return { text: tailPath(span.path, PATH), title: span.path }
    case 'folder':
      return span.path === '/'
        ? { text: repoName, title: repoName }
        : { text: tailPath(span.path, PATH), title: span.path }
    case 'island':
      return { text: shortName(span.name, NAME), title: span.name }
    default:
      return { text: span.text, title: span.text }
  }
}

/** `src/vs/editor/common/model/textModel.ts` as `…/common/model/textModel.ts`: whole folders cut. */
export function tailPath(path: string, most: number): string {
  if (path.length <= most) {
    return path
  }
  const parts = path.split('/')
  for (let start = 1; start < parts.length; start++) {
    const tail = `…/${parts.slice(start).join('/')}`
    if (tail.length <= most) {
      return tail
    }
  }
  return `…/${parts.at(-1) ?? path}`
}
