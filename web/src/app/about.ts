import { ANALYZED_LANGUAGES } from '../city/world/from-result'
import { githubCommitUrl } from '../screen/github-links'
import { languageOf, type ResultIndex } from '../screen/result-index'
import type { AboutData } from '../screen/sheets/sheet-data'
import type { Language } from '../ui/Badge'

// The About panel, read from the analysis result. When and on which branch the analysis ran is
// stored beside the result, not in it: the screen adds it when it has it.

/** A short commit hash, as GitHub shows one. */
export const SHORT_SHA = 7

/**
 * Programming languages whose imports the analyzer does not resolve yet. Data, markup and styles
 * have no imports to miss: they are not listed.
 */
const CODE_LANGUAGES: ReadonlySet<string> = new Set([
  'C',
  'C++',
  'C#',
  'Java',
  'Kotlin',
  'Rust',
  'Ruby',
  'PHP',
  'Swift',
  'Scala',
  'Dart',
  'Elixir',
  'Lua',
  'Objective-C',
  'Haskell',
  'Clojure',
  'Erlang',
  'OCaml',
  'R',
  'Perl',
  'Zig',
])

export function aboutData(index: ResultIndex): AboutData {
  const { result } = index
  const { files, stats } = result

  const byLanguage = new Map<Language, number>()
  const byName = new Map<string, number>()
  files.language.forEach((language) => {
    const name = result.languages[language] ?? ''
    byName.set(name, (byName.get(name) ?? 0) + 1)
    const shown = languageOf(name)
    byLanguage.set(shown, (byLanguage.get(shown) ?? 0) + 1)
  })
  const analyzed = [...byName.keys()].some((name) => ANALYZED_LANGUAGES.has(name))
  // Imports meant for the repository's own files: those of outside packages are not to resolve.
  const internal = stats.importsTotal - stats.importsExternal

  const { ignored } = stats
  const skipped = [
    { reason: 'vendored' as const, files: ignored.vendored },
    { reason: 'minified' as const, files: ignored.minified },
    { reason: 'binary' as const, files: ignored.binary },
    { reason: 'too deep' as const, files: ignored.deep },
  ].filter(({ files }) => files > 0)

  return {
    analyzedFiles: files.name.length,
    generatedFiles: files.generated.filter(Boolean).length,
    skipped,
    languages: [...byLanguage]
      .map(([language, files]) => ({ language, files }))
      .sort(
        (a, b) =>
          Number(a.language === 'other') - Number(b.language === 'other') || b.files - a.files,
      ),
    // No import to resolve leaves none unresolved.
    ...(analyzed ? { resolvedImports: internal > 0 ? stats.importsResolved / internal : 1 } : {}),
    unanalyzed: [...byName]
      .filter(([name]) => CODE_LANGUAGES.has(name))
      .map(([name, files]) => ({ name, files }))
      .sort((a, b) => b.files - a.files),
    commit: result.sha.slice(0, SHORT_SHA),
    commitUrl: githubCommitUrl(result.repo, result.sha),
    analyzer: `analyzer ${result.analyzerVersion}`,
  }
}
