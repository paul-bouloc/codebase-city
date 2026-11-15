import { exactCount } from '../../../ui/display/count-format'
import { counted } from '../tour/tour-spans'

// What the answer to "Where are the cycles?" says.

export const NO_CYCLES = 'No cycles found.'

/** The question's line under its title: "14 cycles, biggest first". */
export function cyclesSubtitle(cycles: number): string {
  if (cycles === 0) {
    return 'No cycles found'
  }
  return cycles === 1 ? '1 cycle' : `${counted(cycles, 'cycle')}, biggest first`
}

/** "**14 cycles** involving 212 files · biggest first"; the first part stands out. */
export function cyclesSummary(cycles: number, files: number): { cycles: string; rest: string } {
  return {
    cycles: counted(cycles, 'cycle'),
    rest: ` involving ${counted(files, 'file')}${cycles > 1 ? ' · biggest first' : ''}`,
  }
}

/** The folders of a cycle, as its row reads them: "editor/contrib/find ↔ editor/browser". */
export function cycleFolders(folders: readonly string[]): string {
  return folders.join(' ↔ ')
}

/** What a cycle's row says to a screen reader: "Cycle of 26 files, editor/… ↔ editor/browser". */
export function cycleLabel(files: number, folders: readonly string[]): string {
  return `Cycle of ${counted(files, 'file')}, ${cycleFolders(folders)}`
}

/** Under the files of a cycle's loop: "and 21 more · shown in the city". */
export function cycleMore(more: number): string {
  return `and ${exactCount(more)} more · shown in the city`
}

/** The link that lists every cycle. */
export function showAllCycles(cycles: number): string {
  return `Show all ${exactCount(cycles)}`
}
