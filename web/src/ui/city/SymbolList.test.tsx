import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { FileSymbol } from '../../screen/sheets/sheet-data'
import { SymbolList } from './SymbolList'

const symbols: FileSymbol[] = [
  { name: 'TextModel', kind: 'class', line: 284 },
  { name: 'ITextModel', kind: 'interface', line: 40 },
  ...Array.from({ length: 10 }, (_, index) => ({
    name: `helper${index}`,
    kind: 'function' as const,
    line: 1000 + index,
  })),
]

const render = (defaultExpanded = false) =>
  renderToStaticMarkup(
    <SymbolList symbols={symbols} onOpenLine={() => {}} defaultExpanded={defaultExpanded} />,
  )

describe('SymbolList', () => {
  it('groups by kind, classes first, with the line', () => {
    const html = render(true)
    expect(html.indexOf('Classes')).toBeLessThan(html.indexOf('Functions'))
    expect(html.indexOf('Functions')).toBeLessThan(html.indexOf('Types'))
    expect(html).toContain('L1,000')
  })

  it('groups exported constants last', () => {
    const html = renderToStaticMarkup(
      <SymbolList
        symbols={[{ name: 'MAX_SHIPS', kind: 'constant', line: 2 }, ...symbols]}
        onOpenLine={() => {}}
        defaultExpanded
      />,
    )
    expect(html.indexOf('Types')).toBeLessThan(html.indexOf('Constants'))
    expect(html).toContain('MAX_SHIPS')
  })

  it('shows 8 symbols across the groups until expanded', () => {
    expect(render().match(/<li>/g)).toHaveLength(8)
    expect(render()).toContain('Show all (12)')
    expect(render(true).match(/<li>/g)).toHaveLength(12)
  })
})
