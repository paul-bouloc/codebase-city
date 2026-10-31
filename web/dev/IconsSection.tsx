import { Icon, type IconSize } from '../src/ui/Icon'
import { ICON_NAMES } from '../src/ui/icons'
import styles from './IconsSection.module.css'

const TEXT = {
  icons: 'Icons',
  iconsHint: 'Each icon at 24, 20 and 16 px. Compare with the “DS · Icons” board.',
}

const SIZES: IconSize[] = [24, 20, 16]

export function IconsSection() {
  return (
    <section className={styles.section}>
      <h2 className="heading-2">{TEXT.icons}</h2>
      <p className={`body-s ${styles.secondary}`}>{TEXT.iconsHint}</p>
      <ul className={styles.icons}>
        {ICON_NAMES.map((name) => (
          <li key={name} className={styles.iconCell}>
            <span className={styles.iconSizes}>
              {SIZES.map((size) => (
                <Icon key={size} name={name} size={size} />
              ))}
            </span>
            <span className="code-s">{name}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}
