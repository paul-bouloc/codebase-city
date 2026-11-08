import { type KeyboardEvent, type ReactNode, useId } from 'react'
import { ControlHint } from '../../screen/parts/ControlHint'
import { Glass } from '../../screen/parts/Glass'
import { Button } from '../Button'
import { Icon } from '../Icon'
import type { IconName } from '../icons'
import { LiveRegion } from '../LiveRegion'
import { ScrollArea } from '../ScrollArea'
import styles from './SheetFrame.module.css'
import { usePanelFocus } from './use-panel-focus'

const TEXT = {
  close: 'Close',
  closeKey: 'Esc',
}

interface SheetFrameProps {
  open: boolean
  // Esc or the close button. The city screen then gives a second Esc to the selection.
  onClose: () => void
  breadcrumb: ReactNode
  icon: IconName
  // A file's tile is Harbor, a folder's is neutral.
  tone: 'accent' | 'neutral'
  title: string
  subtitle?: string
  badges?: ReactNode
  actions: ReactNode
  // Pinned under the body; absent when there is nothing to pin.
  footer?: ReactNode
  // While the details load: the header is real, the rest is a skeleton.
  busy?: boolean
  // Read out while busy: "Loading file details".
  busyLabel?: string
  // What the sheet shows (a path): when it changes, a focus lost with the old content goes to
  // the title.
  contentKey?: string
  children: ReactNode
}

// The shared frame of the file and folder sheets: fixed header, a body that scrolls, an optional
// pinned footer. It slides in from the right by its whole width and stays in the page, inert,
// while closed. The screen places it (12 px from the right, under the top bar).
export function SheetFrame({
  open,
  onClose,
  breadcrumb,
  icon,
  tone,
  title,
  subtitle,
  badges,
  actions,
  footer,
  busy = false,
  busyLabel,
  contentKey,
  children,
}: SheetFrameProps) {
  const titleId = useId()
  const { panelRef, titleRef } = usePanelFocus<HTMLDivElement, HTMLHeadingElement>(open, contentKey)

  const handleEscape = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      onClose()
    }
  }

  return (
    <Glass
      ref={panelRef}
      as="section"
      aria-labelledby={titleId}
      aria-busy={busy || undefined}
      className={open ? `${styles.sheet} ${styles.open}` : styles.sheet}
      inert={!open}
      onKeyDown={handleEscape}
    >
      {/* Always there, so the loading message is announced when it appears. */}
      <LiveRegion className="visually-hidden">{busy ? busyLabel : null}</LiveRegion>
      <header className={styles.header}>
        <div className={styles.topRow}>
          {breadcrumb}
          <ControlHint
            text={TEXT.close}
            shortcut={TEXT.closeKey}
            side="bottom-end"
            describes={false}
          >
            {() => (
              <Button
                variant="ghost"
                iconOnly
                icon="close"
                label={TEXT.close}
                aria-keyshortcuts="Escape"
                onClick={onClose}
              />
            )}
          </ControlHint>
        </div>

        <div className={styles.titleRow}>
          <span className={`${styles.tile} ${styles[tone]}`} aria-hidden="true">
            <Icon name={icon} size={20} />
          </span>
          <div className={styles.titleText}>
            <h2 ref={titleRef} id={titleId} className={styles.title} title={title} tabIndex={-1}>
              {title}
            </h2>
            {subtitle && <p className={styles.subtitle}>{subtitle}</p>}
          </div>
        </div>

        {badges && <div className={styles.badges}>{badges}</div>}
        <div className={styles.actions}>{actions}</div>
      </header>

      <ScrollArea viewportClassName={styles.body}>{children}</ScrollArea>

      {footer && <footer className={styles.footer}>{footer}</footer>}
    </Glass>
  )
}
