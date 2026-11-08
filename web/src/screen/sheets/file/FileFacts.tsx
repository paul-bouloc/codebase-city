import { Icon } from '../../../ui/brand/Icon'
import { exactCount } from '../../../ui/display/count-format'
import type { FileSheetData } from '../sheet-data'
import styles from './FileFacts.module.css'

const TEXT = {
  importedBy: 'Imported by',
  filesDirectly: (count: number) => ` ${count === 1 ? 'file' : 'files'} directly · `,
  inTotal: ' in total',
  showing: (shown: number, of: number) =>
    `Showing ${exactCount(shown)} of ${exactCount(of)} importers; the rest are grouped by island`,
  imports: 'Imports',
  filesSuffix: (count: number) => ` ${count === 1 ? 'file' : 'files'}`,
  layer: (index: number, of: number) => `Layer ${index} of ${of} · `,
  cycle: (files: number) => `Part of a cycle of ${exactCount(files)} files · `,
  showCycle: 'show it',
}

interface FileFactsProps {
  file: FileSheetData
  onOpenFolder: (path: string) => void
  onShowCycle: (index: number) => void
}

export function FileFacts({ file, onOpenFolder, onShowCycle }: FileFactsProps) {
  return (
    <ul className={styles.facts}>
      <li className={styles.fact}>
        <span className={`${styles.trait} ${styles.incoming}`} />
        <span>
          {TEXT.importedBy} <strong>{exactCount(file.importers)}</strong>
          {TEXT.filesDirectly(file.importers)}
          <strong>{exactCount(file.dependents)}</strong>
          {TEXT.inTotal}
          {file.shownImporters !== undefined && (
            <span className={styles.subFact}>
              {TEXT.showing(file.shownImporters, file.importers)}
            </span>
          )}
        </span>
      </li>
      <li className={styles.fact}>
        <span className={`${styles.trait} ${styles.outgoing}`} />
        <span>
          {TEXT.imports} <strong>{exactCount(file.imports)}</strong>
          {TEXT.filesSuffix(file.imports)}
        </span>
      </li>
      {file.layer && (
        <li className={styles.fact}>
          <Icon name="layers" size={16} className={styles.factIcon} />
          <span>
            {TEXT.layer(file.layer.index, file.layer.of)}
            <button
              type="button"
              className={`${styles.link} ${styles.mono}`}
              onClick={() => file.layer && onOpenFolder(file.layer.islandPath)}
            >
              {file.layer.island}
            </button>
          </span>
        </li>
      )}
      {file.cycles.map((files, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: cycles have no identity of their own here
        <li key={index} className={`${styles.fact} ${styles.cycle}`}>
          <Icon name="cycle" size={16} className={styles.factIcon} />
          <span>
            {TEXT.cycle(files)}
            <button type="button" className={styles.link} onClick={() => onShowCycle(index)}>
              {TEXT.showCycle}
            </button>
          </span>
        </li>
      ))}
    </ul>
  )
}
