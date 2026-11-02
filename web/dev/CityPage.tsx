import { type ChangeEvent, useEffect, useMemo, useRef, useState } from 'react'
import { CityView } from '../src/app/CityView'
import type { CityEngine } from '../src/city/city-engine'
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

/** Results dropped in `web/dev/results/`, by name, to their URL: fetched only when shown. */
const RESULTS = Object.fromEntries(
  Object.entries(
    import.meta.glob<string>('./results/*.json', { query: '?url', import: 'default', eager: true }),
  ).map(([path, url]) => [path.replace(/^.*\/(.*)\.json$/, '$1'), url]),
)

/** Reads a positive integer from the query string. */
function param(name: string, fallback: number): number {
  const value = Number(new URLSearchParams(window.location.search).get(name))
  return Number.isInteger(value) && value > 0 ? value : fallback
}

const nextFrame = () => new Promise((resolve) => requestAnimationFrame(resolve))

/**
 * A synthetic city, full screen: `?islands=12&files=2000&seed=synthetic`, or every archetype on
 * one island: `?gallery`. A result written by `just ingest owner/repo --out result.json` can be
 * loaded in its place, or dropped in `web/dev/results/` to get a button: `?result=name` opens it.
 * `?look=x,y,distance[,azimuth,polar]` points the camera at a board point, for close captures.
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
  const [engine, setEngine] = useState<CityEngine | null>(null)

  // After the city loads (the view's effect runs first), the camera goes where `?look` says.
  // biome-ignore lint/correctness/useExhaustiveDependencies: again after each city loads
  useEffect(() => {
    const look = new URLSearchParams(window.location.search).get('look')
    const [x, y, distance, azimuth, polar] = (look ?? '').split(',').map(Number)
    if (engine && x !== undefined && y !== undefined && distance) {
      engine.lookAt(x, y, distance, azimuth, polar)
    }
  }, [engine, layout])

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

  async function show(text: Promise<string>) {
    try {
      setLoaded(cityFromResult(decodeResult(JSON.parse(await text))))
      setError(null)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  function open(name: string) {
    const url = RESULTS[name]
    if (url) {
      const query = new URLSearchParams(window.location.search)
      query.set('result', name)
      window.history.replaceState(null, '', `?${query}`)
      void show(fetch(url).then((response) => response.text()))
    }
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: opens the result of the URL once
  useEffect(() => {
    const name = new URLSearchParams(window.location.search).get('result')
    if (name) {
      open(name)
    }
  }, [])

  async function load(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (file) {
      await show(file.text())
    }
  }

  return (
    <main className={styles.page}>
      <CityView key={mount} layout={layout} showStats onEngine={setEngine} />
      <div className={styles.tools}>
        {Object.keys(RESULTS)
          .sort()
          .map((name) => (
            <Button key={name} variant="secondary" onClick={() => open(name)}>
              {name}
            </Button>
          ))}
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
