import { describe, expect, it } from 'vitest'
import favicon16 from '../../../public/favicon-16.svg?raw'
import favicon32 from '../../../public/favicon-32.svg?raw'
import { faviconSvg } from './logo-art'

describe('favicons', () => {
  it('match the logo geometry', () => {
    expect(favicon16).toBe(faviconSvg(16))
    expect(favicon32).toBe(faviconSvg(32))
  })
})
