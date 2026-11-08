import { type ChangeEvent, useEffect, useMemo, useRef, useState } from 'react'
import { CityView } from '../src/app/CityView'
import { useDriveKeys } from '../src/app/use-drive-keys'
import { type CityCards, cityCards } from '../src/city/city-cards'
import type { CityEngine } from '../src/city/city-engine'
import type { CityHover, CityItem, PortList } from '../src/city/city-interaction'
import { cityFromResult } from '../src/city/from-result'
import type { CityLayout } from '../src/city/layout'
import { syntheticCity, withCrossingCycles } from '../src/city/synthetic'
import { decodeResult } from '../src/data/decode-result'
import { Button } from '../src/ui/Button'
import { AreaTooltip } from '../src/ui/city/AreaTooltip'
import { BundleTooltip } from '../src/ui/city/BundleTooltip'
import { FileTooltip } from '../src/ui/city/FileTooltip'
import { PortCard } from '../src/ui/city/PortCard'
import { PortTooltip } from '../src/ui/city/PortTooltip'
import { archetypeGallery } from './archetype-gallery'
import styles from './CityPage.module.css'
import { variantGallery } from './variant-gallery'

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
 * one island: `?gallery`, or with import cycles across islands: `?cycles`, or every combination of the low buildings' pieces: `?variants`. A result written by `just ingest owner/repo --out result.json` can be
 * loaded in its place, or dropped in `web/dev/results/` to get a button: `?result=name` opens it.
 * `?look=x,y,distance[,azimuth,polar]` points the camera at a board point, for close captures.
 * `?select=path` selects the file of that path once the city loads; `?port=path` opens the port
 * of that island.
 * `?stats=off` hides the frame stats, and with them the drawing of every frame: the city then draws
 * only when something changes, as in the product.
 */
export function CityPage() {
  const showStats = useMemo(
    () => new URLSearchParams(window.location.search).get('stats') !== 'off',
    [],
  )
  const synthetic = useMemo(() => {
    const query = new URLSearchParams(window.location.search)
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
  }, [])
  const [loaded, setLoaded] = useState<CityLayout | null>(null)
  const [error, setError] = useState<string | null>(null)
  const input = useRef<HTMLInputElement>(null)
  const layout = loaded ?? synthetic
  const [mount, setMount] = useState(0)
  const [remounting, setRemounting] = useState(false)
  const [engine, setEngine] = useState<CityEngine | null>(null)
  const [cards, setCards] = useState<CityCards | null>(null)
  const [hover, setHover] = useState<CityHover | null>(null)
  const [selection, setSelection] = useState<CityItem | null>(null)
  const [port, setPort] = useState<PortList | null>(null)

  useEffect(() => {
    engine?.setListeners({ hover: setHover, select: setSelection, port: setPort })
  }, [engine])

  // Esc closes the port open, if any, or clears the selection, as on the city screen once no
  // panel is open. Only whether a port is open counts: its card moves with the camera.
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

  // W A S D move the camera along the ground and Q E turn it, while held, as on the city screen.
  useDriveKeys(engine)

  // After the city loads (the view's effect runs first), the camera goes where `?look` says.
  // biome-ignore lint/correctness/useExhaustiveDependencies: again after each city loads
  useEffect(() => {
    const look = new URLSearchParams(window.location.search).get('look')
    const [x, y, distance, azimuth, polar] = (look ?? '').split(',').map(Number)
    if (engine && x !== undefined && y !== undefined && distance) {
      engine.lookAt(x, y, distance, azimuth, polar)
    }
  }, [engine, layout])

  // Then the file or folder `?select` names is selected.
  useEffect(() => {
    const path = new URLSearchParams(window.location.search).get('select')
    if (!engine || !path) {
      return
    }
    const index = layout.islands
      .flatMap((island) => island.lots)
      .findIndex((lot) => lot.file.path === path)
    const island = layout.islands.findIndex((each) => each.path === path)
    const parcels = layout.islands.flatMap((each, at) =>
      each.parcels.map((parcel, parcelAt) => ({ island: at, parcel: parcelAt, path: parcel.path })),
    )
    const parcel = parcels.find((each) => each.path === path)
    if (index >= 0) {
      engine.select({ kind: 'building', index })
    } else if (island >= 0) {
      engine.select({ kind: 'island', island })
    } else if (parcel) {
      engine.select({ kind: 'parcel', island: parcel.island, parcel: parcel.parcel })
    }
  }, [engine, layout])

  // And the port of the island `?port` names is opened.
  useEffect(() => {
    const path = new URLSearchParams(window.location.search).get('port')
    const island = layout.islands.findIndex((each) => each.path === path)
    if (engine && island >= 0) {
      engine.openPortOf(island)
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

  // Two results opened in quick succession: only the last one shows.
  const latest = useRef(0)
  async function show(text: Promise<string>) {
    const request = ++latest.current
    try {
      const result = decodeResult(JSON.parse(await text))
      const city = cityFromResult(result)
      if (request !== latest.current) {
        return
      }
      setLoaded(city)
      setCards(cityCards(result))
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
    const input = event.target
    const file = input.files?.[0]
    if (file) {
      await show(file.text())
    }
    // The same file chosen again is a change too: to load it once more after an edit.
    input.value = ''
  }

  return (
    <main className={styles.page}>
      <CityView key={mount} layout={layout} showStats={showStats} onEngine={setEngine} />
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
        {selection && <p className={styles.selection}>{selection.path}</p>}
      </div>
      {port
        ? port.pointer && (
            <PortCard
              {...port}
              pointer={port.pointer}
              onFocusLink={(index) => engine?.focusPortLink(index)}
            />
          )
        : hover && cards && <HoverCard hover={hover} cards={cards} />}
    </main>
  )
}

/** The card of what the pointer rests on, read from the result. */
function HoverCard({ hover, cards }: { hover: CityHover; cards: CityCards }) {
  if (hover.bundle) {
    return <BundleTooltip path={hover.path} {...hover.bundle} pointer={hover.pointer} />
  }
  if (hover.port) {
    return <PortTooltip path={hover.path} links={hover.port.links} pointer={hover.pointer} />
  }
  if (hover.target.kind === 'building') {
    const card = cards.file(hover.path)
    return card ? <FileTooltip {...card} pointer={hover.pointer} /> : null
  }
  const card = cards.folder(hover.path)
  return card ? <AreaTooltip {...card} pointer={hover.pointer} /> : null
}
