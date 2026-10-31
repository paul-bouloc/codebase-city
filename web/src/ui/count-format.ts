const exact = new Intl.NumberFormat('en-US')
const compact = new Intl.NumberFormat('en-US', {
  notation: 'compact',
  maximumSignificantDigits: 2,
})

// "1,204".
export function exactCount(count: number): string {
  return exact.format(count)
}

// At most four characters, for counts in tight places: 999, 1.2k, 12k, 120k, 1.2M.
export function shortCount(count: number): string {
  return count < 1000 ? exact.format(count) : compact.format(count).toLowerCase()
}

// A share as a whole percent that never lies at the edges: "<1%" for a little, ">99%" for
// almost all, "0%" and "100%" only when exact.
export function percent(share: number): string {
  if (share > 0 && share < 0.01) {
    return '<1%'
  }
  if (share < 1 && share > 0.99) {
    return '>99%'
  }
  return `${Math.round(share * 100)}%`
}

const sizes = new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 })

// A file size in bytes, kilobytes or megabytes (powers of 1,000, as GitHub shows them).
export function fileSize(bytes: number): string {
  if (bytes < 1000) {
    return `${exact.format(bytes)} B`
  }
  if (bytes < 1_000_000) {
    return `${sizes.format(bytes / 1000)} KB`
  }
  return `${sizes.format(bytes / 1_000_000)} MB`
}
