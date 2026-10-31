import { describe, expect, it } from 'vitest'
import { decodeResult, FORMAT_VERSION, InvalidResultError } from './decode-result'
import type { AnalysisResult } from './generated/AnalysisResult'
import sample from './generated/sample-result.json'

/** The result's shape, with any value allowed, to build broken inputs. */
type Loose<T> = {
  [K in keyof T]: T[K] extends unknown[] ? unknown[] : T[K] extends object ? Loose<T[K]> : unknown
}
type Json = Loose<AnalysisResult>

/** A deep copy of the sample, changed by `change`, then decoded. */
function decodeChanged(change: (json: Json) => void) {
  const json = structuredClone(sample) as unknown as Json
  change(json)
  return () => decodeResult(json)
}

describe('decodeResult', () => {
  it('accepts the sample written by the Rust model', () => {
    const result = decodeResult(sample)
    expect(result.formatVersion).toBe(FORMAT_VERSION)
    expect(result.files.name).toHaveLength(20)
    expect(result.edges.kind).toContain('reexport')
    expect(result.files.header[2]).toContain('Entry point')
    expect(result.symbols.kind).toContain('interface')
  })

  it('rejects anything but an object', () => {
    expect(() => decodeResult(null)).toThrow(InvalidResultError)
    expect(() => decodeResult([])).toThrow('result is not an object')
  })

  it('rejects another format version', () => {
    expect(
      decodeChanged((json) => {
        json.formatVersion = 1
      }),
    ).toThrow('unsupported format version 1, expected 2')
  })

  it('rejects values of the wrong type', () => {
    expect(
      decodeChanged((json) => {
        json.files.lines[3] = -1
      }),
    ).toThrow('files.lines[3] is not an unsigned 32-bit integer')
    expect(
      decodeChanged((json) => {
        json.files.lines[3] = 1.5
      }),
    ).toThrow('files.lines[3]')
    expect(
      decodeChanged((json) => {
        json.edges.kind[0] = 'require'
      }),
    ).toThrow('edges.kind[0] is not an edge kind')
    expect(
      decodeChanged((json) => {
        json.edges.confidence[0] = 'toString'
      }),
    ).toThrow('edges.confidence[0] is not a confidence')
    expect(
      decodeChanged((json) => {
        json.files.header[0] = 3
      }),
    ).toThrow('files.header[0] is not a string or null')
    expect(
      decodeChanged((json) => {
        json.symbols.kind[0] = 'method'
      }),
    ).toThrow('symbols.kind[0] is not a symbol kind')
    expect(
      decodeChanged((json) => {
        ;(json.files as Record<string, unknown>).generated = 'no'
      }),
    ).toThrow('files.generated is not an array')
    expect(
      decodeChanged((json) => {
        Reflect.deleteProperty(json.stats, 'ignored')
      }),
    ).toThrow('stats.ignored is not an object')
  })

  it('rejects columns of different lengths', () => {
    expect(
      decodeChanged((json) => {
        json.files.complexity.pop()
      }),
    ).toThrow('column files.complexity has 19 rows, expected 20')
    expect(
      decodeChanged((json) => {
        json.edges.to.push(0)
      }),
    ).toThrow('column edges.to has 27 rows, expected 26')
    expect(
      decodeChanged((json) => {
        json.files.header.pop()
      }),
    ).toThrow('column files.header has 19 rows, expected 20')
    expect(
      decodeChanged((json) => {
        json.symbols.line.pop()
      }),
    ).toThrow('column symbols.line has 12 rows, expected 13')
  })

  it('rejects an index out of bounds', () => {
    expect(
      decodeChanged((json) => {
        json.edges.to[2] = 20
      }),
    ).toThrow('edges.to[2] points to row 20, but the table has 20 rows')
    expect(
      decodeChanged((json) => {
        json.files.dir[0] = 8
      }),
    ).toThrow('files.dir[0] points to row 8')
    expect(
      decodeChanged((json) => {
        json.files.language[0] = 4
      }),
    ).toThrow('files.language[0] points to row 4')
    expect(
      decodeChanged((json) => {
        json.symbols.file[0] = 20
      }),
    ).toThrow('symbols.file[0] points to row 20')
  })

  it('requires named symbols on a line, sorted by file then line', () => {
    expect(
      decodeChanged((json) => {
        json.symbols.name[3] = ''
      }),
    ).toThrow('symbols.name[3] is empty')
    expect(
      decodeChanged((json) => {
        json.symbols.line[0] = 0
      }),
    ).toThrow('symbols.line[0] must be 1 or more')
    expect(
      decodeChanged((json) => {
        json.symbols.line[3] = 1
      }),
    ).toThrow('symbols[3] must come after the previous symbol, by file then line')
    expect(
      decodeChanged((json) => {
        json.symbols.file[1] = 1
      }),
    ).toThrow('symbols[1] must come after the previous symbol, by file then line')
  })

  it('requires the root first and every folder after its parent', () => {
    expect(
      decodeChanged((json) => {
        json.dirs.name[0] = 'root'
      }),
    ).toThrow('the first folder must be the root')
    expect(
      decodeChanged((json) => {
        json.dirs.parent = []
        json.dirs.name = []
      }),
    ).toThrow('the first folder must be the root')
    expect(
      decodeChanged((json) => {
        json.dirs.parent[2] = 2
      }),
    ).toThrow('dirs.parent[2] must point to an earlier folder')
    expect(
      decodeChanged((json) => {
        json.dirs.parent[2] = null
      }),
    ).toThrow('dirs.parent[2] must point to an earlier folder')
  })

  it('rejects names that are not a single path segment', () => {
    for (const name of ['', 'a/b', '.', '..']) {
      expect(
        decodeChanged((json) => {
          json.files.name[1] = name
        }),
      ).toThrow('files.name[1] is not a valid name')
    }
    expect(
      decodeChanged((json) => {
        json.dirs.name[1] = ''
      }),
    ).toThrow('dirs.name[1] is not a valid name')
  })

  it('rejects more resolved imports than imports', () => {
    expect(
      decodeChanged((json) => {
        json.stats.importsResolved = 1000
      }),
    ).toThrow('stats.importsResolved is greater than stats.importsTotal')
  })
})
