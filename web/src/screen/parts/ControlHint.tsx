import { type ReactNode, useEffect, useId, useState } from 'react'
import { Kbd } from '../../ui/actions/Kbd'
import styles from './ControlHint.module.css'

type HintSide = 'left' | 'bottom' | 'bottom-end'

const SIDE_CLASSES: Record<HintSide, string | undefined> = {
  left: styles.left,
  bottom: styles.bottom,
  'bottom-end': styles.bottomEnd,
}

interface ControlHintProps {
  text: string
  // The key that does the same, written after the text: "Recenter · F".
  shortcut?: string
  // Camera buttons get it on their left, top bar controls below; `bottom-end` keeps it inside a
  // panel when the control sits at its right edge.
  side?: HintSide
  // Whether the hint adds to the control's name. When it only repeats it (the shortcut being
  // given by `aria-keyshortcuts`), it stays visual and the control gets no description.
  describes?: boolean
  // Renders the control; `hintId` is for its `aria-describedby`, when the hint describes it.
  children: (hintId: string | undefined) => ReactNode
}

// The ink tooltip of a control, shown on hover and on keyboard focus. It names the control's
// shortcut, so the shortcuts are learnt where they are used. It stays while the pointer is on it
// and Esc hides it until the pointer or the focus leaves (WCAG 1.4.13).
export function ControlHint({
  text,
  shortcut,
  side = 'bottom',
  describes = true,
  children,
}: ControlHintProps) {
  const id = useId()
  const [hovered, setHovered] = useState(false)
  const [focused, setFocused] = useState(false)
  const [dismissed, setDismissed] = useState(false)
  const active = hovered || focused

  useEffect(() => {
    if (!active) {
      setDismissed(false)
      return
    }
    // On the document: a hovered hint has no focus to receive the key. The key goes on to the
    // city, so Esc still closes a panel.
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setDismissed(true)
      }
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [active])

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: only follows hover and focus of the control
    <span
      className={styles.anchor}
      data-dismissed={dismissed || undefined}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
    >
      {children(describes ? id : undefined)}
      <span
        id={describes ? id : undefined}
        role={describes ? 'tooltip' : undefined}
        aria-hidden={describes ? undefined : true}
        className={`${styles.hint} ${SIDE_CLASSES[side]}`}
      >
        {text}
        {shortcut && (
          <span className={styles.shortcut}>
            <span aria-hidden="true">·</span>
            <Kbd tone="inverse">{shortcut}</Kbd>
          </span>
        )}
      </span>
    </span>
  )
}
