import { createRef } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { SearchIndex } from '../../search/search-index'
import { RoutePanel } from './RoutePanel'
import type { Route } from './route'

const noop = () => {}
const PATHS = ['src/app/main.ts', 'src/core/service.ts', 'src/base/async.ts']

function panel(from: string | null, to: string | null, route: Route | null) {
  return renderToStaticMarkup(
    <RoutePanel
      from={from}
      to={to}
      route={route}
      filePaths={PATHS}
      // Searched only once a field is typed in.
      searchIndex={{} as SearchIndex}
      toRef={createRef()}
      onChange={noop}
      onNextPath={noop}
      onStop={noop}
      onBack={noop}
      onClear={noop}
      onCollapse={noop}
    />,
  )
}

describe('RoutePanel', () => {
  it('asks for two files, with nothing to clear', () => {
    const html = panel(null, null, null)
    expect(html).toContain('From (A)')
    expect(html).toContain('To (B)')
    expect(html).toContain('Choose two files')
    expect(html).not.toContain('>Clear<')
  })

  it('lists the stops, ink at the ends and Marine between, and offers the next path', () => {
    const route: Route = { kind: 'found', from: 0, to: 2, files: [0, 1, 2], paths: 3, choice: 0 }
    const html = panel(PATHS[0] ?? '', PATHS[2] ?? '', route)
    expect(html).toContain('aria-label="Path from main.ts to async.ts"')
    expect(html).toMatch(/2 steps.*through 3 files.* · 1 of 3 shortest paths/)
    expect(html).toMatch(/main\.ts.*service\.ts.*async\.ts/)
    // "imports ↓" under every stop but the last.
    expect(html.match(/imports <span aria-hidden="true">↓<\/span>/g)).toHaveLength(2)
    expect(html).toContain('Next shortest path')
  })

  it('leaves out the count and the next path when there is only one', () => {
    const route: Route = { kind: 'found', from: 0, to: 1, files: [0, 1], paths: 1, choice: 0 }
    const html = panel(PATHS[0] ?? '', PATHS[1] ?? '', route)
    expect(html).not.toContain('shortest paths')
    expect(html).not.toContain('Next shortest path')
  })

  it('says there is no path, why, and offers to swap', () => {
    const route: Route = {
      kind: 'none',
      from: 2,
      to: 0,
      reason: { kind: 'imports-nothing' },
      back: 2,
    }
    const html = panel(PATHS[2] ?? '', PATHS[0] ?? '', route)
    expect(html).toContain('role="status"')
    expect(html).toMatch(/No path: .*async\.ts.* doesn’t depend on .*main\.ts/)
    expect(html).toContain('The other way round, main.ts reaches async.ts in 2 steps.')
    expect(html.match(/Swap A and B/g)?.length).toBeGreaterThanOrEqual(2)
  })
})
