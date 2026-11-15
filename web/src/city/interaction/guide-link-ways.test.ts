import { describe, expect, it } from 'vitest'
import type { Pair, Port, Quay } from '../waterways/links'
import { portChanges } from './guide-link-ways'

const pair = (a: number, b: number): Pair => ({ a, b, imports: 1, upward: false })

describe('portChanges', () => {
  it('tells when a link of the open port sails out or comes back, and only then', () => {
    const [mine, other] = [pair(0, 1), pair(2, 3)]
    const port: Port = { island: 0, pairs: [mine], quay: {} as Quay }
    expect(portChanges(port, new Set(), new Set([mine]))).toBe(true)
    expect(portChanges(port, new Set([mine]), new Set())).toBe(true)
    // Another port's link: the open one stays open
    expect(portChanges(port, new Set(), new Set([other]))).toBe(false)
    expect(portChanges(null, new Set(), new Set([mine]))).toBe(false)
  })
})
