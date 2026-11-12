import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CityEngine } from '../city/engine/city-engine'
import { cityCards } from '../city/interaction/city-cards'
import type { GuidePaths } from '../city/interaction/city-guide'
import type { CameraView, CityHover, GuideLabel } from '../city/interaction/city-items'
import type { PortList } from '../city/interaction/open-port'
import { cityFromResult } from '../city/world/from-result'
import type { AnalysisResult } from '../data/generated/AnalysisResult'
import { ToastProvider } from '../ui/feedback/ToastProvider'
import { useToast } from '../ui/feedback/use-toast'
import { AboutPanel } from './about/AboutPanel'
import { aboutData } from './about/about'
import styles from './CityScreen.module.css'
import { type CityRepo, CityTopBar } from './CityTopBar'
import { CityView } from './CityView'
import { CameraControls } from './camera/CameraControls'
import { MapScale } from './camera/MapScale'
import { useCameraActions } from './camera/use-camera-actions'
import { githubTreeUrl } from './github-links'
import { GuideLabels } from './guide/GuideLabels'
import { useDriveKeys } from './keys/use-drive-keys'
import { useEscapeKey } from './keys/use-escape-key'
import { AreaLabels } from './labels/AreaLabels'
import { AreaLabelLayer } from './labels/area-label-layer'
import { areaLabelTexts } from './labels/area-label-texts'
import { CityLegend } from './legend/CityLegend'
import { repoContents } from './legend/legend'
import { type LegendContent, legendContent } from './legend/legend-content'
import { indexResult } from './result-index'
import { SearchPalette, searchOptionId } from './search/SearchPalette'
import { buildSearchIndex } from './search/search-index'
import { useSearch } from './search/use-search'
import { hashOf, type ScreenSelection } from './selection/selection-hash'
import { useScreenSelection } from './selection/use-screen-selection'
import { useSelectionHash } from './selection/use-selection-hash'
import { FileSheet } from './sheets/file/FileSheet'
import { fileSheetData, symbolsByFile } from './sheets/file/file-sheet'
import { useFileCode } from './sheets/file/use-file-code'
import { FolderSheet } from './sheets/folder/FolderSheet'
import { folderSheetData } from './sheets/folder/folder-sheet'
import type { FileSheetData, FolderSheetData } from './sheets/sheet-data'
import { CityHoverCard } from './tooltips/CityHoverCard'
import { PortCard } from './tooltips/PortCard'
import type { Rect } from './tooltips/tooltip-placement'
import { useViewInset } from './use-view-inset'

const TEXT = {
  pathCopied: 'Path copied',
  linkCopied: 'Link copied',
  copyFailed: 'Couldn’t copy to the clipboard',
}

const ABOUT_ID = 'city-about'
/** Moving from sheet to sheet, the camera follows. */
const FLY = { fly: true }

type Sheet = { file: FileSheetData } | { folder: FolderSheetData }

/** A step of the guide's tour on show: what it puts forward, and its labels' notes by path. */
export interface ScreenGuide {
  paths: GuidePaths
  notes: ReadonlyMap<string, string>
}

interface CityScreenProps {
  result: AnalysisResult
  /** The step of the guide's tour the city shows, if any. */
  guide?: ScreenGuide | null
  /** Where the logo leads. */
  homeHref?: string
  /** Draw every frame and show the frame rate (development). */
  showStats?: boolean
  /** Called with the engine once it is mounted, and with null when it goes (development). */
  onEngine?: (engine: CityEngine | null) => void
}

/** The city of one analysis, full screen, with its interface over it. */
export function CityScreen(props: CityScreenProps) {
  return (
    <ToastProvider>
      <Screen {...props} />
    </ToastProvider>
  )
}

function Screen({
  result,
  guide = null,
  homeHref = '/',
  showStats = false,
  onEngine,
}: CityScreenProps) {
  const index = useMemo(() => indexResult(result), [result])
  const layout = useMemo(() => cityFromResult(result), [result])
  const cards = useMemo(() => cityCards(result), [result])
  const labelTexts = useMemo(() => areaLabelTexts(layout, result.repo.name), [layout, result])
  const symbols = useMemo(() => symbolsByFile(index), [index])
  const about = useMemo(() => aboutData(index), [index])
  const searchIndex = useMemo(() => buildSearchIndex(index), [index])
  const repo = useMemo<CityRepo>(
    () => ({
      owner: result.repo.owner,
      name: result.repo.name,
      commit: about.commit,
      githubUrl: githubTreeUrl(result.repo, result.sha),
    }),
    [result, about],
  )
  const toast = useToast()

  const [engine, setEngine] = useState<CityEngine | null>(null)
  const [hover, setHover] = useState<CityHover | null>(null)
  const [port, setPort] = useState<PortList | null>(null)
  const [view, setView] = useState<CameraView | null>(null)
  const [legend, setLegend] = useState<LegendContent | null>(null)
  const [legendExpanded, setLegendExpanded] = useState(false)
  const [aboutOpen, setAboutOpen] = useState(false)
  const [guideLabels, setGuideLabels] = useState<readonly GuideLabel[]>([])
  // The labels of islands and folders move with the city, in the frame it draws.
  const [labelLayer] = useState(() => new AreaLabelLayer())
  const { selection, sheetOpen, setSheetOpen, openLine, choose, selectFromCity, openAtLine } =
    useScreenSelection(engine, index)

  const handleEngine = useCallback(
    (next: CityEngine | null) => {
      setEngine(next)
      onEngine?.(next)
    },
    [onEngine],
  )

  useEffect(() => {
    engine?.setListeners({
      hover: setHover,
      port: setPort,
      view: setView,
      select: selectFromCity,
      guideLabels: setGuideLabels,
      areaLabels: labelLayer.update,
    })
  }, [engine, selectFromCity, labelLayer])

  useEffect(() => {
    engine?.showGuide(guide?.paths ?? null)
  }, [engine, guide])

  useEffect(() => {
    engine?.setAreaLabels(labelTexts)
  }, [engine, labelTexts])

  // The legend lists the ways the engine drew links: known once the city is loaded, which the
  // view's own effect does first (a new result is a new index).
  useEffect(() => {
    if (engine) {
      setLegend(legendContent(repoContents(index, engine.getLinkStats())))
    }
  }, [engine, index])

  useSelectionHash(engine, selection, choose)

  const selectedFile = selection?.kind === 'file' ? selection.path : null
  const { codeOf, loadCode, openCode } = useFileCode(result, index, selectedFile)

  const sheet = useMemo<Sheet | null>(() => {
    if (!selection) {
      return null
    }
    if (selection.kind === 'file') {
      const file = fileSheetData(index, symbols, selection.path, codeOf(selection.path))
      return file ? { file } : null
    }
    const folder = folderSheetData(index, selection.path)
    return folder ? { folder } : null
  }, [selection, codeOf, index, symbols])
  // A closed sheet keeps its content while it slides out.
  const lastSheet = useRef<Sheet | null>(null)
  if (sheet) {
    lastSheet.current = sheet
  }
  const shownSheet = sheet ?? lastSheet.current
  const sheetShown = sheetOpen && sheet !== null

  const screen = useRef<HTMLElement>(null)
  useViewInset(engine, screen, sheetShown)

  const portOpen = port !== null
  const closeAbout = useCallback(() => setAboutOpen(false), [])
  const closeSheet = useCallback(() => setSheetOpen(false), [setSheetOpen])
  const clearSelection = useCallback(() => choose(null), [choose])
  useEscapeKey(
    engine,
    { portOpen, aboutOpen, sheetShown, hasSelection: selection !== null },
    closeAbout,
    closeSheet,
    clearSelection,
  )

  const cameraAction = useCameraActions(engine)
  useDriveKeys(engine)

  // Flies to what was found and selects it.
  const search = useSearch(searchIndex, (hit) => {
    if (hit.kind === 'symbol') {
      choose({ kind: 'file', path: hit.file }, FLY)
      openAtLine(hit.file, hit.line)
    } else {
      choose({ kind: hit.kind === 'file' ? 'file' : 'dir', path: hit.path }, FLY)
    }
  })

  const copy = (text: string, title: string) => {
    navigator.clipboard.writeText(text).then(
      () => toast.show({ tone: 'success', title }),
      () => toast.show({ tone: 'error', title: TEXT.copyFailed }),
    )
  }
  const linkTo = (next: ScreenSelection) => {
    const { origin, pathname, search } = window.location
    return `${origin}${pathname}${search}${hashOf(next)}`
  }

  const showCycle = () => {
    const file = selectedFile === null ? undefined : index.fileAt(selectedFile)
    const members = result.cycles.members.find((each) => file !== undefined && each.includes(file))
    if (members) {
      engine?.frameFiles(members.map((member) => index.filePaths[member] ?? ''))
    }
  }

  // Cards keep out of the open sheet, wherever the CSS puts it: read at each render, which every
  // move of the pointer makes.
  const sheetBox = useRef<HTMLDivElement>(null)
  const box = sheetShown ? sheetBox.current?.getBoundingClientRect() : undefined
  const obstacles: Rect[] = box
    ? [{ x: box.left, y: box.top, width: box.width, height: box.height }]
    : []
  const besideSheet = (base: string | undefined) =>
    sheetShown ? `${base} ${styles.besideSheet}` : base

  return (
    <main ref={screen} className={styles.screen}>
      <CityView layout={layout} showStats={showStats} onEngine={handleEngine} />
      <AreaLabels layer={labelLayer} selected={selection?.kind === 'dir' ? selection.path : null} />
      {guide && <GuideLabels labels={guideLabels} notes={guide.notes} />}

      <div className={styles.topBar}>
        <CityTopBar
          repo={repo}
          homeHref={homeHref}
          aboutOpen={aboutOpen}
          onAboutToggle={() => setAboutOpen(!aboutOpen)}
          aboutPanelId={ABOUT_ID}
          searchValue={search.query}
          onSearchChange={search.changeQuery}
          searchExpanded={search.paletteShown && search.options.length > 0}
          searchListboxId={search.listboxId}
          searchActiveDescendant={searchOptionId(search.listboxId, search.active)}
          searchInputRef={search.inputRef}
          onSearchKeyDown={search.handleKey}
          onSearchClick={() => search.setFocused(true)}
          onSearchFocus={() => search.setFocused(true)}
          onSearchBlur={() => search.setFocused(false)}
          searchPalette={
            search.paletteShown && (
              <SearchPalette
                id={search.listboxId}
                query={search.shownQuery}
                results={search.results}
                active={search.active}
                suggestion={search.suggestion}
                onActiveChange={search.setActive}
                onChoose={search.chooseHit}
                onSuggest={(name) => {
                  search.changeQuery(name)
                  // The suggestion goes with the empty results: the field takes the focus back.
                  search.inputRef.current?.focus()
                }}
              />
            )
          }
        />
      </div>

      {legend && (
        <div className={styles.legend}>
          <CityLegend
            content={legend}
            expanded={legendExpanded}
            onExpandedChange={setLegendExpanded}
          />
        </div>
      )}

      {/* With a sheet open, the camera and the scale slide left of it. */}
      <div className={besideSheet(styles.camera)}>
        <CameraControls
          bearing={view?.bearing ?? 0}
          topView={view?.topView ?? false}
          onAction={cameraAction}
        />
      </div>
      {view && (
        <div className={besideSheet(styles.scale)}>
          <MapScale files={view.scaleFiles} />
        </div>
      )}

      {/* The sheet stays in the page so it can slide out. */}
      <div ref={sheetBox} className={styles.sheet}>
        {shownSheet && 'file' in shownSheet && (
          <FileSheet
            open={sheetShown}
            file={shownSheet.file}
            onClose={closeSheet}
            onOpenFolder={(path) => choose({ kind: 'dir', path }, FLY)}
            onSelectFile={(path) => choose({ kind: 'file', path }, FLY)}
            onShowCycle={showCycle}
            onCopyPath={() => copy(shownSheet.file.path, TEXT.pathCopied)}
            onCopyLink={() =>
              copy(linkTo({ kind: 'file', path: shownSheet.file.path }), TEXT.linkCopied)
            }
            onRetryCode={() => {
              if (selectedFile) {
                loadCode(selectedFile)
              }
            }}
            onOpenCode={openCode}
            openLine={openLine?.path === shownSheet.file.path ? openLine : undefined}
          />
        )}
        {shownSheet && 'folder' in shownSheet && (
          <FolderSheet
            open={sheetShown}
            folder={shownSheet.folder}
            onClose={closeSheet}
            onOpenFolder={(path) => choose({ kind: 'dir', path }, FLY)}
            onSelectFile={(path) => choose({ kind: 'file', path }, FLY)}
            onCopyLink={() =>
              copy(linkTo({ kind: 'dir', path: shownSheet.folder.path }), TEXT.linkCopied)
            }
          />
        )}
      </div>

      <div className={styles.about}>
        <AboutPanel
          id={ABOUT_ID}
          open={aboutOpen}
          about={about}
          onClose={() => setAboutOpen(false)}
        />
      </div>

      {port
        ? port.pointer && (
            <PortCard
              {...port}
              pointer={port.pointer}
              obstacles={obstacles}
              onFocusLink={(link) => engine?.focusPortLink(link)}
            />
          )
        : hover && <CityHoverCard hover={hover} cards={cards} obstacles={obstacles} />}
    </main>
  )
}
