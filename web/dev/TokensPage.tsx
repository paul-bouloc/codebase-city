import styles from './TokensPage.module.css'
import { COLOR_GROUPS, tokensWithPrefix } from './token-groups'

const TEXT = {
  title: 'Design tokens',
  intro: 'Development page. Compare with the “DS · Tokens” and “DS · Typography” boards.',
  typography: 'Typography',
  colors: 'Colors',
  radii: 'Radii',
  shadows: 'Shadows',
  spacing: 'Spacing',
  focus: 'Focus ring',
  focusHint: 'Press Tab to move the focus.',
  focusButton: 'Focusable',
  glass: 'Glass over the city',
  glassText: 'Panel text stays AA over the sea and over a dense island.',
  glassSecondary: 'Secondary text on glass',
}

// Sample texts are the ones shown on the "DS · Typography" board.
const TYPE_SCALE = [
  { token: 'display-xl', sample: 'Walk through any codebase' },
  { token: 'display-l', sample: 'microsoft/vscode' },
  { token: 'heading-1', sample: 'Your analyses' },
  { token: 'heading-2', sample: 'Delete your account?' },
  { token: 'heading-3', sample: 'textModel.ts' },
  { token: 'body-l', sample: 'Paste a public GitHub repository and walk through it as a city.' },
  { token: 'body-m', sample: 'Folders become islands, files become buildings.' },
  { token: 'body-s', sample: 'TypeScript · 2,481 lines · complexity 412 (top 1%)' },
  { token: 'label', sample: 'Build the city' },
  { token: 'caption', sample: 'Analyzed 2 hours ago' },
  { token: 'eyebrow-mono', sample: 'Step 3 of 7 · Foundations' },
  { token: 'code-m', sample: 'src/vs/editor/common/model/textModel.ts' },
  { token: 'code-s', sample: 'lib/application.js' },
  { token: 'metric', sample: '1,204 · 38 · 7 of 10' },
]

export function TokensPage() {
  return (
    <main className={styles.page}>
      <header className={styles.section}>
        <h1 className="heading-1">{TEXT.title}</h1>
        <p className={`body-m ${styles.secondary}`}>{TEXT.intro}</p>
      </header>

      <section className={styles.section}>
        <h2 className="heading-2">{TEXT.typography}</h2>
        <dl className={styles.typeScale}>
          {TYPE_SCALE.map(({ token, sample }) => (
            <div key={token} className={styles.typeRow}>
              <dt className={`code-s ${styles.secondary}`}>{token}</dt>
              <dd className={token}>{sample}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className={styles.section}>
        <h2 className="heading-2">{TEXT.colors}</h2>
        {COLOR_GROUPS.map((group) => (
          <div key={group.prefix} className={styles.group}>
            <h3 className="eyebrow-mono">{group.prefix}</h3>
            <ul className={styles.swatches}>
              {group.tokens.map((token) => (
                <li key={token.name} className={styles.swatch}>
                  <span
                    className={styles.chip}
                    style={{ background: `var(--${token.name})` }}
                    aria-hidden="true"
                  />
                  <span className="code-s">--{token.name}</span>
                  <span className={`code-s ${styles.secondary}`}>{token.value}</span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </section>

      <section className={styles.section}>
        <h2 className="heading-2">{TEXT.glass}</h2>
        <div className={styles.glassScene}>
          <div className={styles.glassPanel}>
            <p className="heading-3">{TEXT.glassText}</p>
            <p className={`body-s ${styles.glassSecondary}`}>{TEXT.glassSecondary}</p>
          </div>
        </div>
      </section>

      <section className={styles.section}>
        <h2 className="heading-2">{TEXT.radii}</h2>
        <ul className={styles.boxes}>
          {tokensWithPrefix('radius').map((token) => (
            <li key={token.name} className={styles.boxItem}>
              <span className={styles.box} style={{ borderRadius: `var(--${token.name})` }} />
              <span className="code-s">--{token.name}</span>
              <span className={`code-s ${styles.secondary}`}>{token.value}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className={styles.section}>
        <h2 className="heading-2">{TEXT.shadows}</h2>
        <ul className={styles.boxes}>
          {tokensWithPrefix('shadow').map((token) => (
            <li key={token.name} className={styles.boxItem}>
              <span className={styles.box} style={{ boxShadow: `var(--${token.name})` }} />
              <span className="code-s">--{token.name}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className={styles.section}>
        <h2 className="heading-2">{TEXT.spacing}</h2>
        <ul className={styles.spacing}>
          {tokensWithPrefix('space').map((token) => (
            <li key={token.name} className={styles.spaceRow}>
              <span className="code-s">--{token.name}</span>
              <span className={styles.spaceBar} style={{ width: `var(--${token.name})` }} />
              <span className={`code-s tabular ${styles.secondary}`}>{token.value}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className={styles.section}>
        <h2 className="heading-2">{TEXT.focus}</h2>
        <p className={`body-s ${styles.secondary}`}>{TEXT.focusHint}</p>
        <button type="button" className={`label ${styles.focusButton}`}>
          {TEXT.focusButton}
        </button>
      </section>
    </main>
  )
}
