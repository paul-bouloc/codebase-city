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
    expect(result.files.barrel[4]).toBe(true)
    expect(result.files.dependents[8]).toBe(11)
    expect(result.roles.entries.reasons[0]).toEqual(['packageMain', 'conventionalName'])
    expect(result.roles.foundations.file[0]).toBe(8)
    expect(result.islands.layer[2]).toBe(1)
    expect(result.dirs.island[3]).toBe(3)
    expect(result.links.imports).toContain(3)
    expect(result.cycles.shortest[0]).toEqual([5, 6])
    expect(result.layout.grids.columns[2]).toBe(3)
    expect(result.layout.lots.x[0]).toBe(19)
  })

  it('rejects anything but an object', () => {
    expect(() => decodeResult(null)).toThrow(InvalidResultError)
    expect(() => decodeResult([])).toThrow('result is not an object')
  })

  it('rejects another format version', () => {
    expect(
      decodeChanged((json) => {
        json.formatVersion = 6
      }),
    ).toThrow('unsupported format version 6, expected 7')
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
        json.files.scope[0] = 'vendor'
      }),
    ).toThrow('files.scope[0] is not a scope')
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
        json.files.scope.pop()
      }),
    ).toThrow('column files.scope has 19 rows, expected 20')
    expect(
      decodeChanged((json) => {
        json.symbols.line.pop()
      }),
    ).toThrow('column symbols.line has 12 rows, expected 13')
    expect(
      decodeChanged((json) => {
        json.files.dependencies.pop()
      }),
    ).toThrow('column files.dependencies has 19 rows, expected 20')
    expect(
      decodeChanged((json) => {
        json.roles.entries.command.push(null)
      }),
    ).toThrow('column roles.entries.command has 2 rows, expected 1')
    expect(
      decodeChanged((json) => {
        json.roles.conductors.count.pop()
      }),
    ).toThrow('column roles.conductors.count has 2 rows, expected 3')
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

  it('rejects more resolved and external imports than imports', () => {
    expect(
      decodeChanged((json) => {
        json.stats.importsResolved = 1000
      }),
    ).toThrow(
      'stats.importsResolved and stats.importsExternal add up to more than stats.importsTotal',
    )
    expect(
      decodeChanged((json) => {
        json.stats.importsExternal = 6
      }),
    ).toThrow('add up to more than stats.importsTotal')
  })

  it('accepts an edge to a folder', () => {
    const decode = decodeChanged((json) => {
      json.edges.to[25] = null
      json.edges.toDir[25] = 2
    })
    expect(decode().edges.toDir[25]).toBe(2)
  })

  it('requires one target per edge, never the importing file', () => {
    expect(
      decodeChanged((json) => {
        json.edges.toDir[0] = 1
      }),
    ).toThrow('edges[0] must have exactly one target, in to or toDir')
    expect(
      decodeChanged((json) => {
        json.edges.to[0] = null
      }),
    ).toThrow('edges[0] must have exactly one target, in to or toDir')
    expect(
      decodeChanged((json) => {
        json.edges.to[0] = 2
      }),
    ).toThrow('edges[0] points to the file it comes from')
    expect(
      decodeChanged((json) => {
        json.edges.toDir[2] = 8
        json.edges.to[2] = null
      }),
    ).toThrow('edges.toDir[2] points to row 8, but the table has 8 rows')
  })

  it('requires roles that point to one file or one folder, with reasons', () => {
    expect(
      decodeChanged((json) => {
        json.roles.foundations.file[1] = 20
      }),
    ).toThrow('roles.foundations.file[1] points to row 20, but the table has 20 rows')
    expect(
      decodeChanged((json) => {
        json.roles.conductors.dir[0] = 3
      }),
    ).toThrow('roles.conductors[0] must have exactly one target, in file or dir')
    expect(
      decodeChanged((json) => {
        json.roles.entries.file[0] = null
      }),
    ).toThrow('roles.entries[0] must have exactly one target, in file or dir')
    expect(
      decodeChanged((json) => {
        json.roles.entries.reasons[0] = []
      }),
    ).toThrow('roles.entries.reasons[0] is empty')
    expect(
      decodeChanged((json) => {
        json.roles.entries.reasons[0] = ['readme']
      }),
    ).toThrow('roles.entries.reasons[0] is not a list of reasons')
    const goPackage = decodeChanged((json) => {
      json.roles.foundations.file[0] = null
      json.roles.foundations.dir[0] = 2
    })
    expect(goPackage().roles.foundations.dir[0]).toBe(2)
  })

  it('requires edges sorted by file then target, each once', () => {
    expect(
      decodeChanged((json) => {
        json.edges.to[2] = 4
      }),
    ).toThrow('edges[2] must come after the previous edge, by file then target')
    expect(
      decodeChanged((json) => {
        json.edges.from[1] = 9
      }),
    ).toThrow('edges[2] must come after the previous edge, by file then target')
    // A folder target sorts after every file target of the same file
    expect(
      decodeChanged((json) => {
        json.edges.to[1] = null
        json.edges.toDir[1] = 0
      }),
    ).toThrow('edges[2] must come after the previous edge, by file then target')
  })

  it('requires islands that start at their folder and follow the tree', () => {
    expect(
      decodeChanged((json) => {
        json.dirs.island.pop()
      }),
    ).toThrow('column dirs.island has 7 rows, expected 8')
    expect(
      decodeChanged((json) => {
        json.islands.dir.reverse()
        json.islands.layer.reverse()
      }),
    ).toThrow('islands[1] must come after the previous island, by folder')
    expect(
      decodeChanged((json) => {
        json.dirs.island[1] = null
      }),
    ).toThrow('dirs.island of islands.dir[1] must point back to island 1')
    expect(
      decodeChanged((json) => {
        json.dirs.island[7] = 9
      }),
    ).toThrow('dirs.island[7] points to row 9, but the table has 8 rows')
    expect(
      decodeChanged((json) => {
        json.islands.layer[2] = 0
      }),
    ).toThrow('islands.layer[2] must be 1 or more')
  })

  it('rejects a folder outside its parent island', () => {
    expect(
      decodeChanged((json) => {
        // `src/core` in the root island, which does not start there
        json.islands.dir.splice(2, 1)
        json.islands.layer.splice(2, 1)
        json.links = { from: [], to: [], imports: [], upward: [] }
        json.dirs.island = [0, 1, 0, 2, 3, 4, 5, 6]
      }),
    ).toThrow('dirs.island[2] must be its parent')
  })

  it('requires links between two islands, sorted, each once', () => {
    expect(
      decodeChanged((json) => {
        json.links.to[0] = 1
      }),
    ).toThrow('links[0] goes from an island to itself')
    expect(
      decodeChanged((json) => {
        json.links.from.reverse()
        json.links.to.reverse()
      }),
    ).toThrow('links[1] must come after the previous link, by islands')
    expect(
      decodeChanged((json) => {
        json.links.imports[0] = 0
      }),
    ).toThrow('links.imports[0] must be 1 or more')
    expect(
      decodeChanged((json) => {
        // From `src` (layer 3) down to `src/app`
        json.links.upward[1] = 1
      }),
    ).toThrow('links.upward[1] must be at most links.imports, between layers that go up')
    expect(
      decodeChanged((json) => {
        json.links.upward.pop()
      }),
    ).toThrow('column links.upward has 7 rows, expected 8')
    expect(
      decodeChanged((json) => {
        json.links.to[0] = 8
      }),
    ).toThrow('links.to[0] points to row 8, but the table has 8 rows')
  })

  it('requires cycles of two files or more that loop through their members', () => {
    expect(
      decodeChanged((json) => {
        json.cycles.members[0] = [5]
      }),
    ).toThrow('cycles.members[0] must hold two files or more, sorted, each once')
    expect(
      decodeChanged((json) => {
        json.cycles.members[0] = [6, 5]
      }),
    ).toThrow('cycles.members[0]')
    expect(
      decodeChanged((json) => {
        json.cycles.shortest[1] = [9, 8]
      }),
    ).toThrow('cycles.shortest[1] must go through two members or more, each once')
    expect(
      decodeChanged((json) => {
        json.cycles.shortest[0] = [5, 5]
      }),
    ).toThrow('cycles.shortest[0]')
    expect(
      decodeChanged((json) => {
        json.cycles.members[0] = 'store'
      }),
    ).toThrow('cycles.members[0] is not a list of indexes')
  })

  it('requires a plateau per island, inside the city, apart from the others', () => {
    expect(
      decodeChanged((json) => {
        json.layout.islands.width.pop()
      }),
    ).toThrow('column layout.islands.width has 7 rows, expected 8')
    expect(
      decodeChanged((json) => {
        json.layout.width = 669
      }),
    ).toThrow('layout.islands[3] must have a size and lie inside its island, parcel or city')
    expect(
      decodeChanged((json) => {
        json.layout.islands.width[0] = 200
      }),
    ).toThrow('layout.islands[1] overlaps another rectangle of the same island or parcel')
  })

  it('requires parcels below an island folder, in folder order', () => {
    const parcel = (json: Json, dir: number) => {
      json.layout.parcels = {
        dir: [dir],
        x: [200],
        y: [2],
        width: [10],
        height: [10],
        nature: ['normal'],
      }
    }
    expect(decodeChanged((json) => parcel(json, 1))).toThrow(
      'layout.parcels.dir[0] must be a folder with files, inside an island',
    )
    expect(
      decodeChanged((json) => {
        parcel(json, 1)
        json.layout.parcels.nature[0] = 'park'
      }),
    ).toThrow('layout.parcels.nature[0] is not a nature')
    expect(
      decodeChanged((json) => {
        json.layout.grids.dir.reverse()
      }),
    ).toThrow('layout.grids[1] must come after the previous row, by folder')
  })

  it('requires grids inside their island, for folders with files', () => {
    expect(
      decodeChanged((json) => {
        json.layout.grids.columns[0] = 5
      }),
    ).toThrow('layout.grids[0] must have a size and lie inside its island, parcel or city')
    expect(
      decodeChanged((json) => {
        json.layout.grids.rows[1] = 0
      }),
    ).toThrow('layout.grids[1] must have a size')
  })

  it('requires each file on a lot of its own on its grid', () => {
    expect(
      decodeChanged((json) => {
        json.layout.lots.x[1] = 59
      }),
    ).toThrow("layout.lots[1] must be the centre of a lot of its folder's grid")
    expect(
      decodeChanged((json) => {
        json.layout.lots.y[0] = 9
      }),
    ).toThrow('layout.lots[0]')
    expect(
      decodeChanged((json) => {
        json.layout.lots.x[1] = 19
      }),
    ).toThrow('layout.lots[1] shares its lot with another file')
  })
})
