import { type ReactNode, useEffect, useMemo, useState } from 'react'
import { syntheticCity } from '../../src/city/world/synthetic'
import { AboutPanel } from '../../src/screen/about/AboutPanel'
import { type BuildingMode, CityTopBar } from '../../src/screen/CityTopBar'
import { CityView } from '../../src/screen/CityView'
import { CameraControls } from '../../src/screen/camera/CameraControls'
import { MapScale } from '../../src/screen/camera/MapScale'
import { escapeTarget } from '../../src/screen/city-escape'
import { CityLegend } from '../../src/screen/legend/CityLegend'
import { Glass } from '../../src/screen/parts/Glass'
import { AreaTooltip } from '../../src/screen/tooltips/AreaTooltip'
import { CityMarker } from '../../src/screen/tooltips/CityMarker'
import { FileTooltip } from '../../src/screen/tooltips/FileTooltip'
import type { Point, Rect } from '../../src/screen/tooltips/tooltip-placement'
import styles from './CityUiPage.module.css'
import {
  ACCOUNT,
  FILE,
  FULL_LEGEND,
  ISLAND,
  LONG_FILE,
  PARCEL,
  REPO,
  SMALL_LEGEND,
} from './city-ui-samples'
import { SheetsBoard } from './SheetsBoard'
import { StageSheet } from './StageSheet'
import { StageTooltip } from './StageTooltip'
import { ABOUT } from './sheet-samples'
import { HOVER_LABELS, type Hover, SELECTION_LABELS, type Selection } from './stage-states'

const TEXT = {
  tools: 'States',
  samples:
    'Samples: the engine does not pick buildings or project roofs yet, so the card is always the same one and the markers stay put on the screen. Pick a selection to open its sheet; Esc closes it, a second Esc clears the selection.',
  signedIn: 'Signed in',
  aboutOpen: 'About open',
  shareOpen: 'Share open',
  selection: 'Selection (opens its sheet)',
  selected: (label: string, open: boolean) =>
    `Selected: ${label} · sheet ${open ? 'open' : 'closed'}`,
  newer: 'Newer version (About)',
  showMarkers: 'Markers',
  bearing: 'Camera bearing',
  hover: 'Tooltip under the pointer',
  boardTitle: 'City UI components',
  boardIntro:
    'Development page. Compare with the “DS · Components 9”, “City UI · City idle” and “City UI · Hover” boards. Press Tab to see the focus rings and the control tooltips.',
  topBar: 'Top bar',
  topBarIdle: 'Signed in, simplified',
  topBarTyping: 'Typing, signed out, realistic',
  topBarOpen: 'About and Share open',
  topBarFallback: 'Text fallback view: no building style',
  camera: 'Camera controls',
  cameraIdle: 'North up',
  cameraTop: 'Turned 30°, top view on',
  legend: 'Legend',
  legendCollapsed: 'Collapsed',
  legendFull: 'Expanded, everything a city can show',
  legendSmall: 'Expanded, a small JavaScript repository',
  scale: 'Scale',
  tooltips: 'Tooltips',
  tooltipFile: 'Building with a role',
  tooltipLong: 'Long path, no role',
  tooltipParcel: 'Parcel',
  tooltipIsland: 'Island',
  markers: 'Markers above roofs',
}

const ABOUT_ID = 'about-panel'

// A city of about the boards' size behind the interface.
const CITY = { islands: 6, files: 1_500 }

// Where the markers stand on the stage, as fractions of its size.
const STAGE_MARKERS: { at: Point; marker: ReactNode }[] = [
  { at: { x: 0.36, y: 0.42 }, marker: <CityMarker kind="route" step={1} end /> },
  { at: { x: 0.44, y: 0.5 }, marker: <CityMarker kind="route" step={2} end={false} /> },
  { at: { x: 0.52, y: 0.46 }, marker: <CityMarker kind="route" step={3} end /> },
  { at: { x: 0.62, y: 0.6 }, marker: <CityMarker kind="cycle" files={26} /> },
  { at: { x: 0.3, y: 0.66 }, marker: <CityMarker kind="impact" name="nls.ts" dependents={6213} /> },
  {
    at: { x: 0.58, y: 0.3 },
    marker: <CityMarker kind="guide" name="main.ts" note="entry point" />,
  },
]

export function CityUiPage() {
  const layout = useMemo(() => syntheticCity(CITY), [])
  const [signedIn, setSignedIn] = useState(true)
  const [mode, setMode] = useState<BuildingMode>('simplified')
  const [aboutOpen, setAboutOpen] = useState(false)
  const [shareOpen, setShareOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [legendExpanded, setLegendExpanded] = useState(false)
  const [topView, setTopView] = useState(false)
  const [bearing, setBearing] = useState(0)
  const [markers, setMarkers] = useState(false)
  const [selection, setSelection] = useState<Selection | null>(null)
  const [sheet, setSheet] = useState(false)
  const [newer, setNewer] = useState(false)
  const [hover, setHover] = useState<Hover>('file')
  const [pointer, setPointer] = useState<Point | null>(null)

  const select = (next: Selection | null) => {
    setSelection(next)
    setSheet(next !== null)
  }

  // Esc that no panel took: the open panel first, then the selection.
  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) {
        return
      }
      const target = escapeTarget({
        panelOpen: sheet || aboutOpen,
        hasSelection: selection !== null,
      })
      if (target === 'panel') {
        setSheet(false)
        setAboutOpen(false)
      } else if (target === 'selection') {
        setSelection(null)
      }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [sheet, aboutOpen, selection])

  // The sheet, as the CSS places it: 420 px on the right, under the top bar.
  const obstacles = useMemo<Rect[]>(
    () =>
      sheet
        ? [{ x: window.innerWidth - 432, y: 84, width: 420, height: window.innerHeight - 96 }]
        : [],
    [sheet],
  )

  return (
    <>
      <section
        className={styles.stage}
        // Over the city only, as the screen will do: never over the interface.
        onPointerMove={(event) =>
          setPointer(
            event.target instanceof HTMLCanvasElement
              ? { x: event.clientX, y: event.clientY }
              : null,
          )
        }
        onPointerLeave={() => setPointer(null)}
      >
        <CityView layout={layout} />

        {markers &&
          STAGE_MARKERS.map(({ at, marker }) => (
            <span
              key={`${at.x}-${at.y}`}
              className={styles.marker}
              style={{ left: `${at.x * 100}%`, top: `${at.y * 100}%` }}
            >
              {marker}
            </span>
          ))}

        <div className={styles.topBar}>
          <CityTopBar
            repo={REPO}
            homeHref="#"
            aboutOpen={aboutOpen}
            onAboutToggle={() => setAboutOpen(!aboutOpen)}
            aboutPanelId={ABOUT_ID}
            searchValue={search}
            onSearchChange={setSearch}
            mode={mode}
            onModeChange={setMode}
            shareOpen={shareOpen}
            onShareToggle={() => setShareOpen(!shareOpen)}
            account={signedIn ? ACCOUNT : null}
            onSignIn={() => setSignedIn(true)}
          />
        </div>
        <div className={styles.legend}>
          <CityLegend
            content={FULL_LEGEND}
            expanded={legendExpanded}
            onExpandedChange={setLegendExpanded}
          />
        </div>
        {/* With the file sheet open, the camera and the scale slide left of it. */}
        <div className={sheet ? `${styles.camera} ${styles.besideSheet}` : styles.camera}>
          <CameraControls
            bearing={bearing}
            topView={topView}
            onAction={(action) => {
              if (action === 'top-view') {
                setTopView(!topView)
              } else if (action === 'north') {
                setBearing(0)
              }
            }}
          />
        </div>
        {/* The sheet stays in the page so it can animate out. */}
        <div className={sheet ? `${styles.scale} ${styles.besideSheet}` : styles.scale}>
          <MapScale files={500} />
        </div>
        <div className={styles.sheet}>
          <StageSheet
            selection={selection}
            open={sheet}
            onClose={() => setSheet(false)}
            onSelectFile={() => select('file')}
            onOpenFolder={() => select('folder')}
          />
        </div>
        <div className={styles.about}>
          <AboutPanel
            id={ABOUT_ID}
            open={aboutOpen}
            about={ABOUT}
            newer={
              newer
                ? {
                    commits: 48,
                    signedIn,
                    quotaNote: 'Rebuilding uses 1 analysis · 7 left today.',
                    onRebuild: () => {},
                    onSignIn: () => setSignedIn(true),
                  }
                : undefined
            }
            onClose={() => setAboutOpen(false)}
          />
        </div>

        {/* Folds away, so it never hides the legend. */}
        <Glass className={styles.tools}>
          <details open className={styles.toolsBody}>
            <summary className="eyebrow-mono">{TEXT.tools}</summary>
            <p className={styles.note}>{TEXT.samples}</p>
            <Toggle label={TEXT.signedIn} checked={signedIn} onChange={setSignedIn} />
            <Toggle label={TEXT.aboutOpen} checked={aboutOpen} onChange={setAboutOpen} />
            <Toggle label={TEXT.shareOpen} checked={shareOpen} onChange={setShareOpen} />
            <Toggle label={TEXT.showMarkers} checked={markers} onChange={setMarkers} />
            <Toggle label={TEXT.newer} checked={newer} onChange={setNewer} />
            <label className={styles.field}>
              {TEXT.selection}
              <select
                value={selection ?? 'none'}
                onChange={(event) =>
                  select(event.target.value === 'none' ? null : (event.target.value as Selection))
                }
              >
                {Object.entries(SELECTION_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            {selection && (
              <p className={styles.note} role="status">
                {TEXT.selected(SELECTION_LABELS[selection], sheet)}
              </p>
            )}
            <label className={styles.field}>
              {TEXT.bearing}
              <input
                type="range"
                min={-180}
                max={180}
                value={bearing}
                onChange={(event) => setBearing(Number(event.target.value))}
              />
            </label>
            <label className={styles.field}>
              {TEXT.hover}
              <select value={hover} onChange={(event) => setHover(event.target.value as Hover)}>
                {Object.entries(HOVER_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
          </details>
        </Glass>

        {pointer && hover !== 'off' && (
          <StageTooltip hover={hover} pointer={pointer} obstacles={obstacles} />
        )}
      </section>

      <Board />
      <SheetsBoard />
    </>
  )
}

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string
  checked: boolean
  onChange: (checked: boolean) => void
}) {
  return (
    <label className={styles.toggle}>
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
      {label}
    </label>
  )
}

// A fixed tooltip, held in the frame: the frame's transform contains it.
const FRAMED_POINTER: Point = { x: -8, y: 16 }

// Every state side by side, over the sea.
function Board() {
  const noop = () => {}
  const bar = {
    repo: REPO,
    homeHref: '#',
    onAboutToggle: noop,
    onSearchChange: noop,
    onModeChange: noop,
    onShareToggle: noop,
    onSignIn: noop,
  }

  return (
    <main className={styles.board}>
      <header className={styles.boardHeader}>
        <h1 className="heading-1">{TEXT.boardTitle}</h1>
        <p className="body-m">{TEXT.boardIntro}</p>
      </header>

      <Sample title={TEXT.topBar}>
        <Case label={TEXT.topBarIdle} wide>
          <CityTopBar
            {...bar}
            aboutOpen={false}
            searchValue=""
            mode="simplified"
            shareOpen={false}
            account={ACCOUNT}
          />
        </Case>
        <Case label={TEXT.topBarTyping} wide>
          <CityTopBar
            {...bar}
            aboutOpen={false}
            searchValue="textMo"
            mode="realistic"
            shareOpen={false}
            account={null}
          />
        </Case>
        <Case label={TEXT.topBarOpen} wide>
          <CityTopBar
            {...bar}
            aboutOpen
            searchValue=""
            mode="simplified"
            shareOpen
            account={ACCOUNT}
          />
        </Case>
        <Case label={TEXT.topBarFallback} wide>
          <CityTopBar
            {...bar}
            aboutOpen={false}
            searchValue=""
            mode="simplified"
            showMode={false}
            shareOpen={false}
            account={ACCOUNT}
          />
        </Case>
      </Sample>

      <Sample title={TEXT.camera}>
        <Case label={TEXT.cameraIdle}>
          <CameraControls bearing={0} topView={false} onAction={noop} />
        </Case>
        <Case label={TEXT.cameraTop}>
          <CameraControls bearing={30} topView onAction={noop} />
        </Case>
      </Sample>

      <Sample title={TEXT.legend}>
        <Case label={TEXT.legendCollapsed}>
          <CityLegend content={FULL_LEGEND} expanded={false} onExpandedChange={noop} />
        </Case>
        <Case label={TEXT.legendFull}>
          <CityLegend content={FULL_LEGEND} expanded onExpandedChange={noop} />
        </Case>
        <Case label={TEXT.legendSmall}>
          <CityLegend content={SMALL_LEGEND} expanded onExpandedChange={noop} />
        </Case>
      </Sample>

      <Sample title={TEXT.scale}>
        <Case label="500">
          <MapScale files={500} />
        </Case>
        <Case label="12,000">
          <MapScale files={12_000} />
        </Case>
      </Sample>

      <Sample title={TEXT.tooltips}>
        <Case label={TEXT.tooltipFile} framed>
          <FileTooltip {...FILE} pointer={FRAMED_POINTER} />
        </Case>
        <Case label={TEXT.tooltipLong} framed>
          <FileTooltip {...LONG_FILE} pointer={FRAMED_POINTER} />
        </Case>
        <Case label={TEXT.tooltipParcel} framed>
          <AreaTooltip {...PARCEL} pointer={FRAMED_POINTER} />
        </Case>
        <Case label={TEXT.tooltipIsland} framed>
          <AreaTooltip {...ISLAND} pointer={FRAMED_POINTER} />
        </Case>
      </Sample>

      <Sample title={TEXT.markers}>
        <Case label="Route">
          <span className={styles.row}>
            <CityMarker kind="route" step={1} end />
            <CityMarker kind="route" step={2} end={false} />
            <CityMarker kind="route" step={3} end={false} />
            <CityMarker kind="route" step={4} end />
          </span>
        </Case>
        <Case label="Cycle">
          <CityMarker kind="cycle" files={26} />
        </Case>
        <Case label="Impact">
          <CityMarker kind="impact" name="nls.ts" dependents={6213} />
        </Case>
        <Case label="Guide">
          <CityMarker kind="guide" name="main.ts" note="entry point" />
        </Case>
      </Sample>
    </main>
  )
}

function Sample({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className={styles.sample}>
      <h2 className="heading-2">{title}</h2>
      <div className={styles.cases}>{children}</div>
    </section>
  )
}

function Case({
  label,
  wide = false,
  framed = false,
  children,
}: {
  label: string
  wide?: boolean
  framed?: boolean
  children: ReactNode
}) {
  const classes = [styles.case, wide && styles.wide].filter(Boolean).join(' ')
  return (
    <figure className={classes}>
      <figcaption className="eyebrow-mono">{label}</figcaption>
      <div className={framed ? `${styles.sea} ${styles.frame}` : styles.sea}>{children}</div>
    </figure>
  )
}
