import styles from './Spinner.module.css'

interface SpinnerProps {
  className?: string
}

// Decorative: the busy element says what is going on (`aria-busy`, a label such as "Starting…").
export function Spinner({ className }: SpinnerProps) {
  return (
    <svg
      className={className ? `${styles.spinner} ${className}` : styles.spinner}
      width={16}
      height={16}
      viewBox="0 0 16 16"
      aria-hidden="true"
    >
      <circle className={styles.track} cx="8" cy="8" r="6" />
      <path className={styles.arc} d="M8 2a6 6 0 0 1 6 6" />
    </svg>
  )
}
