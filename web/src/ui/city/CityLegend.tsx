import { type KeyboardEvent, type ReactNode, useEffect, useId, useRef } from 'react'
import {
  BRIDGE_RAIL,
  BRIDGE_STONE,
  CANAL_WATER,
  FERRY_WAKE,
  QUAY,
  TEST_PARK,
  TEST_PARK_EDGE,
} from '../../city/palette'
import type { Language } from '../Badge'
import { Button } from '../Button'
import { Icon } from '../Icon'
import styles from './CityLegend.module.css'
import { Glass } from './Glass'
import type { Landmark, LegendContent, LegendPlace } from './legend-content'

const TEXT = {
  title: 'Legend',
  expand: 'Legend',
  collapse: 'Collapse legend',
  languages: 'Languages in this repo',
  places: 'Imports and places',
  landmarks: 'Landmarks',
  tests: 'Tests',
  footer: 'Height · complexity. Footprint · lines of code.',
}

const LANGUAGE_NAMES: Record<Language, string> = {
  typescript: 'TypeScript',
  javascript: 'JavaScript',
  css: 'CSS',
  other: 'Other',
}

const PLACE_NAMES: Record<LegendPlace, string> = {
  bridge: 'Bridge · imports between islands',
  ferry: 'Ferry line · imports across the water',
  port: 'Port · links grouped on one quay',
  upward: 'Upward import · breaks the layers',
  cycle: 'Cycle · files that import each other',
  canal: 'Canal · border between sub-folders',
  park: 'Park · tests',
}

const LANDMARK_NAMES: Record<Landmark, string> = {
  'entry-point': 'Lighthouse · entry point',
  conductor: 'Golden tower · conductor',
  foundation: 'Plinth · foundation',
  facade: 'Facade · re-exports',
  config: 'Kiosk · config',
}

// The pill shows the colours of the first languages.
const PILL_DOTS = 3

interface CityLegendProps {
  content: LegendContent
  expanded: boolean
  onExpandedChange: (expanded: boolean) => void
}

export function CityLegend({ content, expanded, onExpandedChange }: CityLegendProps) {
  const panelId = useId()
  const titleId = useId()
  const pillRef = useRef<HTMLButtonElement>(null)
  const collapseRef = useRef<HTMLButtonElement>(null)
  // Only a toggle from inside the legend moves the focus, not the first render.
  const moveFocus = useRef(false)

  useEffect(() => {
    if (moveFocus.current) {
      moveFocus.current = false
      ;(expanded ? collapseRef : pillRef).current?.focus()
    }
  }, [expanded])

  const toggle = (next: boolean) => {
    moveFocus.current = true
    onExpandedChange(next)
  }

  const handleEscape = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === 'Escape') {
      event.stopPropagation()
      toggle(false)
    }
  }

  return (
    <>
      <Glass className={styles.pill} hidden={expanded}>
        <button
          ref={pillRef}
          type="button"
          className={styles.pillButton}
          aria-expanded={false}
          aria-controls={panelId}
          onClick={() => toggle(true)}
        >
          <span className={styles.dots} aria-hidden="true">
            {content.languages.slice(0, PILL_DOTS).map(({ language }) => (
              <span key={language} className={styles.dot} data-language={language} />
            ))}
          </span>
          {TEXT.expand}
          <Icon name="chevron-down" size={16} className={styles.chevronUp} />
        </button>
      </Glass>

      <Glass
        as="section"
        id={panelId}
        aria-labelledby={titleId}
        className={styles.panel}
        hidden={!expanded}
        onKeyDown={handleEscape}
      >
        <div className={styles.header}>
          <h2 id={titleId} className={styles.title}>
            {TEXT.title}
          </h2>
          <Button
            ref={collapseRef}
            variant="ghost"
            iconOnly
            icon="close"
            label={TEXT.collapse}
            aria-expanded={true}
            aria-controls={panelId}
            onClick={() => toggle(false)}
          />
        </div>

        {(content.languages.length > 0 || content.tests) && (
          <Group title={TEXT.languages} columns>
            {content.languages.map(({ language, share }) => (
              <li key={language} className={styles.row}>
                <span className={styles.swatch}>
                  <span className={styles.dot} data-language={language} />
                </span>
                {LANGUAGE_NAMES[language]}
                <span className={styles.share}>{share}</span>
              </li>
            ))}
            {content.tests && (
              <li className={styles.row}>
                <span className={styles.swatch}>
                  <span className={styles.dot} data-language="test" />
                </span>
                {TEXT.tests}
              </li>
            )}
          </Group>
        )}

        {content.places.length > 0 && (
          <Group title={TEXT.places}>
            {content.places.map((place) => (
              <li key={place} className={styles.row}>
                <span className={styles.swatch}>
                  <PlaceSample place={place} />
                </span>
                {PLACE_NAMES[place]}
              </li>
            ))}
          </Group>
        )}

        {content.landmarks.length > 0 && (
          <Group title={TEXT.landmarks}>
            {content.landmarks.map((landmark) => (
              <li key={landmark} className={styles.row}>
                <span className={styles.swatch}>
                  <Icon name={landmark} size={18} />
                </span>
                {LANDMARK_NAMES[landmark]}
              </li>
            ))}
          </Group>
        )}

        <p className={styles.footer}>{TEXT.footer}</p>
      </Glass>
    </>
  )
}

function Group({
  title,
  columns = false,
  children,
}: {
  title: string
  columns?: boolean
  children: ReactNode
}) {
  const id = useId()
  return (
    <div className={styles.group}>
      <h3 id={id} className={styles.eyebrow}>
        {title}
      </h3>
      <ul
        aria-labelledby={id}
        className={columns ? `${styles.list} ${styles.columns}` : styles.list}
      >
        {children}
      </ul>
    </div>
  )
}

// 22 × 14 samples drawn as the city draws them.
function PlaceSample({ place }: { place: LegendPlace }) {
  return (
    <svg width="22" height="14" viewBox="0 0 22 14" aria-hidden="true">
      {SAMPLES[place]}
    </svg>
  )
}

const SAMPLES: Record<LegendPlace, ReactNode> = {
  bridge: (
    <>
      <rect x="0" y="3" width="22" height="8" fill={BRIDGE_STONE} />
      <path d="M0 4.5 H22 M0 9.5 H22" stroke={BRIDGE_RAIL} strokeWidth="1" />
    </>
  ),
  ferry: (
    <>
      <rect className={styles.water} x="0" y="1" width="22" height="12" rx="2" />
      <path d="M2 7 H20" stroke={FERRY_WAKE} strokeWidth="2" strokeDasharray="4 2.5" />
    </>
  ),
  port: (
    <>
      <rect className={styles.water} x="0" y="1" width="22" height="12" rx="2" />
      <rect x="0" y="1" width="9" height="12" fill={QUAY} />
      <path d="M9 4 H15 M9 10 H15" stroke={QUAY} strokeWidth="2" />
    </>
  ),
  upward: <path className={styles.upward} d="M0 7 H22" strokeDasharray="6 5" />,
  cycle: <circle className={styles.cycle} cx="11" cy="7" r="5" />,
  canal: (
    <>
      <rect x="0" y="4" width="22" height="7" fill={CANAL_WATER} />
      <path d="M0 4 H22" stroke={QUAY} strokeWidth="2" />
    </>
  ),
  park: (
    <rect
      x="1"
      y="2"
      width="20"
      height="10"
      rx="1"
      fill={TEST_PARK}
      stroke={TEST_PARK_EDGE}
      strokeWidth="1"
    />
  ),
}
