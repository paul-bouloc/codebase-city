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
import { cityCards } from '../city/city-cards'
import type { CityEngine } from '../city/city-engine'
import type { CameraView, CityHover, CityItem, PortList } from '../city/city-interaction'
import { cityFromResult } from '../city/from-result'
import type { AnalysisResult } from '../data/generated/AnalysisResult'
import { AboutPanel } from '../ui/city/AboutPanel'
import { type CameraAction, CameraControls } from '../ui/city/CameraControls'
import { CityLegend } from '../ui/city/CityLegend'
import { type CityRepo, CityTopBar } from '../ui/city/CityTopBar'
import { escapeTarget } from '../ui/city/city-escape'
import { FileSheet } from '../ui/city/FileSheet'
import { FolderSheet } from '../ui/city/FolderSheet'
import { githubTreeUrl } from '../ui/city/github-links'
import { type LegendContent, legendContent } from '../ui/city/legend-content'
import { MapScale } from '../ui/city/MapScale'
import { PortCard } from '../ui/city/PortCard'
import { SearchPalette, searchOptionId } from '../ui/city/SearchPalette'
import { type SearchHit, searchOptions } from '../ui/city/search-data'
import { searchKeyAction } from '../ui/city/search-keys'
import type { CodeState, FileSheetData, FolderSheetData } from '../ui/city/sheet-data'
import type { Rect } from '../ui/city/tooltip-placement'
import { ToastProvider } from '../ui/ToastProvider'
import { useToast } from '../ui/use-toast'
import { aboutData } from './about'
import { CityHoverCard } from './CityHoverCard'
import styles from './CityScreen.module.css'
import { CityView } from './CityView'
import { fileSheetData, symbolsByFile } from './file-sheet'
import { folderSheetData } from './folder-sheet'
import { fetchCode } from './github-code'
import { repoContents } from './legend'
import { indexResult } from './result-index'
import { cameraKey, isSearchKey, isTyping } from './screen-keys'
import { buildSearchIndex, normalizeQuery } from './search-index'
import { hashOf, type ScreenSelection, selectionOfHash } from './selection-hash'
import { useDriveKeys } from './use-drive-keys'

const TEXT = {
  pathCopied: 'Path copied',
  linkCopied: 'Link copied',
  copyFailed: 'Couldn’t copy to the clipboard',
}

const ABOUT_ID = 'city-about'
const LOADING_CODE: CodeState = { status: 'loading' }
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
  // The code of one file at one commit: another result, even of the same repository, reads it again.
  const [code, setCode] = useState<{ sha: string; path: string; state: CodeState } | null>(null)
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

  // The fragment names the selection: read once the city is there (again for a new result, which
  // makes a new `choose`), and on Back or Forward.
  const hashRead = useRef(false)
  useEffect(() => {
    if (!engine) {
      return
    }
    const apply = () => choose(selectionOfHash(window.location.hash))
    apply()
    hashRead.current = true
    window.addEventListener('popstate', apply)
    window.addEventListener('hashchange', apply)
    return () => {
      window.removeEventListener('popstate', apply)
      window.removeEventListener('hashchange', apply)
    }
  }, [engine, choose])

  // Each selection made in the city or the interface gets its own entry in the history.
  useEffect(() => {
    if (!hashRead.current) {
      return
    }
    // The same selection spelt another way (`@` left unescaped) is no new entry.
    const current = selectionOfHash(window.location.hash)
    if (current?.kind !== selection?.kind || current?.path !== selection?.path) {
      const { pathname, search } = window.location
      window.history.pushState(null, '', hashOf(selection) || `${pathname}${search}`)
    }
  }, [selection])

  // The selected file's code, read from GitHub once its tab shows, never twice for one file.
  const codeRequest = useRef<AbortController | null>(null)
  const loadCode = useCallback(
    (path: string) => {
      codeRequest.current?.abort()
      const controller = new AbortController()
      codeRequest.current = controller
      const { sha } = result
      setCode({ sha, path, state: LOADING_CODE })
      const file = index.fileAt(path)
      const lines = file === undefined ? 0 : (result.files.lines[file] ?? 0)
      fetchCode(result.repo, sha, path, lines, controller.signal).then(
        (state) => {
          if (!controller.signal.aborted) {
            setCode({ sha, path, state })
          }
        },
        () => {},
      )
    },
    [index, result],
  )
  useEffect(() => () => codeRequest.current?.abort(), [])
  const selectedFile = selection?.kind === 'file' ? selection.path : null
  const codeFor = code ? `${code.sha}:${code.path}` : null
  const openCode = useCallback(() => {
    if (selectedFile && codeFor !== `${result.sha}:${selectedFile}`) {
      loadCode(selectedFile)
    }
  }, [selectedFile, codeFor, result.sha, loadCode])

  const sheet = useMemo<Sheet | null>(() => {
    if (!selection) {
      return null
    }
    if (selection.kind === 'file') {
      const state =
        code?.path === selection.path && code.sha === result.sha ? code.state : LOADING_CODE
      const file = fileSheetData(index, symbols, selection.path, state)
      return file ? { file } : null
    }
    const folder = folderSheetData(index, selection.path)
    return folder ? { folder } : null
  }, [selection, code, index, symbols, result.sha])
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

  const cameraAction = useCallback(
    (action: CameraAction) => {
      switch (action) {
        case 'north':
          engine?.faceNorth()
          break
        case 'zoom-in':
          engine?.zoom(1)
          break
        case 'zoom-out':
          engine?.zoom(-1)
          break
        case 'recenter':
          engine?.recenter()
          break
        case 'top-view':
          engine?.toggleTopView()
          break
      }
    },
    [engine],
  )

  // + − F T, as the camera buttons' hints say.
  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      const action = cameraKey(event)
      if (!action || event.defaultPrevented || isTyping(event.target)) {
        return
      }
      event.preventDefault()
      cameraAction(action)
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [cameraAction])

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
