import { type ReactNode, useId } from 'react'
import { Kbd } from '../Kbd'
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
  // Renders the control, which points `aria-describedby` at the hint.
  children: (hintId: string) => ReactNode
}

// The ink tooltip of a control, shown on hover and on keyboard focus. It names the control's
// shortcut, so the shortcuts are learnt where they are used.
export function ControlHint({ text, shortcut, side = 'bottom', children }: ControlHintProps) {
  const id = useId()
  return (
    <span className={styles.anchor}>
      {children(id)}
      <span id={id} role="tooltip" className={`${styles.hint} ${SIDE_CLASSES[side]}`}>
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
