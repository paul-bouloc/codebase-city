import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { BundleTooltip } from './BundleTooltip'

const card = (props: Partial<Parameters<typeof BundleTooltip>[0]>) =>
  renderToStaticMarkup(
    <BundleTooltip
      path="packages/common"
      direction="incoming"
      files={92}
      more={false}
      opens={50}
      pointer={{ x: 0, y: 0 }}
      {...props}
    />,
  )

describe('BundleTooltip', () => {
  it('says how many files of the island import the selection, and what a click shows', () => {
    const html = card({})
    expect(html).toContain('>common</span>')
    expect(html).toContain('92 files here import this file')
    expect(html).toContain('Click to show the 50 nearest')
  })

  it('says what the selection imports, and what is left once opened', () => {
    const html = card({ direction: 'outgoing', files: 42, more: true, opens: 42 })
    expect(html).toContain('This file imports 42 more files here')
    expect(html).toContain('Click to show them')
  })

  it('speaks of a lone file in the singular', () => {
    const html = card({ files: 1, opens: 1 })
    expect(html).toContain('1 file here imports this file')
    expect(html).toContain('Click to show it')
  })
})
