import type { FileRole } from './Badge'

// Role names on the sheets, without the "likely" that inferred roles add.
export const ROLE_NAMES: Record<FileRole, string> = {
  'entry-point': 'Entry point',
  foundation: 'Foundation',
  conductor: 'Conductor',
  facade: 'Facade',
  test: 'Test',
  config: 'Config',
  generated: 'Generated',
}
