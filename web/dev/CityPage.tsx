import { type ChangeEvent, useMemo, useRef, useState } from 'react'
import { CityView } from '../src/app/CityView'
import { cityFromResult } from '../src/city/from-result'
import type { CityLayout } from '../src/city/layout'
import { syntheticCity } from '../src/city/synthetic'
import { decodeResult } from '../src/data/decode-result'
import { Button } from '../src/ui/Button'
import { archetypeGallery } from './archetype-gallery'
import styles from './CityPage.module.css'

const TEXT = {
  remount: 'Remount × 10',
  remounting: 'Remounting…',
  load: 'Load a result…',
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
 * one island: `?gallery`. A result written by `just ingest owner/repo --out result.json` can be
 * loaded in its place.
 */
export function CityPage() {
  const synthetic = useMemo(() => {
    const query = new URLSearchParams(window.location.search)
    if (query.has('gallery')) {
      return archetypeGallery()
    }
    const seed = query.get('seed') ?? undefined
    return syntheticCity({ islands: param('islands', 12), files: param('files', 2_000), seed })
  }, [])
  const [loaded, setLoaded] = useState<CityLayout | null>(null)
  const [error, setError] = useState<string | null>(null)
  const input = useRef<HTMLInputElement>(null)
  const layout = loaded ?? synthetic
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

  async function load(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) {
      return
    }
    try {
      setLoaded(cityFromResult(decodeResult(JSON.parse(await file.text()))))
      setError(null)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  return (
    <main className={styles.page}>
      <CityView key={mount} layout={layout} showStats />
      <div className={styles.tools}>
        <Button variant="secondary" onClick={() => input.current?.click()}>
          {TEXT.load}
        </Button>
        <Button variant="secondary" onClick={remount} disabled={remounting}>
          {remounting ? TEXT.remounting : TEXT.remount}
        </Button>
        <input
          ref={input}
          className={styles.file}
          type="file"
          accept=".json,application/json"
          onChange={load}
        />
        {error && <p className={styles.error}>{error}</p>}
      </div>
    </main>
  )
}
