import { useEffect, useState } from 'react'
import type { CityEngine, FrameStats } from '../city/city-engine'
import styles from './CityStats.module.css'

const REFRESH_MS = 500

interface CityStatsProps {
  engine: CityEngine
}

/** Frame rate, draw calls and triangles, for development. */
export function CityStats({ engine }: CityStatsProps) {
  const [stats, setStats] = useState<FrameStats>(() => ({ ...engine.getStats() }))

  useEffect(() => {
    const timer = window.setInterval(() => setStats({ ...engine.getStats() }), REFRESH_MS)
    return () => window.clearInterval(timer)
  }, [engine])

  return (
    <output className={styles.stats}>
      {stats.fps} fps · {stats.drawCalls} draw calls · {(stats.triangles / 1000).toFixed(1)}k
      triangles
    </output>
  )
}
