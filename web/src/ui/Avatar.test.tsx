import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { Avatar, avatarSource, initials } from './Avatar'

describe('initials', () => {
  it('takes the first letters of the first two words of the login', () => {
    expect(initials('lena-okafor')).toBe('LO')
    expect(initials('ada_dev_2')).toBe('AD')
  })

  it('takes two letters of a single-word login', () => {
    expect(initials('torvalds')).toBe('TO')
    expect(initials('x')).toBe('X')
  })
})

describe('avatarSource', () => {
  it('asks GitHub for twice the displayed size', () => {
    expect(avatarSource('https://avatars.githubusercontent.com/u/1?v=4', 40)).toBe(
      'https://avatars.githubusercontent.com/u/1?v=4&s=80',
    )
  })

  it('leaves a string that is not a URL untouched', () => {
    expect(avatarSource('not a url', 32)).toBe('not a url')
  })
})

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
