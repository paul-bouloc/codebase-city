import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { CameraControls } from './CameraControls'

const render = (topView: boolean) =>
  renderToStaticMarkup(<CameraControls bearing={30} topView={topView} onAction={() => {}} />)

describe('CameraControls', () => {
  it('is a labelled vertical toolbar with one tab stop', () => {
    const html = render(false)
    expect(html).toContain('role="toolbar"')
    expect(html).toContain('aria-label="Camera"')
    expect(html).toContain('aria-orientation="vertical"')
    expect(html.match(/<button /g)).toHaveLength(5)
    expect(html.match(/tabindex="0"/g)).toHaveLength(1)
  })

  // The hints only repeat the names; the shortcuts are given by aria-keyshortcuts.
  it('names each button once, with its shortcut, and keeps the hints visual', () => {
    const html = render(false)
    expect(html).not.toContain('aria-describedby')
    expect(html).not.toContain('role="tooltip"')
    expect(html.match(/aria-keyshortcuts=/g)).toHaveLength(4)
  })

  it('presses the top view button only when the top view is on', () => {
    expect(render(true)).toMatch(
      /aria-pressed="true"[^>]*aria-label="Top view"|aria-label="Top view"[^>]*aria-pressed="true"/,
    )
    expect(render(false)).toContain('aria-pressed="false"')
    expect(render(true).match(/aria-pressed/g)).toHaveLength(1)
  })

  it('turns the rose against the camera', () => {
    expect(render(false)).toContain('--rose-turn:-30deg')
  })
})
