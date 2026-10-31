import { useMemo, useState } from 'react'
import { CityView } from '../src/app/CityView'
import { syntheticCity } from '../src/city/synthetic'
import { Button } from '../src/ui/Button'
import { archetypeGallery } from './archetype-gallery'
import styles from './CityPage.module.css'

const TEXT = {
  remount: 'Remount × 10',
  remounting: 'Remounting…',
}

const REMOUNTS = 10

/** Reads a positive integer from the query string. */
function param(name: string, fallback: number): number {
  const value = Number(new URLSearchParams(window.location.search).get(name))
  return Number.isInteger(value) && value > 0 ? value : fallback
}

const nextFrame = () => new Promise((resolve) => requestAnimationFrame(resolve))

/**
 * A synthetic city, full screen: `?islands=12&files=2000&seed=synthetic`, or every archetype on
 * one island: `?gallery`.
 */
export function CityPage() {
  const layout = useMemo(() => {
    const query = new URLSearchParams(window.location.search)
    if (query.has('gallery')) {
      return archetypeGallery()
    }
    const seed = query.get('seed') ?? undefined
    return syntheticCity({ islands: param('islands', 12), files: param('files', 2_000), seed })
  }, [])
  const [mount, setMount] = useState(0)
  const [remounting, setRemounting] = useState(false)

  // Engines leaking GPU memory warn in the console when they are disposed.
  async function remount() {
    setRemounting(true)
    for (let i = 0; i < REMOUNTS; i++) {
      setMount((value) => value + 1)
      await nextFrame()
      await nextFrame()
    }
    setRemounting(false)
  }

  return (
    <main className={styles.page}>
      <CityView key={mount} layout={layout} showStats />
      <div className={styles.tools}>
        <Button variant="secondary" onClick={remount} disabled={remounting}>
          {remounting ? TEXT.remounting : TEXT.remount}
        </Button>
      </div>
    </main>
  )
}
