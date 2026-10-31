import type { Language } from './Badge'

// Language names on badges and file cards: unanalyzed files say so.
export const LANGUAGE_LABELS: Record<Language, string> = {
  typescript: 'TypeScript',
  javascript: 'JavaScript',
  css: 'CSS',
  other: 'Not analyzed',
}
