import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { CityMarker } from './CityMarker'

describe('CityMarker', () => {
  it('numbers a route step, its ends drawn apart from the middle', () => {
    const end = renderToStaticMarkup(<CityMarker kind="route" step={1} end />)
    const middle = renderToStaticMarkup(<CityMarker kind="route" step={2} end={false} />)
    expect(end).toMatch(/>1<\/span>$/)
    expect(middle).toMatch(/>2<\/span>$/)
    expect(end.match(/class="([^"]+)"/)?.[1]).not.toBe(middle.match(/class="([^"]+)"/)?.[1])
  })

  it('writes the cycle, impact and guide labels', () => {
    expect(renderToStaticMarkup(<CityMarker kind="cycle" files={26} />)).toContain(
      'Cycle · 26 files',
    )
    expect(
      renderToStaticMarkup(<CityMarker kind="impact" name="nls.ts" dependents={6213} />),
    ).toContain('nls.ts · 6,213 dependents')
    expect(
      renderToStaticMarkup(<CityMarker kind="guide" name="main.ts" note="entry point" />),
    ).toContain('main.ts · entry point')
  })
})
