import styles from './Kbd.module.css'

interface KbdProps {
  // One key per Kbd: "⌘ K" is two of them side by side.
  children: string
}

export function Kbd({ children }: KbdProps) {
  return <kbd className={styles.kbd}>{children}</kbd>
}
