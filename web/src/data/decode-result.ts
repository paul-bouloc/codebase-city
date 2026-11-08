import { fail, object, string, stringColumn, u32 } from './decode/checks'
import { decodeDirs, decodeFiles, decodeStats, decodeSymbols } from './decode/files'
import { decodeCycles, decodeEdges, decodeIslands, decodeLinks, decodeRoles } from './decode/graph'
import { decodeLayout } from './decode/layout'
import { decodeTour } from './decode/tour'
import type { AnalysisResult } from './generated/AnalysisResult'

// FORMAT_VERSION in crates/model; the generated sample result keeps the two in step.
export const FORMAT_VERSION = 10

/**
 * Turns a parsed JSON analysis result into a typed one, or throws an
 * InvalidResultError. Runs the same consistency checks as the Rust model
 * (crates/model/src/validate.rs and validate/layout.rs), so the rest of the app can trust
 * the indexes.
 */
export function decodeResult(json: unknown): AnalysisResult {
  const fields = object(json, 'result')
  const formatVersion = u32(fields.formatVersion, 'formatVersion')
  if (formatVersion !== FORMAT_VERSION) {
    fail(`unsupported format version ${formatVersion}, expected ${FORMAT_VERSION}`)
  }
  const repo = object(fields.repo, 'repo')
  const dirs = decodeDirs(fields.dirs)
  const languages = stringColumn(fields.languages, 'languages')
  const files = decodeFiles(fields.files, dirs.parent.length, languages.length)
  const islands = decodeIslands(fields.islands, dirs)
  const roles = decodeRoles(fields.roles, files.dir.length, dirs.parent.length)
  const links = decodeLinks(fields.links, islands.layer)
  const cycles = decodeCycles(fields.cycles, files.dir.length)
  return {
    formatVersion,
    analyzerVersion: string(fields.analyzerVersion, 'analyzerVersion'),
    repo: {
      owner: string(repo.owner, 'repo.owner'),
      name: string(repo.name, 'repo.name'),
    },
    sha: string(fields.sha, 'sha'),
    dirs,
    languages,
    files,
    symbols: decodeSymbols(fields.symbols, files.dir.length),
    edges: decodeEdges(fields.edges, files.dir.length, dirs.parent.length),
    roles,
    islands,
    links,
    cycles,
    layout: decodeLayout(fields.layout, dirs, islands, files),
    tour: decodeTour(fields.tour, { dirs, files, languages, roles, islands, links, cycles }),
    stats: decodeStats(fields.stats),
  }
}
