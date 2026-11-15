import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { CyclesPanel } from './CyclesPanel'
import type { CycleList, CycleRow } from './cycles'

const noop = () => {}
const PATHS = ['src/a/one.ts', 'src/a/two.ts', 'src/b/three.ts', 'src/b/four.ts']

/** A cycle of `size` files, its loop through the first two of `PATHS`. */
const cycle = (row: number, size: number): CycleRow => ({
  row,
  members: Array.from({ length: size }, (_, at) => at),
  loop: [0, 1],
  folders: [`a${row}`, 'b'],
})

function panel(cycles: readonly CycleRow[], chosen: number | null) {
  const list: CycleList = {
    cycles,
    files: cycles.reduce((sum, each) => sum + each.members.length, 0),
  }
  return renderToStaticMarkup(
    <CyclesPanel
      cycles={list}
      chosen={chosen}
      filePaths={PATHS}
      onChoose={noop}
      onFile={noop}
      onBack={noop}
      onCollapse={noop}
    />,
  )
}

describe('CyclesPanel', () => {
  it('says so when there is no cycle', () => {
    const html = panel([], null)
    expect(html).toContain('No cycles found.')
    expect(html).not.toContain('<ul')
  })

  it('sums the cycles up and opens the one on show on the files of its loop', () => {
    const html = panel([cycle(0, 26), cycle(1, 2)], 0)
    expect(html).toMatch(/<strong[^>]*>2 cycles<\/strong> involving 28 files · biggest first/)
    expect(html).toContain('aria-label="Cycle of 26 files, a0 ↔ b"')
    expect(html).toContain('aria-current="true"')
    expect(html).toMatch(/one\.ts.*two\.ts/)
    expect(html).toContain('and 24 more · shown in the city')
    // The other cycle is a button, and a cycle no bigger than its loop has nothing more.
    expect(html).toContain('<button type="button" class="')
    expect(html.match(/more · shown in the city/g)).toHaveLength(1)
  })

  it('shows the first six, then offers them all, unless the one on show is further down', () => {
    const many = Array.from({ length: 9 }, (_, row) => cycle(row, 12 - row))
    // A row of the list, not a file of the open cycle.
    const rows = (html: string) => html.match(/<li><(button|section)[^>]*class="[^"]*cycle/g)
    const first = panel(many, 0)
    expect(rows(first)).toHaveLength(6)
    expect(first).toContain('Show all 9')
    const far = panel(many, 7)
    expect(rows(far)).toHaveLength(9)
    expect(far).not.toContain('Show all')
  })
})
