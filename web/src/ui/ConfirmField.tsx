import { type Ref, useId } from 'react'
import styles from './ConfirmField.module.css'
import { Icon } from './Icon'

const TEXT = {
  label: (expected: string) => (
    <>
      Type <code>{expected}</code> to confirm
    </>
  ),
  empty: 'The delete button unlocks when the login matches.',
  mismatch: 'Keep typing: it must match your login exactly.',
  match: 'Login matches.',
}

// Case-sensitive; spaces around the value are forgiven.
export function confirmationMatches(value: string, expected: string): boolean {
  return value.trim() === expected
}

interface ConfirmFieldProps {
  // The value to type: the user's login.
  expected: string
  value: string
  onChange: (value: string) => void
  // While the action runs, the value can no longer change.
  readOnly?: boolean
  // For a dialog to start its focus here.
  inputRef?: Ref<HTMLInputElement>
}

// Guards an irreversible action. The page blocks its button until `confirmationMatches`.
export function ConfirmField({
  expected,
  value,
  onChange,
  readOnly = false,
  inputRef,
}: ConfirmFieldProps) {
  const id = useId()
  const helpId = `${id}-help`
  const matches = confirmationMatches(value, expected)
  const help = matches ? TEXT.match : value.trim() === '' ? TEXT.empty : TEXT.mismatch

  return (
    <div className={styles.field} data-state={matches ? 'match' : 'pending'}>
      <label htmlFor={id} className={styles.label}>
        {TEXT.label(expected)}
      </label>
      <div className={styles.box}>
        <input
          ref={inputRef}
          id={id}
          className={styles.input}
          type="text"
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          aria-describedby={helpId}
          readOnly={readOnly}
          value={value}
          onChange={(event) => onChange(event.target.value)}
        />
        {matches && <Icon name="check" size={20} className={styles.check} />}
      </div>
      {/* Permanent region: only the text changes, so every change is announced. */}
      <p id={helpId} className={styles.help} aria-live="polite" aria-atomic="true">
        {help}
      </p>
    </div>
  )
}
