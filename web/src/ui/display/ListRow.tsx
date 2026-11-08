import type { ComponentPropsWithRef } from 'react'
import type { FileRole } from '../../data/file-kinds'
import { Icon } from '../brand/Icon'
import { Badge } from './Badge'
import { exactCount } from './count-format'
import styles from './ListRow.module.css'
import { useTruncatedPath } from './use-truncated-path'

const TEXT = {
  lines: (count: number) => `${exactCount(count)} ${count === 1 ? 'line' : 'lines'}`,
  importedBy: (count: number) =>
    `Imported by ${exactCount(count)} ${count === 1 ? 'file' : 'files'}`,
  imports: (count: number) => `imports ${exactCount(count)}`,
}

type NativeProps = Omit<ComponentPropsWithRef<'div'>, 'children' | 'role'>

interface ListRowProps extends NativeProps {
  name: string
  // Full path from the repository root, file name included.
  path: string
  lines: number
  incoming: number
  outgoing: number
  fileRole?: FileRole
  selected?: boolean
}

// One option of a listbox: the list owns the keyboard and the selection.
export function ListRow({
  name,
  path,
  lines,
  incoming,
  outgoing,
  fileRole,
  selected = false,
  // Roving focus: the list gives 0 to its active row.
  tabIndex = -1,
  className,
  ...rest
}: ListRowProps) {
  const { ref, text } = useTruncatedPath<HTMLSpanElement>(path)
  const classes = [styles.row, selected && styles.selected, className].filter(Boolean).join(' ')

  return (
    <div role="option" aria-selected={selected} tabIndex={tabIndex} className={classes} {...rest}>
      <Icon name="file" size={20} className={styles.icon} />
      <span className={styles.names}>
        <span className={styles.name}>{name}</span>
        {/* Screen readers get the whole path, not its shortened picture. */}
        <span ref={ref} className={styles.path} title={path} aria-hidden="true">
          {text}
        </span>
        <span className="visually-hidden">{path}</span>
      </span>
      <span className={styles.metrics}>
        <span>{TEXT.lines(lines)}</span>
        <span className={styles.incoming}>
          <span aria-hidden="true">↙ {exactCount(incoming)}</span>
          <span className="visually-hidden">{TEXT.importedBy(incoming)}</span>
        </span>
        <span className={styles.outgoing}>
          <span aria-hidden="true">↗ {exactCount(outgoing)}</span>
          <span className="visually-hidden">{TEXT.imports(outgoing)}</span>
        </span>
      </span>
      {fileRole && <Badge kind="role" fileRole={fileRole} />}
    </div>
  )
}
