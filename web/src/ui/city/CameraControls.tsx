import { type CSSProperties, type KeyboardEvent, useRef, useState } from 'react'
import { ControlHint } from '../../screen/parts/ControlHint'
import { Button } from '../Button'
import type { IconName } from '../icons'
import { rovingIndex } from '../roving-index'
import styles from './CameraControls.module.css'

const TEXT = {
  toolbar: 'Camera',
  north: 'Reset to north',
  northLetter: 'N',
  zoomIn: 'Zoom in',
  zoomOut: 'Zoom out',
  recenter: 'Recenter the camera',
  recenterHint: 'Recenter',
  topView: 'Top view',
}

export type CameraAction = 'north' | 'zoom-in' | 'zoom-out' | 'recenter' | 'top-view'

interface CameraButton {
  action: Exclude<CameraAction, 'north'>
  icon: IconName
  label: string
  hint: string
  // Shown in the hint and given to `aria-keyshortcuts`: the city listens for it.
  shortcut: string
}

const ZOOM: CameraButton[] = [
  { action: 'zoom-in', icon: 'zoom-in', label: TEXT.zoomIn, hint: TEXT.zoomIn, shortcut: '+' },
  { action: 'zoom-out', icon: 'zoom-out', label: TEXT.zoomOut, hint: TEXT.zoomOut, shortcut: '−' },
]

const FRAMING: CameraButton[] = [
  {
    action: 'recenter',
    icon: 'recenter',
    label: TEXT.recenter,
    hint: TEXT.recenterHint,
    shortcut: 'F',
  },
  { action: 'top-view', icon: 'top-view', label: TEXT.topView, hint: TEXT.topView, shortcut: 'T' },
]

// Keyboard order of the toolbar, top to bottom.
const ORDER: CameraAction[] = ['north', ...[...ZOOM, ...FRAMING].map((button) => button.action)]
const NONE_DISABLED = ORDER.map(() => false)

// `aria-keyshortcuts` wants key values (ARIA spells + as Plus), not the typographic minus.
const KEY_NAMES: Record<string, string> = { '+': 'Plus', '−': '-', F: 'F', T: 'T' }

interface CameraControlsProps {
  // Camera heading in degrees, clockwise from north: the rose turns the other way, so its N
  // keeps pointing at the city's north.
  bearing: number
  topView: boolean
  onAction: (action: CameraAction) => void
}

export function CameraControls({ bearing, topView, onAction }: CameraControlsProps) {
  // One tab stop: the arrows move inside the toolbar.
  const [active, setActive] = useState(0)
  const buttons = useRef<(HTMLButtonElement | null)[]>([])

  const handleKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const next = rovingIndex(event.key, active, NONE_DISABLED, 'vertical')
    if (next !== null) {
      event.preventDefault()
      setActive(next)
      buttons.current[next]?.focus()
    }
  }

  const control = (action: CameraAction) => {
    const index = ORDER.indexOf(action)
    return {
      ref: (element: HTMLButtonElement | null) => {
        buttons.current[index] = element
      },
      tabIndex: index === active ? 0 : -1,
      onFocus: () => setActive(index),
      onClick: () => onAction(action),
    }
  }

  const group = (items: CameraButton[]) => (
    <div className={styles.group}>
      {items.map((item) => (
        <ControlHint
          key={item.action}
          text={item.hint}
          shortcut={item.shortcut}
          side="left"
          describes={false}
        >
          {() => (
            <Button
              variant="ghost"
              iconOnly
              icon={item.icon}
              label={item.label}
              className={styles.button}
              aria-keyshortcuts={KEY_NAMES[item.shortcut]}
              aria-pressed={item.action === 'top-view' ? topView : undefined}
              {...control(item.action)}
            />
          )}
        </ControlHint>
      ))}
    </div>
  )

  return (
    <div
      role="toolbar"
      aria-label={TEXT.toolbar}
      aria-orientation="vertical"
      className={styles.toolbar}
      onKeyDown={handleKey}
    >
      <ControlHint text={TEXT.north} side="left" describes={false}>
        {() => (
          <button
            type="button"
            className={styles.compass}
            aria-label={TEXT.north}
            {...control('north')}
          >
            <Rose bearing={bearing} />
          </button>
        )}
      </ControlHint>
      {group(ZOOM)}
      {group(FRAMING)}
    </div>
  )
}

// A 44 px rose: circle, four branches, the north half needle in ink and its letter.
function Rose({ bearing }: { bearing: number }) {
  const turn = { '--rose-turn': `${-bearing}deg` } as CSSProperties
  return (
    <svg className={styles.rose} style={turn} viewBox="0 0 44 44" aria-hidden="true">
      <circle className={styles.ring} cx="22" cy="22" r="15" />
      <path
        className={styles.branch}
        d="M22 10 L25 22 L22 34 L19 22 Z M10 22 L22 19 L34 22 L22 25 Z"
      />
      <path className={styles.needle} d="M22 10 L25 22 L19 22 Z" />
      <text className={styles.letter} x="22" y="4.5" textAnchor="middle" dominantBaseline="middle">
        {TEXT.northLetter}
      </text>
    </svg>
  )
}
