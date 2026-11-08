import {
  type KeyboardEvent as ReactKeyboardEvent,
  useCallback,
  useDeferredValue,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react'
import type { CityEngine } from '../city/engine/city-engine'
import { cityCards } from '../city/interaction/city-cards'
import type {
  CameraView,
  CityHover,
  CityItem,
  PortList,
} from '../city/interaction/city-interaction'
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
import { escapeTarget } from './city-escape'
import { githubTreeUrl } from './github-links'
import { CityLegend } from './legend/CityLegend'
import { repoContents } from './legend/legend'
import { type LegendContent, legendContent } from './legend/legend-content'
import { indexResult } from './result-index'
import { isSearchKey } from './screen-keys'
import { SearchPalette, searchOptionId } from './search/SearchPalette'
import { type SearchHit, searchOptions } from './search/search-data'
import { buildSearchIndex, normalizeQuery } from './search/search-index'
import { searchKeyAction } from './search/search-keys'
import { hashOf, type ScreenSelection } from './selection-hash'
import { FileSheet } from './sheets/file/FileSheet'
import { fileSheetData, symbolsByFile } from './sheets/file/file-sheet'
import { useFileCode } from './sheets/file/use-file-code'
import { FolderSheet } from './sheets/folder/FolderSheet'
import { folderSheetData } from './sheets/folder/folder-sheet'
import type { FileSheetData, FolderSheetData } from './sheets/sheet-data'
import { CityHoverCard } from './tooltips/CityHoverCard'
import { PortCard } from './tooltips/PortCard'
import type { Rect } from './tooltips/tooltip-placement'
import { useDriveKeys } from './use-drive-keys'
import { useSelectionHash } from './use-selection-hash'

const TEXT = {
  pathCopied: 'Path copied',
  linkCopied: 'Link copied',
  copyFailed: 'Couldn’t copy to the clipboard',
}

const ABOUT_ID = 'city-about'
/** Moving from sheet to sheet, the camera follows. */
const FLY = { fly: true }
/** Room kept clear left of the open sheet, in px: as the camera controls keep (444 px). */
const SHEET_GAP = 12

type Sheet = { file: FileSheetData } | { folder: FolderSheetData }

interface CityScreenProps {
  result: AnalysisResult
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

function Screen({ result, homeHref = '/', showStats = false, onEngine }: CityScreenProps) {
  const index = useMemo(() => indexResult(result), [result])
  const layout = useMemo(() => cityFromResult(result), [result])
  const cards = useMemo(() => cityCards(result), [result])
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
  const [selection, setSelection] = useState<ScreenSelection | null>(null)
  const [sheetOpen, setSheetOpen] = useState(false)
  // A symbol found by the search: its file's sheet opens its code at its line.
  const [openLine, setOpenLine] = useState<{ path: string; line: number; request: number } | null>(
    null,
  )

  const handleEngine = useCallback(
    (next: CityEngine | null) => {
      setEngine(next)
      onEngine?.(next)
    },
    [onEngine],
  )

  // Set while the screen moves the engine's selection: it does not hear its own move back.
  const driving = useRef(false)

  useEffect(() => {
    engine?.setListeners({
      hover: setHover,
      port: setPort,
      view: setView,
      // A click in the city selects and opens the sheet; a click on the sea clears both.
      select: (item: CityItem | null) => {
        if (driving.current) {
          return
        }
        setSelection(
          item ? { kind: item.target.kind === 'building' ? 'file' : 'dir', path: item.path } : null,
        )
        setSheetOpen(item !== null)
        setOpenLine(null)
      },
    })
  }, [engine])

  // The legend lists the ways the engine drew links: known once the city is loaded, which the
  // view's own effect does first (a new result is a new index).
  useEffect(() => {
    if (engine) {
      setLegend(legendContent(repoContents(index, engine.getLinkStats())))
    }
  }, [engine, index])

  /**
   * Selects a file or a folder from the interface: its sheet opens, the city follows. With `fly`,
   * the camera flies to it too.
   */
  const choose = useCallback(
    (next: ScreenSelection | null, { fly = false }: { fly?: boolean } = {}) => {
      // A path the result does not hold selects nothing.
      const known =
        next &&
        (next.kind === 'file' ? index.fileAt(next.path) : index.folderAt(next.path)) !== undefined
          ? next
          : null
      setSelection(known)
      setSheetOpen(known !== null)
      setOpenLine(null)
      if (!engine) {
        return
      }
      driving.current = true
      try {
        // A folder that holds islands has no place of its own in the city.
        const shown = known && (fly ? engine.flyTo(known.path) : engine.selectPath(known.path))
        if (!shown) {
          engine.clearSelection()
        }
      } finally {
        driving.current = false
      }
    },
    [engine, index],
  )

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

  // The open sheet covers the right of the city: flights frame left of it, and a selection it
  // hides slides clear. It covers its travel and the margin left of it.
  const screen = useRef<HTMLElement>(null)
  useEffect(() => {
    const element = screen.current
    if (!engine || !element) {
      return
    }
    const travel = Number.parseFloat(getComputedStyle(element).getPropertyValue('--sheet-travel'))
    engine.setViewInset(sheetShown && Number.isFinite(travel) ? travel + SHEET_GAP : 0)
  }, [engine, sheetShown])

  const portOpen = port !== null
  // Esc that no panel took: the open panel first, then the selection.
  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) {
        return
      }
      const target = escapeTarget({
        panelOpen: portOpen || aboutOpen || sheetShown,
        hasSelection: selection !== null,
      })
      if (target === 'panel') {
        if (portOpen) {
          engine?.closePort()
        } else if (aboutOpen) {
          setAboutOpen(false)
        } else {
          setSheetOpen(false)
        }
      } else if (target === 'selection') {
        choose(null)
      }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [engine, portOpen, aboutOpen, sheetShown, selection, choose])

  const cameraAction = useCameraActions(engine)
  useDriveKeys(engine)

  // The search: the palette shows under the field while it has the focus and a query.
  const searchListboxId = useId()
  const searchInput = useRef<HTMLInputElement>(null)
  const [query, setQuery] = useState('')
  const [searchFocused, setSearchFocused] = useState(false)
  const [activeOption, setActiveOption] = useState(0)
  // The field shows each key at once; the results follow, and give way to the next key.
  const shownQuery = useDeferredValue(query)
  const searchResults = useMemo(() => searchIndex.search(shownQuery), [searchIndex, shownQuery])
  const options = useMemo(() => searchOptions(searchResults), [searchResults])
  // Shown once the results are a query's, not the empty field's: no flash of "Nothing matches".
  const paletteShown =
    searchFocused && normalizeQuery(query) !== '' && normalizeQuery(shownQuery) !== ''
  // The option the arrows reached, within the results on show (fewer, after a new query).
  const active = options.length === 0 ? 0 : Math.min(activeOption, options.length - 1)
  const suggestion = useMemo(
    () => (paletteShown && options.length === 0 ? searchIndex.suggest(shownQuery) : null),
    [paletteShown, options, searchIndex, shownQuery],
  )
  const openLineRequest = useRef(0)

  const changeQuery = (value: string) => {
    setQuery(value)
    setActiveOption(0)
    setSearchFocused(true)
  }

  // Flies to what was found and selects it; the field lets go, so the city's keys work again.
  const chooseHit = (hit: SearchHit) => {
    searchInput.current?.blur()
    setSearchFocused(false)
    if (hit.kind === 'symbol') {
      choose({ kind: 'file', path: hit.file }, FLY)
      openLineRequest.current++
      setOpenLine({ path: hit.file, line: hit.line, request: openLineRequest.current })
    } else {
      choose({ kind: hit.kind === 'file' ? 'file' : 'dir', path: hit.path }, FLY)
    }
  }

  // Keys in the field or in its results (the suggestion): Enter and Space on a button are its own.
  const handleSearchKey = (event: ReactKeyboardEvent) => {
    const onButton = event.target !== searchInput.current
    // A button is no field: without this, the city's keys (arrows, Esc) would act behind it.
    if (onButton) {
      event.stopPropagation()
    }
    if (
      event.nativeEvent.isComposing ||
      (onButton && (event.key === 'Enter' || event.key === ' '))
    ) {
      return
    }
    const action = searchKeyAction(event.key, {
      open: paletteShown,
      count: options.length,
      active,
      query,
    })
    if (!action) {
      return
    }
    // Esc taken here is not the screen's: it closes no sheet.
    event.preventDefault()
    switch (action.type) {
      case 'move':
        setActiveOption(action.index)
        break
      case 'open':
        setSearchFocused(true)
        break
      case 'choose': {
        // The results on show may still be an older query's: Enter takes the query in the field.
        const hit =
          shownQuery === query ? options[active] : searchOptions(searchIndex.search(query))[0]
        if (hit) {
          chooseHit(hit)
        }
        break
      }
      case 'close':
        setSearchFocused(false)
        // From the suggestion, which goes with the results: back to the field.
        searchInput.current?.focus()
        break
      case 'clear':
        changeQuery('')
        setSearchFocused(false)
        break
      case 'leave':
        searchInput.current?.blur()
        break
    }
  }

  // / and ⌘K (Ctrl+K) go to the search field, its query selected to be typed over.
  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || !isSearchKey(event)) {
        return
      }
      const input = searchInput.current
      if (!input || input.disabled) {
        return
      }
      event.preventDefault()
      input.focus()
      input.select()
      setSearchFocused(true)
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [])

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

      <div className={styles.topBar}>
        <CityTopBar
          repo={repo}
          homeHref={homeHref}
          aboutOpen={aboutOpen}
          onAboutToggle={() => setAboutOpen(!aboutOpen)}
          aboutPanelId={ABOUT_ID}
          searchValue={query}
          onSearchChange={changeQuery}
          searchExpanded={paletteShown && options.length > 0}
          searchListboxId={searchListboxId}
          searchActiveDescendant={searchOptionId(searchListboxId, active)}
          searchInputRef={searchInput}
          onSearchKeyDown={handleSearchKey}
          onSearchClick={() => setSearchFocused(true)}
          onSearchFocus={() => setSearchFocused(true)}
          onSearchBlur={() => setSearchFocused(false)}
          searchPalette={
            paletteShown && (
              <SearchPalette
                id={searchListboxId}
                query={normalizeQuery(shownQuery)}
                results={searchResults}
                active={active}
                suggestion={suggestion}
                onActiveChange={setActiveOption}
                onChoose={chooseHit}
                onSuggest={(name) => {
                  changeQuery(name)
                  // The suggestion goes with the empty results: the field takes the focus back.
                  searchInput.current?.focus()
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
            onClose={() => setSheetOpen(false)}
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
            onClose={() => setSheetOpen(false)}
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
