import { useEffect, useRef, useState } from 'react'
import { CityEngine } from '../city/city-engine'
import type { CityLayout } from '../city/layout'
import { CityStats } from './CityStats'
import styles from './CityView.module.css'

interface CityViewProps {
  layout: CityLayout
  /** Draw every frame and show the frame rate and draw calls. */
  showStats?: boolean
  /** Called with the engine once it is mounted, and with null when it goes. */
  onEngine?: (engine: CityEngine | null) => void
}

/** Mounts the city engine in its parent's whole box. */
export function CityView({ layout, showStats = false, onEngine }: CityViewProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [engine, setEngine] = useState<CityEngine | null>(null)

  useEffect(() => {
    const container = containerRef.current
    if (!container) {
      return
    }
    const created = new CityEngine(container, { continuous: showStats })
    const observer = new ResizeObserver(([entry]) => {
      if (entry) {
        created.setSize(entry.contentRect.width, entry.contentRect.height)
      }
    })
    observer.observe(container)
    setEngine(created)
    return () => {
      observer.disconnect()
      created.dispose()
      setEngine(null)
    }
  }, [showStats])

  useEffect(() => {
    engine?.load(layout)
  }, [engine, layout])

  useEffect(() => {
    if (!engine) {
      return
    }
    onEngine?.(engine)
    // Unmounted, the view renders no more: its engine is gone, and the parent must know.
    return () => onEngine?.(null)
  }, [engine, onEngine])

  return (
    <div ref={containerRef} className={styles.view}>
      {showStats && engine && <CityStats engine={engine} />}
    </div>
  )
}
