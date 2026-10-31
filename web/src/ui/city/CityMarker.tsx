import styles from './CityMarker.module.css'

const numbers = new Intl.NumberFormat('en-US')

const TEXT = {
  cycle: (files: number) => `Cycle · ${numbers.format(files)} ${files === 1 ? 'file' : 'files'}`,
  impact: (name: string, dependents: number) =>
    `${name} · ${numbers.format(dependents)} ${dependents === 1 ? 'dependent' : 'dependents'}`,
  guide: (name: string, note: string) => `${name} · ${note}`,
}

export type CityMarkerProps =
  // A stop on a path between two files: ink at both ends, navy in between.
  | { kind: 'route'; step: number; end: boolean }
  | { kind: 'cycle'; files: number }
  | { kind: 'impact'; name: string; dependents: number }
  // A file the guide is showing: "main.ts · entry point".
  | { kind: 'guide'; name: string; note: string }

// A label pinned above a roof. The city places it and keeps at most six on screen.
export function CityMarker(props: CityMarkerProps) {
  if (props.kind === 'route') {
    return (
      <span className={`${styles.step} ${props.end ? styles.end : styles.middle}`}>
        {props.step}
      </span>
    )
  }

  const text =
    props.kind === 'cycle'
      ? TEXT.cycle(props.files)
      : props.kind === 'impact'
        ? TEXT.impact(props.name, props.dependents)
        : TEXT.guide(props.name, props.note)
  return <span className={`${styles.label} ${styles[props.kind]}`}>{text}</span>
}
