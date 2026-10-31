import styles from './Breadcrumb.module.css'
import { ELLIPSIS, hiddenFolders } from './fit-breadcrumb'

const TEXT = {
  label: 'Path',
}

// Characters that fit beside the close button: 400 px sheet, 16 + 12 px padding, 40 px button
// and 10 px gap leave 322 px, mono 12 at 7.2 px.
const MAX_CHARS = 44

interface BreadcrumbProps {
  // The folders above the selection, from the root.
  folders: readonly string[]
  // Opens the sheet of a folder, given its path from the root.
  onOpenFolder: (path: string) => void
}

// Each folder opens its own sheet. A long path loses its first folders: `… / common / model`.
export function Breadcrumb({ folders, onOpenFolder }: BreadcrumbProps) {
  const hidden = hiddenFolders(folders, MAX_CHARS)
  const fullPath = folders.join('/')

  return (
    <nav aria-label={TEXT.label} className={styles.breadcrumb} title={fullPath}>
      <ol className={styles.list}>
        {hidden > 0 && (
          <li className={styles.item}>
            <span className={styles.ellipsis}>{ELLIPSIS}</span>
          </li>
        )}
        {folders.map((folder, index) =>
          index < hidden ? null : (
            <li key={folders.slice(0, index + 1).join('/')} className={styles.item}>
              <button
                type="button"
                className={styles.segment}
                onClick={() => onOpenFolder(folders.slice(0, index + 1).join('/'))}
              >
                {folder}
              </button>
            </li>
          ),
        )}
      </ol>
    </nav>
  )
}
