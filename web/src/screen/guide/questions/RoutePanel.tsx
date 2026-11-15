import { forwardRef, type RefObject } from 'react'
import { ANALYZED_LANGUAGES } from '../../../city/world/from-result'
import { Button } from '../../../ui/actions/Button'
import { Icon } from '../../../ui/brand/Icon'
import type { FileHit } from '../../search/search-data'
import type { SearchIndex } from '../../search/search-index'
import { FileField } from './FileField'
import { QuestionPanel } from './QuestionPanel'
import styles from './RoutePanel.module.css'
import type { Route } from './route'
import { noRouteText, routeLabel, routeSummary } from './route-text'

export const ROUTE_QUESTION = {
  title: 'How does A reach B?',
  subtitle: 'The import path between two files',
}

const TEXT = {
  from: 'From (A)',
  to: 'To (B)',
  swap: 'Swap A and B',
  next: 'Next shortest path',
  clear: 'Clear',
  imports: 'imports',
  choose: 'Choose two files to see how the first reaches the second by its imports.',
  noPath: 'No path: ',
  doesNotDepend: ' doesn’t depend on ',
}

/** Only an analyzed file's imports are known: the fields offer no other. */
const analyzed = (hit: FileHit) => ANALYZED_LANGUAGES.has(hit.languageName)

const nameOf = (path: string) => path.slice(path.lastIndexOf('/') + 1)

interface RoutePanelProps {
  /** The files the route goes from and to, by path; none while their field is empty. */
  from: string | null
  to: string | null
  /** The route between them, once both are chosen. */
  route: Route | null
  /** Every file's path, by file. */
  filePaths: readonly string[]
  searchIndex: SearchIndex
  /** The field the route goes to: the focus goes there when the route starts from a file. */
  toRef: RefObject<HTMLInputElement | null>
  onChange: (from: string | null, to: string | null) => void
  onNextPath: () => void
  /** A stop of the path chosen: its file opens. */
  onStop: (path: string) => void
  onBack: () => void
  onClear: () => void
  onCollapse: () => void
}

/** The answer to "How does A reach B?": the shortest path of imports, step by step. */
export const RoutePanel = forwardRef<HTMLHeadingElement, RoutePanelProps>(function RoutePanel(
  {
    from,
    to,
    route,
    filePaths,
    searchIndex,
    toRef,
    onChange,
    onNextPath,
    onStop,
    onBack,
    onClear,
    onCollapse,
  },
  titleRef,
) {
  const swap = () => onChange(to, from)
  return (
    <QuestionPanel
      ref={titleRef}
      title={ROUTE_QUESTION.title}
      subtitle={ROUTE_QUESTION.subtitle}
      onBack={onBack}
      onCollapse={onCollapse}
    >
      <div className={styles.fields}>
        <div className={styles.fieldStack}>
          <FileField
            label={TEXT.from}
            value={from}
            searchIndex={searchIndex}
            offers={analyzed}
            onChoose={(path) => onChange(path, to)}
          />
          <FileField
            label={TEXT.to}
            value={to}
            searchIndex={searchIndex}
            // A file is never its own way.
            offers={(hit) => analyzed(hit) && hit.path !== from}
            onChoose={(path) => onChange(from, path)}
            inputRef={toRef}
          />
        </div>
        <Button
          variant="secondary"
          iconOnly
          icon="swap"
          label={TEXT.swap}
          title={TEXT.swap}
          className={styles.swap}
          disabled={from === null && to === null}
          onClick={swap}
        />
      </div>
      {/* Each route fades in; the region that reads it out stays. */}
      <div aria-live="polite">
        <div
          key={`${from}→${to}→${route?.kind === 'found' ? route.choice : ''}`}
          className={styles.fade}
        >
          {!route && <p className={styles.hint}>{TEXT.choose}</p>}
          {route?.kind === 'found' && (
            <FoundRoute route={route} filePaths={filePaths} onStop={onStop} />
          )}
          {route?.kind === 'none' && <NoRoute route={route} from={from ?? ''} to={to ?? ''} />}
        </div>
      </div>
      {(from !== null || to !== null) && (
        <div className={styles.actions}>
          {route?.kind === 'found' && route.paths > 1 && (
            <Button variant="secondary" onClick={onNextPath}>
              {TEXT.next}
            </Button>
          )}
          {route?.kind === 'none' && (
            <Button variant="secondary" onClick={swap}>
              {TEXT.swap}
            </Button>
          )}
          <Button variant="ghost" onClick={onClear}>
            {TEXT.clear}
          </Button>
        </div>
      )}
    </QuestionPanel>
  )
})

function FoundRoute({
  route,
  filePaths,
  onStop,
}: {
  route: Extract<Route, { kind: 'found' }>
  filePaths: readonly string[]
  onStop: (path: string) => void
}) {
  const paths = route.files.map((file) => filePaths[file] ?? '')
  const summary = routeSummary(paths.length, route.paths, route.choice)
  const last = paths.length - 1
  return (
    <>
      <p className={styles.summary}>
        <strong className={styles.steps}>{summary.steps}</strong>
        {summary.through}
        {summary.which && <span className={styles.which}>{summary.which}</span>}
      </p>
      <ol
        className={styles.stops}
        aria-label={routeLabel(nameOf(paths[0] ?? ''), nameOf(paths[last] ?? ''))}
      >
        {paths.map((path, at) => {
          const name = nameOf(path)
          const end = at === 0 || at === last
          return (
            <li key={path} className={styles.stop}>
              <button
                type="button"
                className={styles.stopLink}
                title={path}
                onClick={() => onStop(path)}
              >
                <span className={`${styles.disc} ${end ? styles.end : styles.middle}`}>
                  {at + 1}
                </span>
                <span className={styles.stopWords}>
                  <span className={styles.stopName}>{name}</span>
                  <span className={styles.stopFolder}>
                    <span className={styles.stopFolderText}>
                      {path.slice(0, path.length - name.length)}
                    </span>
                  </span>
                  {at < last && (
                    <span className={styles.imports}>
                      {TEXT.imports} <span aria-hidden="true">↓</span>
                    </span>
                  )}
                </span>
              </button>
            </li>
          )
        })}
      </ol>
    </>
  )
}

function NoRoute({
  route,
  from,
  to,
}: {
  route: Extract<Route, { kind: 'none' }>
  from: string
  to: string
}) {
  const [a, b] = [nameOf(from), nameOf(to)]
  return (
    <div className={styles.none} role="status">
      <Icon name="info" size={20} className={styles.noneIcon} />
      <div className={styles.noneWords}>
        <p className={styles.noneLead}>
          {TEXT.noPath}
          <code className={styles.name}>{a}</code>
          {TEXT.doesNotDepend}
          <code className={styles.name}>{b}</code>.
        </p>
        <p className={styles.noneWhy}>{noRouteText(route.reason, a, b, route.back)}</p>
      </div>
    </div>
  )
}
