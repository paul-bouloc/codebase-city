import type { Dirs } from '../generated/Dirs'
import type { Files } from '../generated/Files'
import type { Stats } from '../generated/Stats'
import type { Symbols } from '../generated/Symbols'
import {
  column,
  fail,
  inBounds,
  isBoolean,
  isScope,
  isStringOrNull,
  isSymbolKind,
  isU32OrNull,
  object,
  sameLength,
  stringColumn,
  u32,
  u32Column,
  validNames,
} from './checks'

export function decodeDirs(value: unknown): Dirs {
  const fields = object(value, 'dirs')
  const parent = column(fields.parent, 'dirs.parent', isU32OrNull, 'an index or null')
  const name = stringColumn(fields.name, 'dirs.name')
  const island = column(fields.island, 'dirs.island', isU32OrNull, 'an index or null')
  sameLength('dirs.name', parent.length, name)
  if (parent[0] !== null || name[0] !== '') {
    fail('the first folder must be the root: no parent and an empty name')
  }
  for (let row = 1; row < parent.length; row++) {
    // Parents come first, so the tree has one root and no loop
    const index = parent[row]
    if (index === null || index === undefined || index >= row) {
      fail(`dirs.parent[${row}] must point to an earlier folder`)
    }
  }
  validNames('dirs.name', name, 1)
  sameLength('dirs.island', parent.length, island)
  return { parent, name, island }
}

export function decodeFiles(value: unknown, dirCount: number, languageCount: number): Files {
  const fields = object(value, 'files')
  const dir = u32Column(fields.dir, 'files.dir')
  const files: Files = {
    dir,
    name: stringColumn(fields.name, 'files.name'),
    language: u32Column(fields.language, 'files.language'),
    lines: u32Column(fields.lines, 'files.lines'),
    complexity: column(fields.complexity, 'files.complexity', isU32OrNull, 'an integer or null'),
    generated: column(fields.generated, 'files.generated', isBoolean, 'a boolean'),
    header: column(fields.header, 'files.header', isStringOrNull, 'a string or null'),
    scope: column(fields.scope, 'files.scope', isScope, 'a scope'),
    barrel: column(fields.barrel, 'files.barrel', isBoolean, 'a boolean'),
    dependents: column(fields.dependents, 'files.dependents', isU32OrNull, 'an integer or null'),
    dependencies: column(
      fields.dependencies,
      'files.dependencies',
      isU32OrNull,
      'an integer or null',
    ),
  }
  sameLength('files.name', dir.length, files.name)
  sameLength('files.language', dir.length, files.language)
  sameLength('files.lines', dir.length, files.lines)
  sameLength('files.complexity', dir.length, files.complexity)
  sameLength('files.generated', dir.length, files.generated)
  sameLength('files.header', dir.length, files.header)
  sameLength('files.scope', dir.length, files.scope)
  sameLength('files.barrel', dir.length, files.barrel)
  sameLength('files.dependents', dir.length, files.dependents)
  sameLength('files.dependencies', dir.length, files.dependencies)
  inBounds('files.dir', dir, dirCount)
  inBounds('files.language', files.language, languageCount)
  validNames('files.name', files.name, 0)
  return files
}

export function decodeSymbols(value: unknown, fileCount: number): Symbols {
  const fields = object(value, 'symbols')
  const file = u32Column(fields.file, 'symbols.file')
  const symbols: Symbols = {
    file,
    name: stringColumn(fields.name, 'symbols.name'),
    kind: column(fields.kind, 'symbols.kind', isSymbolKind, 'a symbol kind'),
    line: u32Column(fields.line, 'symbols.line'),
  }
  sameLength('symbols.name', file.length, symbols.name)
  sameLength('symbols.kind', file.length, symbols.kind)
  sameLength('symbols.line', file.length, symbols.line)
  inBounds('symbols.file', file, fileCount)
  const emptyName = symbols.name.indexOf('')
  if (emptyName !== -1) {
    fail(`symbols.name[${emptyName}] is empty`)
  }
  const lineZero = symbols.line.indexOf(0)
  if (lineZero !== -1) {
    fail(`symbols.line[${lineZero}] must be 1 or more`)
  }
  for (let row = 1; row < file.length; row++) {
    const previousFile = file[row - 1] as number
    const currentFile = file[row] as number
    if (
      previousFile > currentFile ||
      (previousFile === currentFile &&
        (symbols.line[row - 1] as number) > (symbols.line[row] as number))
    ) {
      fail(`symbols[${row}] must come after the previous symbol, by file then line`)
    }
  }
  return symbols
}

export function decodeStats(value: unknown): Stats {
  const fields = object(value, 'stats')
  const ignored = object(fields.ignored, 'stats.ignored')
  const stats: Stats = {
    ignored: {
      vendored: u32(ignored.vendored, 'stats.ignored.vendored'),
      minified: u32(ignored.minified, 'stats.ignored.minified'),
      binary: u32(ignored.binary, 'stats.ignored.binary'),
      deep: u32(ignored.deep, 'stats.ignored.deep'),
    },
    importsTotal: u32(fields.importsTotal, 'stats.importsTotal'),
    importsResolved: u32(fields.importsResolved, 'stats.importsResolved'),
    importsExternal: u32(fields.importsExternal, 'stats.importsExternal'),
  }
  if (stats.importsResolved + stats.importsExternal > stats.importsTotal) {
    fail('stats.importsResolved and stats.importsExternal add up to more than stats.importsTotal')
  }
  return stats
}
