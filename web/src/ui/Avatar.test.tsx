import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { Avatar } from './Avatar'

describe('Avatar', () => {
  it('falls back to the initials without an image', () => {
    const html = renderToStaticMarkup(<Avatar login="lena-okafor" />)
    expect(html).toContain('>LO</span>')
    expect(html).not.toContain('<img')
  })

  it('shows the image with an empty alt, the login being written next to it', () => {
    const html = renderToStaticMarkup(
      <Avatar login="lena-okafor" src="https://avatars.githubusercontent.com/u/1" />,
    )
    expect(html).toContain('alt=""')
    expect(html).toContain('s=64')
  })
})
