import { type FormEvent, type ReactNode, useId, useRef } from 'react'
import { Icon } from '../Icon'
import type { IconName } from '../icons'
import { Button } from './Button'
import styles from './UrlField.module.css'

const TEXT = {
  label: 'Public GitHub repository',
  placeholder: 'github.com/owner/repo',
  clear: 'Clear',
}

// Driven from outside: validation and the GitHub lookup belong to the home page.
export type UrlFieldState =
  | 'empty'
  | 'typing'
  | 'valid'
  | 'invalid'
  | 'not-found'
  | 'branch'
  | 'submitting'

export type UrlFieldSize = 'md' | 'lg'

type Tone = 'neutral' | 'success' | 'error' | 'info'

interface StateLook {
  tone: Tone
  icon?: IconName
}

const LOOKS: Record<UrlFieldState, StateLook> = {
  empty: { tone: 'neutral' },
  typing: { tone: 'neutral' },
  valid: { tone: 'success', icon: 'check' },
  invalid: { tone: 'error', icon: 'alert-circle' },
  'not-found': { tone: 'error', icon: 'alert-circle' },
  branch: { tone: 'info', icon: 'info' },
  submitting: { tone: 'neutral' },
}

interface UrlFieldProps {
  state: UrlFieldState
  size?: UrlFieldSize
  value: string
  onChange: (value: string) => void
  onClear: () => void
  onSubmit: () => void
  // The line under the field. Repository names go in <code>, shown as tinted chips.
  message: ReactNode
  // "Build the city", or "Open the city" when it already exists.
  submitLabel: string
  submittingLabel: string
  showLabel?: boolean
}

export function UrlField({
  state,
  size = 'md',
  value,
  onChange,
  onClear,
  onSubmit,
  message,
  submitLabel,
  submittingLabel,
  showLabel = false,
}: UrlFieldProps) {
  const id = useId()
  const messageId = `${id}-message`
  const inputRef = useRef<HTMLInputElement>(null)
  const look = LOOKS[state]
  const submitting = state === 'submitting'
  const showClear = value !== '' && state !== 'typing' && !submitting

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!submitting) {
      onSubmit()
    }
  }

  const handleClear = () => {
    onClear()
    inputRef.current?.focus()
  }

  return (
    <form className={`${styles.field} ${styles[size]}`} data-state={state} onSubmit={handleSubmit}>
      {showLabel && (
        <label htmlFor={id} className={styles.label}>
          {TEXT.label}
        </label>
      )}
      <div className={styles.row}>
        <div className={styles.box}>
          <Icon name="link" size={size === 'lg' ? 24 : 20} className={styles.linkIcon} />
          <input
            ref={inputRef}
            id={id}
            className={styles.input}
            type="text"
            inputMode="url"
            autoComplete="off"
            spellCheck={false}
            placeholder={TEXT.placeholder}
            aria-label={showLabel ? undefined : TEXT.label}
            aria-invalid={look.tone === 'error' || undefined}
            aria-describedby={messageId}
            readOnly={submitting}
            value={value}
            onChange={(event) => onChange(event.target.value)}
          />
          {showClear && (
            <button
              type="button"
              className={styles.clear}
              aria-label={TEXT.clear}
              onClick={handleClear}
            >
              <Icon name="close" size={16} />
            </button>
          )}
        </div>
        <Button
          type="submit"
          variant="primary"
          size="lg"
          className={styles.submit}
          loading={submitting}
          loadingLabel={submittingLabel}
        >
          {submitLabel}
        </Button>
      </div>
      {/* One live region for every state: screen readers only announce changes inside a region
          that already exists, so its role must not change along with its text. Errors are also
          flagged on the input with `aria-invalid`. */}
      <p
        id={messageId}
        aria-live="polite"
        aria-atomic="true"
        className={`${styles.message} ${styles[look.tone]}`}
      >
        {look.icon && <Icon name={look.icon} size={16} className={styles.messageIcon} />}
        <span>{message}</span>
      </p>
    </form>
  )
}
