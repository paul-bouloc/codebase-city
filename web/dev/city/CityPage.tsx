import { type ChangeEvent, useEffect, useMemo, useRef, useState } from 'react'
import type { CityEngine } from '../../src/city/engine/city-engine'
import type { CityItem, PortList } from '../../src/city/interaction/city-interaction'
import { cityFromResult } from '../../src/city/world/from-result'
import type { CityLayout } from '../../src/city/world/layout'
import { syntheticCity, withCrossingCycles } from '../../src/city/world/synthetic'
import { decodeResult } from '../../src/data/decode-result'
import type { AnalysisResult } from '../../src/data/generated/AnalysisResult'
import { CityScreen } from '../../src/screen/CityScreen'
import { CityView } from '../../src/screen/CityView'
import { PortCard } from '../../src/screen/tooltips/PortCard'
import { useDriveKeys } from '../../src/screen/use-drive-keys'
import { Button } from '../../src/ui/actions/Button'
import { archetypeGallery } from './archetype-gallery'
import styles from './CityPage.module.css'
import { variantGallery } from './variant-gallery'

const TEXT = {
  remount: 'Remount × 10',
  remounting: 'Remounting…',
  load: 'Load a result…',
  tools: 'Development',
}

const REMOUNTS = 10

/** Results dropped in `web/dev/results/`, by name, to their URL: fetched only when shown. */
const RESULTS = Object.fromEntries(
  Object.entries(
    import.meta.glob<string>('../results/*.json', { query: '?url', import: 'default', eager: true }),
  ).map(([path, url]) => [path.replace(/^.*\/(.*)\.json$/, '$1'), url]),
)

/** Reads a positive integer from the query string. */
function param(name: string, fallback: number): number {
  const value = Number(new URLSearchParams(window.location.search).get(name))
  return Number.isInteger(value) && value > 0 ? value : fallback
}

const nextFrame = () => new Promise((resolve) => requestAnimationFrame(resolve))

/**
 * A result written by `just ingest owner/repo --out result.json`, on the city screen: dropped in
 * `web/dev/results/`, it gets a button, and `?result=name` opens it; the selection is in the
 * fragment (`#file=path`, `#dir=path`). Without one, a synthetic city, bare, full screen:
 * `?islands=12&files=2000&seed=synthetic`, or every archetype on one island: `?gallery`, or with
 * import cycles across islands: `?cycles`, or every combination of the low buildings' pieces:
 * `?variants`.
 * `?look=x,y,distance[,azimuth,polar]` points the camera at a board point, for close captures.
 * `?select=path` selects the file or folder of that path once the city loads; `?port=path` opens
 * the port of that island.
 * `?stats` shows the frame stats, and with them the drawing of every frame (on by default for a
 * synthetic city, `?stats=off` hides them); without, the city draws only when something changes,
 * as in the product.
 */
export function CityPage() {
  const query = useMemo(() => new URLSearchParams(window.location.search), [])
  const synthetic = useMemo(() => {
    if (query.has('variants')) {
      return variantGallery()
    }
    if (query.has('gallery')) {
      return archetypeGallery()
    }
    const seed = query.get('seed') ?? undefined
    const city = syntheticCity({
      islands: param('islands', 12),
      files: param('files', 2_000),
      seed,
    })
    return query.has('cycles') ? withCrossingCycles(city) : city
  }, [query])
  const [result, setResult] = useState<AnalysisResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const input = useRef<HTMLInputElement>(null)
  const layout = useMemo(() => (result ? cityFromResult(result) : synthetic), [result, synthetic])
  const showStats = result
    ? query.has('stats') && query.get('stats') !== 'off'
    : query.get('stats') !== 'off'
  const [mount, setMount] = useState(0)
  const [remounting, setRemounting] = useState(false)
  const [engine, setEngine] = useState<CityEngine | null>(null)

  // After the city loads (the view's effect runs first), the camera goes where `?look` says.
  // biome-ignore lint/correctness/useExhaustiveDependencies: again after each city loads
  useEffect(() => {
    const look = query.get('look')
    const [x, y, distance, azimuth, polar] = (look ?? '').split(',').map(Number)
    if (engine && x !== undefined && y !== undefined && distance) {
      engine.lookAt(x, y, distance, azimuth, polar)
    }
  }, [engine, layout])

  // Then the file or folder `?select` names is selected: the screen opens its sheet.
  // biome-ignore lint/correctness/useExhaustiveDependencies: again after each city loads
  useEffect(() => {
    const path = query.get('select')
    if (engine && path) {
      engine.selectPath(path)
    }
  }, [engine, layout])

  // And the port of the island `?port` names is opened.
  useEffect(() => {
    const path = query.get('port')
    const island = layout.islands.findIndex((each) => each.path === path)
    if (engine && island >= 0) {
      engine.openPortOf(island)
    }
  }, [engine, layout, query])

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

  // Two results opened in quick succession: only the last one shows.
  const latest = useRef(0)
  async function show(text: Promise<string>) {
    const request = ++latest.current
    try {
      const decoded = decodeResult(JSON.parse(await text))
      if (request !== latest.current) {
        return
      }
      setResult(decoded)
      setError(null)
    } catch (cause) {
      if (request === latest.current) {
        setError(cause instanceof Error ? cause.message : String(cause))
      }
    }
  }

  function open(name: string) {
    const url = RESULTS[name]
    if (url) {
      const next = new URLSearchParams(window.location.search)
      next.set('result', name)
      // The fragment, the selection, stays: the screen reads it once the city is there.
      window.history.replaceState(null, '', `?${next}${window.location.hash}`)
      void show(fetch(url).then((response) => response.text()))
    }
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: opens the result of the URL once
  useEffect(() => {
    const name = query.get('result')
    if (name) {
      open(name)
    }
  }, [])

  async function load(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (file) {
      await show(file.text())
    }
    // The same file chosen again is a change too: to load it once more after an edit.
    event.target.value = ''
  }

  const tools = (
    <>
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
    </>
  )

  if (result) {
    return (
      <>
        <CityScreen key={mount} result={result} showStats={showStats} onEngine={setEngine} />
        {/* Where the guide will live: folded, it hides nothing of the screen. */}
        <details className={styles.screenTools}>
          <summary>{TEXT.tools}</summary>
          <div className={styles.screenToolsBody}>{tools}</div>
        </details>
      </>
    )
  }

  return (
    <main className={styles.page}>
      <BareCity key={mount} layout={layout} showStats={showStats} onEngine={setEngine} />
      <div className={styles.tools}>{tools}</div>
    </main>
  )
}

/** A city without its interface: hover and click show what they select, Esc clears it. */
function BareCity({
  layout,
  showStats,
  onEngine,
}: {
  layout: CityLayout
  showStats: boolean
  onEngine: (engine: CityEngine | null) => void
}) {
  const [engine, setEngine] = useState<CityEngine | null>(null)
  const [selection, setSelection] = useState<CityItem | null>(null)
  const [port, setPort] = useState<PortList | null>(null)

  useEffect(() => {
    onEngine(engine)
    engine?.setListeners({ select: setSelection, port: setPort })
    // Gone, the page must not drive its disposed engine.
    return () => onEngine(null)
  }, [engine, onEngine])

  // Esc closes the port open, if any, or clears the selection.
  const portOpen = port !== null
  useEffect(() => {
    const clear = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') {
        return
      }
      if (portOpen) {
        engine?.closePort()
      } else {
        engine?.clearSelection()
      }
    }
    window.addEventListener('keydown', clear)
    return () => window.removeEventListener('keydown', clear)
  }, [engine, portOpen])

  useDriveKeys(engine)

  return (
    <>
      <CityView layout={layout} showStats={showStats} onEngine={setEngine} />
      {selection && <p className={styles.selection}>{selection.path}</p>}
      {port?.pointer && (
        <PortCard
          {...port}
          pointer={port.pointer}
          onFocusLink={(index) => engine?.focusPortLink(index)}
        />
      )}
    </>
  )
}
