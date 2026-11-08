import tokensCss from '../../src/ui/styles/tokens.css?raw'

export interface Token {
  name: string
  value: string
}

export interface TokenGroup {
  prefix: string
  tokens: Token[]
}

const COLOR_PREFIXES = ['color', 'state', 'brand', 'feedback', 'meaning', 'city', 'lang']

// Reads the first `:root` block of tokens.css, so the page never drifts from the source.
function readRootTokens(): Token[] {
  const rootBlock = tokensCss.match(/:root\s*\{([\s\S]*?)\n\}/)?.[1] ?? ''
  return [...rootBlock.matchAll(/--([a-z0-9-]+):\s*([^;]+);/g)].map((match) => ({
    name: match[1] ?? '',
    value: (match[2] ?? '').replace(/\s+/g, ' ').trim(),
  }))
}

const ROOT_TOKENS = readRootTokens()

export function tokensWithPrefix(prefix: string): Token[] {
  return ROOT_TOKENS.filter((token) => token.name.startsWith(`${prefix}-`))
}

export const COLOR_GROUPS: TokenGroup[] = COLOR_PREFIXES.map((prefix) => ({
  prefix,
  tokens: tokensWithPrefix(prefix),
}))
