import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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
import { cameraKey, isTyping } from './screen-keys'
import { hashOf, type ScreenSelection, selectionOfHash } from './selection-hash'
import { useDriveKeys } from './use-drive-keys'

const TEXT = {
  pathCopied: 'Path copied',
  linkCopied: 'Link copied',
  copyFailed: 'Couldn’t copy to the clipboard',
}

const ABOUT_ID = 'city-about'
const LOADING_CODE: CodeState = { status: 'loading' }

/** Where the sheet stands, as the CSS places it: 420 px on the right, under the top bar. */
function sheetRect(): Rect {
  return { x: window.innerWidth - 432, y: 84, width: 420, height: window.innerHeight - 96 }
}

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

/** The city of one analysis, full screen, with its interface over it (interface-ville.md). */
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
  const [code, setCode] = useState<{ path: string; state: CodeState } | null>(null)

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

  /** Selects a file or a folder from the interface: its sheet opens, the city follows. */
  const choose = useCallback(
    (next: ScreenSelection | null) => {
      // A path the result does not hold selects nothing.
      const known =
        next &&
        (next.kind === 'file' ? index.fileAt(next.path) : index.folderAt(next.path)) !== undefined
          ? next
          : null
      setSelection(known)
      setSheetOpen(known !== null)
      if (!engine) {
        return
      }
      driving.current = true
      try {
        // A folder that holds islands has no place of its own in the city.
        if (!known || !engine.selectPath(known.path)) {
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
    const hash = hashOf(selection)
    if (hash !== window.location.hash) {
      const { pathname, search } = window.location
      window.history.pushState(null, '', hash || `${pathname}${search}`)
    }
  }, [selection])

  // The selected file's code, read from GitHub once its tab shows, never twice for one file.
  const codeRequest = useRef<AbortController | null>(null)
  const loadCode = useCallback(
    (path: string) => {
      codeRequest.current?.abort()
      const controller = new AbortController()
      codeRequest.current = controller
      setCode({ path, state: LOADING_CODE })
      const file = index.fileAt(path)
      const lines = file === undefined ? 0 : (result.files.lines[file] ?? 0)
      fetchCode(result.repo, result.sha, path, lines, controller.signal).then(
        (state) => {
          if (!controller.signal.aborted) {
            setCode({ path, state })
          }
        },
        () => {},
      )
    },
    [index, result],
  )
  useEffect(() => () => codeRequest.current?.abort(), [])
  const selectedFile = selection?.kind === 'file' ? selection.path : null
  const codePath = code?.path
  const openCode = useCallback(() => {
    if (selectedFile && codePath !== selectedFile) {
      loadCode(selectedFile)
    }
  }, [selectedFile, codePath, loadCode])

  const sheet = useMemo<Sheet | null>(() => {
    if (!selection) {
      return null
    }
    if (selection.kind === 'file') {
      const state = code?.path === selection.path ? code.state : LOADING_CODE
      const file = fileSheetData(index, symbols, selection.path, state)
      return file ? { file } : null
    }
    const folder = folderSheetData(index, selection.path)
    return folder ? { folder } : null
  }, [selection, code, index, symbols])
  // A closed sheet keeps its content while it slides out.
  const lastSheet = useRef<Sheet | null>(null)
  if (sheet) {
    lastSheet.current = sheet
  }
  const shownSheet = sheet ?? lastSheet.current
  const sheetShown = sheetOpen && sheet !== null

  const portOpen = port !== null
  // Esc that no panel took: the open panel first, then the selection (A2).
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

  const obstacles = useMemo(() => (sheetShown ? [sheetRect()] : []), [sheetShown])
  const besideSheet = (base: string | undefined) =>
    sheetShown ? `${base} ${styles.besideSheet}` : base

  return (
    <main className={styles.screen}>
      <CityView layout={layout} showStats={showStats} onEngine={handleEngine} />

      <div className={styles.topBar}>
        <CityTopBar
          repo={repo}
          homeHref={homeHref}
          aboutOpen={aboutOpen}
          onAboutToggle={() => setAboutOpen(!aboutOpen)}
          aboutPanelId={ABOUT_ID}
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
      <div className={styles.sheet}>
        {shownSheet && 'file' in shownSheet && (
          <FileSheet
            open={sheetShown}
            file={shownSheet.file}
            onClose={() => setSheetOpen(false)}
            onOpenFolder={(path) => choose({ kind: 'dir', path })}
            onSelectFile={(path) => choose({ kind: 'file', path })}
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
          />
        )}
        {shownSheet && 'folder' in shownSheet && (
          <FolderSheet
            open={sheetShown}
            folder={shownSheet.folder}
            onClose={() => setSheetOpen(false)}
            onOpenFolder={(path) => choose({ kind: 'dir', path })}
            onSelectFile={(path) => choose({ kind: 'file', path })}
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
