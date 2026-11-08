// Approximate matching for the city's search: the letters of the query, in order, anywhere in
// the name ("txtmdl" finds `textModel.ts`), scored so that whole words, word starts and runs of
// letters come first. One letter finds the names it starts; two must appear side by side.

/**
 * The text in lower case, one character for one: a letter whose lower case is longer (`İ`) stays
 * as it is, so that indices in one are indices in the other.
 */
export function lowerCase(text: string): string {
  const lower = text.toLowerCase()
  if (lower.length === text.length) {
    return lower
  }
  let kept = ''
  for (const char of text) {
    const each = char.toLowerCase()
    kept += each.length === char.length ? each : char
  }
  return kept
}

/** Where a query matches a text, and how well. */
export interface Match {
  score: number
  /** The matched characters' indices in the text, ascending. */
  positions: number[]
}

const START = 10
const AFTER_SEPARATOR = 9
const CAMEL = 8
const RUN = 5
const SAME_CASE = 1
const GAP_START = 5
const GAP_EXTEND = 1
const LEADING_MAX = 10
const WHOLE_TEXT = 20
/** Earned in full by a query that covers the whole text: of two names, the one it fills more. */
const COVERAGE = 10

const SEPARATORS = new Set(['/', '.', '_', '-', ' ', '\\', ':'])

/** How much a match at `index` is worth for starting a word there. */
function boundaryBonus(text: string, index: number): number {
  if (index === 0) {
    return START
  }
  const previous = text[index - 1] ?? ''
  if (SEPARATORS.has(previous)) {
    return AFTER_SEPARATOR
  }
  const current = text[index] ?? ''
  const isUpper = current !== current.toLowerCase()
  const previousIsUpper = previous !== previous.toLowerCase()
  if (isUpper && !previousIsUpper && previous !== previous.toUpperCase()) {
    return CAMEL
  }
  if (isUpper && !previousIsUpper && /\d/.test(previous)) {
    return CAMEL
  }
  return 0
}

/** The score of the query's characters matched at these positions of the text. */
export function scorePositions(query: string, text: string, positions: readonly number[]): number {
  let score = 0
  let previous = -1
  positions.forEach((position, at) => {
    score += 1
    if (text[position] === query[at]) {
      score += SAME_CASE
    }
    // A letter that continues a run is worth the run, not a new word: `TeX` is no `text`.
    const gap = previous < 0 ? -1 : position - previous - 1
    if (gap === 0) {
      score += RUN
    } else {
      score += boundaryBonus(text, position)
      if (gap > 0) {
        score -= GAP_START + (gap - 1) * GAP_EXTEND
      }
    }
    previous = position
  })
  // Earlier is better, a little.
  score -= Math.min(positions[0] ?? 0, LEADING_MAX) / 2
  score += (COVERAGE * positions.length) / Math.max(text.length, 1)
  if (positions.length === text.length) {
    score += WHOLE_TEXT
  }
  return score
}

/** Under this many letters, a query must appear whole: one or two letters are no abbreviation. */
const SHORT_QUERY = 3

/**
 * Matches `query` against `text`, ignoring case. `lowerQuery` and `lowerText` are both in lower
 * case, worked out once by the caller. Returns null when the query's letters are not all in the
 * text, in order (or, for a short query, not side by side).
 */
export function fuzzyMatch(
  query: string,
  lowerQuery: string,
  text: string,
  lowerText: string,
): Match | null {
  const length = lowerQuery.length
  if (length === 0 || length > lowerText.length) {
    return null
  }
  // One letter finds the names it starts.
  if (length === 1) {
    return lowerText[0] === lowerQuery
      ? { score: scorePositions(query, text, [0]), positions: [0] }
      : null
  }
  if (length < SHORT_QUERY) {
    return bestRun(query, lowerQuery, text, lowerText, null)
  }

  // The first place the whole query fits, then the tightest window that ends there.
  let at = 0
  let end = -1
  for (let index = 0; index < lowerText.length; index++) {
    if (lowerText[index] === lowerQuery[at]) {
      at++
      if (at === length) {
        end = index
        break
      }
    }
  }
  if (end < 0) {
    return null
  }
  let start = end
  at = length - 1
  for (let index = end; index >= 0; index--) {
    if (lowerText[index] === lowerQuery[at]) {
      at--
      if (at < 0) {
        start = index
        break
      }
    }
  }

  // Each letter where it starts a word or continues a run, if it can: within that window, and
  // across the whole text (the window can start inside a word that begins earlier).
  let best: Match | null = null
  for (const [from, to] of [
    [start, end],
    [lowerText.indexOf(lowerQuery[0] ?? ''), lowerText.length - 1],
  ] as const) {
    const positions = placeInWindow(lowerQuery, text, lowerText, from, to)
    const score = scorePositions(query, text, positions)
    if (!best || score > best.score) {
      best = { score, positions }
    }
  }
  // The query as one run beats scattered letters: try where it appears whole. Letters strewn
  // across a long name, scoring nothing, mean nothing: no match.
  const found = bestRun(query, lowerQuery, text, lowerText, best)
  return found && found.score > 0 ? found : null
}

/** The best of `best` and the places, the first few, where the query appears whole. */
function bestRun(
  query: string,
  lowerQuery: string,
  text: string,
  lowerText: string,
  best: Match | null,
): Match | null {
  let found = best
  let from = lowerText.indexOf(lowerQuery)
  let tries = 0
  while (from >= 0 && tries < 8) {
    const start = from
    const run = Array.from({ length: lowerQuery.length }, (_, offset) => start + offset)
    const score = scorePositions(query, text, run)
    if (!found || score > found.score) {
      found = { score, positions: run }
    }
    from = lowerText.indexOf(lowerQuery, from + 1)
    tries++
  }
  return found
}

/**
 * Places the query's letters in `[start, end]`, which is known to hold them. Each letter goes at
 * the latest word start that still leaves room for the rest, else at the first place it fits.
 */
function placeInWindow(
  lowerQuery: string,
  text: string,
  lowerText: string,
  start: number,
  end: number,
): number[] {
  const length = lowerQuery.length
  // The latest index each letter can take, the ones after it still fitting.
  const latest = new Array<number>(length)
  let index = end
  for (let at = length - 1; at >= 0; at--) {
    while (lowerText[index] !== lowerQuery[at]) {
      index--
    }
    latest[at] = index
    index--
  }

  const positions: number[] = []
  let next = start
  for (let at = 0; at < length; at++) {
    const limit = latest[at] ?? next
    let chosen = -1
    let first = -1
    for (let candidate = next; candidate <= limit; candidate++) {
      if (lowerText[candidate] !== lowerQuery[at]) {
        continue
      }
      if (first < 0) {
        first = candidate
      }
      // Right after the previous letter: a run, take it.
      const previous = positions.at(-1)
      if (previous !== undefined && candidate === previous + 1) {
        chosen = candidate
        break
      }
      if (chosen < 0 && boundaryBonus(text, candidate) > 0) {
        chosen = candidate
      }
    }
    const position = chosen >= 0 ? chosen : first
    positions.push(position)
    next = position + 1
  }
  return positions
}

/**
 * The edit distance between two words (insertions, deletions, substitutions and swaps of two
 * neighbours), or `max + 1` as soon as it is known to be more than `max`.
 */
export function editDistance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) {
    return max + 1
  }
  let before = new Array<number>(b.length + 1).fill(0)
  let previous = Array.from({ length: b.length + 1 }, (_, j) => j)
  let current = new Array<number>(b.length + 1).fill(0)
  for (let i = 1; i <= a.length; i++) {
    current[0] = i
    let rowBest = i
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      let value = Math.min(
        (previous[j] ?? 0) + 1,
        (current[j - 1] ?? 0) + 1,
        (previous[j - 1] ?? 0) + cost,
      )
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        value = Math.min(value, (before[j - 2] ?? 0) + 1)
      }
      current[j] = value
      rowBest = Math.min(rowBest, value)
    }
    if (rowBest > max) {
      return max + 1
    }
    ;[before, previous, current] = [previous, current, before]
  }
  return Math.min(previous[b.length] ?? max + 1, max + 1)
}
