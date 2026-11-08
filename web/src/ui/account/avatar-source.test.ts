import { describe, expect, it } from 'vitest'
import { avatarSource, initials } from './avatar-source'

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
