import type { Language } from '../../data/file-kinds'

// Language names on badges and file cards: unanalyzed files say so.
export const LANGUAGE_LABELS: Record<Language, string> = {
  typescript: 'TypeScript',
  javascript: 'JavaScript',
  python: 'Python',
  go: 'Go',
  css: 'CSS',
  other: 'Not analyzed',
}
