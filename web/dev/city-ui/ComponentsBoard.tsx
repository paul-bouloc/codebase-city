import { CityTopBar } from '../../src/screen/CityTopBar'
import { CameraControls } from '../../src/screen/camera/CameraControls'
import { MapScale } from '../../src/screen/camera/MapScale'
import { CityLegend } from '../../src/screen/legend/CityLegend'
import { AreaTooltip } from '../../src/screen/tooltips/AreaTooltip'
import { CityMarker } from '../../src/screen/tooltips/CityMarker'
import { FileTooltip } from '../../src/screen/tooltips/FileTooltip'
import type { Point } from '../../src/screen/tooltips/tooltip-placement'
import { BoardCase } from './BoardCase'
import { BoardSample } from './BoardSample'
import styles from './ComponentsBoard.module.css'
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

const TEXT = {
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

// A fixed tooltip, held in the frame: the frame's transform contains it.
const FRAMED_POINTER: Point = { x: -8, y: 16 }

// Every state side by side, over the sea.
export function ComponentsBoard() {
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

      <BoardSample title={TEXT.topBar}>
        <BoardCase label={TEXT.topBarIdle} wide>
          <CityTopBar
            {...bar}
            aboutOpen={false}
            searchValue=""
            mode="simplified"
            shareOpen={false}
            account={ACCOUNT}
          />
        </BoardCase>
        <BoardCase label={TEXT.topBarTyping} wide>
          <CityTopBar
            {...bar}
            aboutOpen={false}
            searchValue="textMo"
            mode="realistic"
            shareOpen={false}
            account={null}
          />
        </BoardCase>
        <BoardCase label={TEXT.topBarOpen} wide>
          <CityTopBar
            {...bar}
            aboutOpen
            searchValue=""
            mode="simplified"
            shareOpen
            account={ACCOUNT}
          />
        </BoardCase>
        <BoardCase label={TEXT.topBarFallback} wide>
          <CityTopBar
            {...bar}
            aboutOpen={false}
            searchValue=""
            mode="simplified"
            showMode={false}
            shareOpen={false}
            account={ACCOUNT}
          />
        </BoardCase>
      </BoardSample>

      <BoardSample title={TEXT.camera}>
        <BoardCase label={TEXT.cameraIdle}>
          <CameraControls bearing={0} topView={false} onAction={noop} />
        </BoardCase>
        <BoardCase label={TEXT.cameraTop}>
          <CameraControls bearing={30} topView onAction={noop} />
        </BoardCase>
      </BoardSample>

      <BoardSample title={TEXT.legend}>
        <BoardCase label={TEXT.legendCollapsed}>
          <CityLegend content={FULL_LEGEND} expanded={false} onExpandedChange={noop} />
        </BoardCase>
        <BoardCase label={TEXT.legendFull}>
          <CityLegend content={FULL_LEGEND} expanded onExpandedChange={noop} />
        </BoardCase>
        <BoardCase label={TEXT.legendSmall}>
          <CityLegend content={SMALL_LEGEND} expanded onExpandedChange={noop} />
        </BoardCase>
      </BoardSample>

      <BoardSample title={TEXT.scale}>
        <BoardCase label="500">
          <MapScale files={500} />
        </BoardCase>
        <BoardCase label="12,000">
          <MapScale files={12_000} />
        </BoardCase>
      </BoardSample>

      <BoardSample title={TEXT.tooltips}>
        <BoardCase label={TEXT.tooltipFile} framed>
          <FileTooltip {...FILE} pointer={FRAMED_POINTER} />
        </BoardCase>
        <BoardCase label={TEXT.tooltipLong} framed>
          <FileTooltip {...LONG_FILE} pointer={FRAMED_POINTER} />
        </BoardCase>
        <BoardCase label={TEXT.tooltipParcel} framed>
          <AreaTooltip {...PARCEL} pointer={FRAMED_POINTER} />
        </BoardCase>
        <BoardCase label={TEXT.tooltipIsland} framed>
          <AreaTooltip {...ISLAND} pointer={FRAMED_POINTER} />
        </BoardCase>
      </BoardSample>

      <BoardSample title={TEXT.markers}>
        <BoardCase label="Route">
          <span className={styles.row}>
            <CityMarker kind="route" step={1} end />
            <CityMarker kind="route" step={2} end={false} />
            <CityMarker kind="route" step={3} end={false} />
            <CityMarker kind="route" step={4} end />
          </span>
        </BoardCase>
        <BoardCase label="Cycle">
          <CityMarker kind="cycle" files={26} />
        </BoardCase>
        <BoardCase label="Impact">
          <CityMarker kind="impact" name="nls.ts" dependents={6213} />
        </BoardCase>
        <BoardCase label="Guide">
          <CityMarker kind="guide" name="main.ts" note="entry point" />
        </BoardCase>
      </BoardSample>
    </main>
  )
}
