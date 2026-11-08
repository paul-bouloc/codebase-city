import styles from './MetricPairs.module.css'

export interface Metric {
  label: string
  value: string
  // "top 1% · rank 23 of 15,212".
  note?: string
}

interface MetricPairsProps {
  metrics: readonly Metric[]
  // Two for a file, three for a folder.
  columns: 2 | 3
}

export function MetricPairs({ metrics, columns }: MetricPairsProps) {
  return (
    <dl className={`${styles.pairs} ${columns === 3 ? styles.three : styles.two}`}>
      {metrics.map((metric) => (
        <div key={metric.label} className={styles.pair}>
          <dt className={styles.label}>{metric.label}</dt>
          <dd className={styles.value}>{metric.value}</dd>
          {metric.note && <dd className={styles.note}>{metric.note}</dd>}
        </div>
      ))}
    </dl>
  )
}
