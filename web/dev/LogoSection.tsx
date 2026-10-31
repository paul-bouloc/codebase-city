import { Logo } from '../src/ui/Logo'
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

const SURFACES = ['cream', 'sea'] as const
const FAVICONS = ['favicon-32.svg', 'favicon-32.png', 'favicon-16.svg', 'favicon-16.png']

export function LogoSection() {
  return (
    <section className={styles.section}>
      <h2 className="heading-2">{TEXT.logo}</h2>
      <p className={`body-s ${styles.secondary}`}>{TEXT.logoHint}</p>
      <div className={styles.logos}>
        {SURFACES.map((surface) => (
          <figure key={`full-${surface}`} className={styles.logoCell}>
            <div className={`${styles.stage} ${styles[surface]}`}>
              <Logo variant="full" surface={surface} size={96} />
            </div>
            <figcaption className={`code-s ${styles.secondary}`}>
              {TEXT.full} {surface === 'cream' ? TEXT.onCream : TEXT.onSea}
            </figcaption>
          </figure>
        ))}
        {SURFACES.map((surface) => (
          <figure key={`compact-${surface}`} className={styles.logoCell}>
            <div className={`${styles.stage} ${styles[surface]}`}>
              <Logo variant="compact" surface={surface} size={56} />
            </div>
            <figcaption className={`code-s ${styles.secondary}`}>
              {TEXT.compact} {surface === 'cream' ? TEXT.onCream : TEXT.onSea}
            </figcaption>
          </figure>
        ))}
        {SURFACES.map((surface) => (
          <figure key={`mark-${surface}`} className={styles.logoCell}>
            <div className={`${styles.stage} ${styles[surface]}`}>
              <Logo variant="mark" surface={surface} size={48} />
              <Logo variant="mark" surface={surface} size={24} />
            </div>
            <figcaption className={`code-s ${styles.secondary}`}>
              {TEXT.mark} {surface === 'cream' ? TEXT.onCream : TEXT.onSea}
            </figcaption>
          </figure>
        ))}
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
