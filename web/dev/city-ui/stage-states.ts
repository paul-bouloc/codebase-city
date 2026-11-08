import type { FileSheetData, FolderSheetData } from '../../src/screen/sheets/sheet-data'
import {
  FILE_CODE_GONE,
  FILE_CODE_TIMEOUT,
  FILE_CYCLES,
  FOLDER,
  FOLDER_NO_README,
  FILE as SHEET_FILE,
  TEST_PARK,
  UNANALYZED_FILE,
  UNANALYZED_FOLDER,
} from './sheet-samples'

// The states the stage's tools pick from: a selection opens its sheet, a hover its tooltip.

export const SELECTION_LABELS = {
  none: 'None',
  file: 'File: textModel.ts',
  'file-cycles': 'File in three cycles',
  'file-loading': 'File, loading',
  'file-unanalyzed': 'File, not analyzed',
  'file-timeout': 'File, code timed out',
  'file-gone': 'File, code gone from GitHub',
  folder: 'Island: editor',
  'folder-no-readme': 'Island without README',
  'folder-unanalyzed': 'Folder, not analyzed',
  'folder-tests': 'Test park',
  'folder-loading': 'Island, loading',
}

export const HOVER_LABELS = {
  off: 'None',
  file: 'Building',
  long: 'Long path',
  parcel: 'Parcel',
  island: 'Island',
}

export type Hover = keyof typeof HOVER_LABELS
export type Selection = Exclude<keyof typeof SELECTION_LABELS, 'none'>

export const SELECTIONS: Record<
  Selection,
  { file: FileSheetData; loading?: boolean } | { folder: FolderSheetData; loading?: boolean }
> = {
  file: { file: SHEET_FILE },
  'file-cycles': { file: FILE_CYCLES },
  'file-loading': { file: SHEET_FILE, loading: true },
  'file-unanalyzed': { file: UNANALYZED_FILE },
  'file-timeout': { file: FILE_CODE_TIMEOUT },
  'file-gone': { file: FILE_CODE_GONE },
  folder: { folder: FOLDER },
  'folder-no-readme': { folder: FOLDER_NO_README },
  'folder-unanalyzed': { folder: UNANALYZED_FOLDER },
  'folder-tests': { folder: TEST_PARK },
  'folder-loading': { folder: FOLDER, loading: true },
}
