import type { CityAccount, CityRepo } from '../src/ui/city/CityTopBar'
import { githubTreeUrl } from '../src/ui/city/github-links'
import { type LegendContent, legendContent } from '../src/ui/city/legend-content'

// The demonstration content of the boards: microsoft/vscode at a1b2c3d.
export const REPO: CityRepo = {
  owner: 'microsoft',
  name: 'vscode',
  commit: 'a1b2c3d',
  analyzed: '2 days ago',
  githubUrl: githubTreeUrl({ owner: 'microsoft', name: 'vscode' }, 'a1b2c3d'),
}

export const ACCOUNT: CityAccount = {
  login: 'lena-okafor',
  quota: '7 of 10 analyses left today · resets at 1:00 AM',
  accountHref: '#account',
  onSignOut: () => {},
}

// Everything the legend can show.
export const FULL_LEGEND: LegendContent = legendContent({
  languages: [
    { language: 'typescript', files: 14_300 },
    { language: 'javascript', files: 456 },
    { language: 'css', files: 304 },
    { language: 'other', files: 152 },
  ],
  testFiles: 1_240,
  places: new Set(['bridge', 'ferry', 'port', 'upward', 'cycle', 'canal', 'park']),
  landmarks: new Set(['entry-point', 'conductor', 'foundation', 'facade', 'config']),
})

// A small repository: one language, no tests, few kinds of places.
export const SMALL_LEGEND: LegendContent = legendContent({
  languages: [{ language: 'javascript', files: 41 }],
  testFiles: 0,
  places: new Set(['bridge', 'canal']),
  landmarks: new Set(['entry-point']),
})

export const FILE = {
  path: 'src/vs/editor/common/model/textModel.ts',
  language: 'typescript',
  lines: 2481,
  complexity: 412,
  complexityTop: 1,
  incoming: 1204,
  outgoing: 38,
  fileRole: 'conductor',
} as const

export const LONG_FILE = {
  path: 'src/vs/workbench/contrib/terminal/browser/xterm/decorationAddon.ts',
  language: 'typescript',
  lines: 512,
  complexity: 64,
  incoming: 3,
  outgoing: 21,
} as const

export const PARCEL = { path: 'src/vs/editor/common', files: 612, layer: 3, island: 'editor' }
export const ISLAND = { path: 'src/vs/workbench', files: 6204, layer: 4 }
