import { describe, expect, it, vi } from 'vitest'
import type { AreaLabel } from '../../city/interaction/city-items'
import { AreaLabelLayer } from './area-label-layer'

function label(path: string, x: number, overrides: Partial<AreaLabel> = {}): AreaLabel {
  return { path, island: true, name: path, caption: null, x, y: 10, lean: 'end', ...overrides }
}

function element() {
  return { style: { transform: '' } }
}

describe('AreaLabelLayer', () => {
  it('has a set drawn when it changes, and moves the labels drawn otherwise', () => {
    const layer = new AreaLabelLayer()
    const draw = vi.fn()
    layer.connect(draw)
    expect(draw).toHaveBeenLastCalledWith([], [])

    layer.update([label('core', 100)])
    expect(draw).toHaveBeenCalledTimes(2)
    const core = element()
    layer.element('core', core)
    layer.position()
    expect(core.style.transform).toBe('translate3d(100px, 10px, 0)')

    // The camera moves: the same label, elsewhere, moved in place.
    layer.update([label('core', 140)])
    expect(draw).toHaveBeenCalledTimes(2)
    expect(core.style.transform).toBe('translate3d(140px, 10px, 0)')

    // A line of figures comes: the set is drawn again.
    layer.update([label('core', 140, { caption: '12 files' })])
    expect(draw).toHaveBeenCalledTimes(3)

    // A label goes, where it last stood.
    layer.update([label('core', 150, { caption: '12 files' }), label('web', 300)])
    layer.update([label('web', 310)])
    expect(draw).toHaveBeenLastCalledWith(
      [label('web', 310)],
      [label('core', 150, { caption: '12 files' })],
    )
  })

  it('moves no label once its element is gone', () => {
    const layer = new AreaLabelLayer()
    layer.connect(() => {})
    layer.update([label('core', 100)])
    const core = element()
    layer.element('core', core)
    layer.element('core', null)
    layer.update([label('core', 200)])
    expect(core.style.transform).toBe('')
  })

  it('keeps the set at hand until someone draws it', () => {
    const layer = new AreaLabelLayer()
    layer.update([label('core', 100)])
    const draw = vi.fn()
    layer.connect(draw)
    expect(draw).toHaveBeenCalledWith([label('core', 100)], [])
  })
})
