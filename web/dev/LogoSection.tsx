import { Logo, type LogoVariant } from '../src/ui/brand/Logo'
import styles from './LogoSection.module.css'

const TEXT = {
  logo: 'Logo',
  logoHint: 'Compare with the “DS · Logo” board.',
  full: 'Full',
  compact: 'Compact',
  mark: 'Mark alone',
  onCream: 'on cream',
  onSea: 'on sea',
  favicons: 'Favicons, SVG then PNG, on cream and on a dark tab',
}

// Sizes as shown on the board.
const VERSIONS: { variant: LogoVariant; sizes: number[]; label: string }[] = [
  { variant: 'full', sizes: [96], label: TEXT.full },
  { variant: 'compact', sizes: [56], label: TEXT.compact },
  { variant: 'mark', sizes: [48, 24], label: TEXT.mark },
]
const SURFACES = ['cream', 'sea'] as const
const FAVICONS = ['favicon-32.svg', 'favicon-32.png', 'favicon-16.svg', 'favicon-16.png']

export function LogoSection() {
  return (
    <section className={styles.section}>
      <h2 className="heading-2">{TEXT.logo}</h2>
      <p className={`body-s ${styles.secondary}`}>{TEXT.logoHint}</p>
      <div className={styles.logos}>
        {VERSIONS.flatMap(({ variant, sizes, label }) =>
          SURFACES.map((surface) => (
            <figure key={`${variant}-${surface}`} className={styles.logoCell}>
              <div className={`${styles.stage} ${styles[surface]}`}>
                {sizes.map((size) => (
                  <Logo key={size} variant={variant} surface={surface} size={size} />
                ))}
              </div>
              <figcaption className={`code-s ${styles.secondary}`}>
                {label} {surface === 'cream' ? TEXT.onCream : TEXT.onSea}
              </figcaption>
            </figure>
          )),
        )}
        <figure className={styles.logoCell}>
          <div className={`${styles.stage} ${styles.cream}`}>
            {FAVICONS.map((file) => (
              <img key={file} src={`/${file}`} alt="" />
            ))}
          </div>
          <div className={`${styles.stage} ${styles.tab}`}>
            {FAVICONS.map((file) => (
              <img key={file} src={`/${file}`} alt="" />
            ))}
          </div>
          <figcaption className={`code-s ${styles.secondary}`}>{TEXT.favicons}</figcaption>
        </figure>
      </div>
    </section>
  )
}
