import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { GuideCard, GuidePill } from './GuideCard'

const noop = () => {}

describe('GuidePill', () => {
  it('offers the tour and the questions, or the questions alone', () => {
    const toured = renderToStaticMarkup(<GuidePill tour onOpen={noop} />)
    expect(toured).toContain('Take the tour or ask a question')
    expect(toured).toContain('Space')
    const bare = renderToStaticMarkup(<GuidePill tour={false} onOpen={noop} />)
    expect(bare).toContain('Ask a question')
    expect(bare).not.toContain('Space')
  })
})

describe('GuideCard', () => {
  it('lists the questions under the tour, each with the line under its title', () => {
    const html = renderToStaticMarkup(
      <GuideCard
        length="8 steps · about 2 min"
        questions={[
          {
            title: 'What depends on this file?',
            subtitle: 'Everything that would feel a change',
            icon: 'foundation',
            onAsk: noop,
          },
        ]}
        onStart={noop}
        onCollapse={noop}
      />,
    )
    expect(html).toMatch(/Take the tour.*Questions.*What depends on this file\?/)
    expect(html).toContain('Everything that would feel a change')
  })

  it('shows no questions heading without questions', () => {
    const html = renderToStaticMarkup(
      <GuideCard length={null} questions={[]} onStart={noop} onCollapse={noop} />,
    )
    expect(html).not.toContain('Questions')
    expect(html).not.toContain('Take the tour')
  })
})
