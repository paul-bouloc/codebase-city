import styles from './Kbd.module.css'

interface KbdProps {
  // One key per Kbd: "⌘ K" is two of them side by side.
  children: string
  // On a dark surface, such as a control tooltip.
  tone?: 'default' | 'inverse'
}

export function Kbd({ children, tone = 'default' }: KbdProps) {
  const classes = tone === 'inverse' ? `${styles.kbd} ${styles.inverse}` : styles.kbd
  return <kbd className={classes}>{children}</kbd>
}
