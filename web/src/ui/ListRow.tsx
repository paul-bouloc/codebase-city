import type { ComponentPropsWithRef } from 'react'
import { Badge, type FileRole } from './Badge'
import { Icon } from './Icon'
import styles from './ListRow.module.css'
import { useTruncatedPath } from './use-truncated-path'

const numbers = new Intl.NumberFormat('en-US')

const TEXT = {
  lines: (count: number) => `${numbers.format(count)} ${count === 1 ? 'line' : 'lines'}`,
  importedBy: (count: number) => `Imported by ${numbers.format(count)}`,
  imports: (count: number) => `imports ${numbers.format(count)}`,
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
        <span ref={ref} className={styles.path} title={path}>
          {text}
        </span>
      </span>
      <span className={styles.metrics}>
        <span>{TEXT.lines(lines)}</span>
        <span className={styles.incoming}>
          <span aria-hidden="true">↙ {numbers.format(incoming)}</span>
          <span className="visually-hidden">{TEXT.importedBy(incoming)}</span>
        </span>
        <span className={styles.outgoing}>
          <span aria-hidden="true">↗ {numbers.format(outgoing)}</span>
          <span className="visually-hidden">{TEXT.imports(outgoing)}</span>
        </span>
      </span>
      {fileRole && <Badge kind="role" fileRole={fileRole} />}
    </div>
  )
}
