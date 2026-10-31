import { type CSSProperties, useId } from 'react'
import { Icon } from './Icon'
import type { IconName } from './icons'
import styles from './SegmentedControl.module.css'

export interface SegmentedOption<T extends string> {
  value: T
  label: string
  icon?: IconName
}

interface SegmentedControlProps<T extends string> {
  label: string
  options: readonly SegmentedOption<T>[]
  value: T
  onChange: (value: T) => void
  // While the city is building.
  disabled?: boolean
}

// Native radio buttons under the pill: the browser gives the single tab stop and the arrow keys.
export function SegmentedControl<T extends string>({
  label,
  options,
  value,
  onChange,
  disabled = false,
}: SegmentedControlProps<T>) {
  const name = useId()
  // An unknown value checks nothing, so any option can still be picked.
  const checkedIndex = options.findIndex((option) => option.value === value)

  // The thumb slides under the checked option; options share the width equally.
  const thumbPosition = {
    '--segment-count': options.length,
    '--segment-index': Math.max(0, checkedIndex),
  } as CSSProperties

  return (
    <div
      role="radiogroup"
      aria-label={label}
      aria-disabled={disabled || undefined}
      className={styles.rail}
      style={thumbPosition}
    >
      {checkedIndex !== -1 && <span className={styles.thumb} aria-hidden="true" />}
      {options.map((option, index) => (
        <label key={option.value} className={styles.option}>
          <input
            type="radio"
            className={styles.input}
            name={name}
            value={option.value}
            checked={index === checkedIndex}
            disabled={disabled}
            onChange={() => onChange(option.value)}
          />
          {option.icon && <Icon name={option.icon} size={16} />}
          {option.label}
        </label>
      ))}
    </div>
  )
}
