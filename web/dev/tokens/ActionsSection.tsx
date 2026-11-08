import { type ReactNode, useEffect, useState } from 'react'
import { Button, type ButtonVariant } from '../../src/ui/actions/Button'
import { Kbd } from '../../src/ui/actions/Kbd'
import { SegmentedControl, type SegmentedOption } from '../../src/ui/actions/SegmentedControl'
import { type TabItem, Tabs } from '../../src/ui/actions/Tabs'
import { UrlField, type UrlFieldSize, type UrlFieldState } from '../../src/ui/actions/UrlField'
import type { IconName } from '../../src/ui/brand/icons'
import styles from './ActionsSection.module.css'

const TEXT = {
  title: 'Actions and inputs',
  hint: 'Compare with the “DS · Components 1 · Actions & inputs” board. Hover, press and Tab through the live controls for the other states.',
  buttons: 'Buttons',
  iconOnly: 'Icon only',
  large: 'Large size',
  liveLoading: 'The first one is live: click it to see the loading state come and go.',
  touch: 'With a touch screen, medium controls grow to 44 px.',
  urlField: 'Repository URL field',
  segmented: 'Segmented control',
  tabs: 'Tabs',
  tabPanel: (label: string) => `Content of the “${label}” tab.`,
  keys: 'Keyboard keys',
  states: ['Default', 'Disabled', 'Blocked', 'Loading'],
}

interface ButtonSample {
  variant: ButtonVariant
  label: string
  loadingLabel?: string
  icon?: IconName
}

// Labels from the board, plus the Guide variant of step 4b.
const BUTTONS: ButtonSample[] = [
  { variant: 'primary', label: 'Build the city', loadingLabel: 'Starting…', icon: 'buildings' },
  { variant: 'secondary', label: 'Share', loadingLabel: 'Copying…', icon: 'share' },
  { variant: 'ghost', label: 'Cancel' },
  {
    variant: 'github',
    label: 'Sign in with GitHub',
    loadingLabel: 'Connecting…',
    icon: 'github',
  },
  { variant: 'danger', label: 'Delete account', loadingLabel: 'Deleting…' },
  { variant: 'guide', label: 'Take the tour', icon: 'play' },
]

interface UrlSample {
  state: UrlFieldState
  value: string
  message: ReactNode
  submitLabel: string
}

const URL_SAMPLES: UrlSample[] = [
  {
    state: 'empty',
    value: '',
    message: (
      <>
        Paste a URL or type <code>owner/repo</code>.
      </>
    ),
    submitLabel: 'Build the city',
  },
  {
    state: 'typing',
    value: 'github.com/fastapi/fast',
    message: (
      <>
        Paste a URL or type <code>owner/repo</code>.
      </>
    ),
    submitLabel: 'Build the city',
  },
  {
    state: 'valid',
    value: 'https://github.com/fastapi/fastapi',
    message: (
      <>
        <code>fastapi/fastapi</code> · already built 2 days ago, opens instantly.
      </>
    ),
    submitLabel: 'Open the city',
  },
  {
    state: 'invalid',
    value: 'gitlab.com/inkscape/inkscape',
    message: (
      <>
        Paste a GitHub repository, like <code>owner/repo</code>.
      </>
    ),
    submitLabel: 'Build the city',
  },
  {
    state: 'not-found',
    value: 'github.com/expressjs/expresss',
    message: (
      <>
        We couldn’t find a public repository at <code>expressjs/expresss</code>.
      </>
    ),
    submitLabel: 'Build the city',
  },
  {
    state: 'branch',
    value: 'github.com/fastapi/fastapi/tree/0.115-fixes',
    message: (
      <>
        Only the default branch is supported for now. Showing <code>master</code>.
      </>
    ),
    submitLabel: 'Build the city',
  },
  {
    state: 'submitting',
    value: 'https://github.com/expressjs/express',
    message: (
      <>
        Checking <code>expressjs/express</code> on GitHub…
      </>
    ),
    submitLabel: 'Build the city',
  },
]

const MODES: SegmentedOption<'simplified' | 'realistic'>[] = [
  { value: 'simplified', label: 'Simplified', icon: 'mode-simplified' },
  { value: 'realistic', label: 'Realistic', icon: 'mode-realistic' },
]

const FILE_TABS: TabItem[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'imports', label: 'Imports', count: 38 },
  { id: 'imported-by', label: 'Imported by', count: 1204 },
  { id: 'history', label: 'History', disabled: true },
]

const SHORTCUTS: { action: string; keys: string[] }[] = [
  { action: 'Search files', keys: ['⌘', 'K'] },
  { action: 'Focus search', keys: ['/'] },
  { action: 'Play or pause the tour', keys: ['Space'] },
  { action: 'Previous or next step', keys: ['←', '→'] },
  { action: 'Recenter on the selection', keys: ['F'] },
  { action: 'Top view, there and back', keys: ['T'] },
  { action: 'Switch building style', keys: ['M'] },
  { action: 'Close panel or menu, deselect', keys: ['Esc'] },
]

function ButtonRow({ variant, label, loadingLabel, icon }: ButtonSample) {
  const common = { variant, icon, loadingLabel }
  return (
    <tr>
      <th scope="row" className="code-s">
        {variant}
      </th>
      <td>
        <Button {...common}>{label}</Button>
      </td>
      <td>
        <Button {...common} disabled>
          {label}
        </Button>
      </td>
      <td>
        <Button {...common} blocked>
          {label}
        </Button>
      </td>
      <td>
        <Button {...common} loading>
          {label}
        </Button>
      </td>
    </tr>
  )
}

// Loads for a few seconds, like a build being started, then comes back.
function LiveLoadingButton() {
  const [loading, setLoading] = useState(false)
  useEffect(() => {
    if (!loading) {
      return
    }
    const timer = setTimeout(() => setLoading(false), 2500)
    return () => clearTimeout(timer)
  }, [loading])

  return (
    <Button
      variant="primary"
      size="lg"
      icon="buildings"
      loading={loading}
      loadingLabel="Starting…"
      onClick={() => setLoading(true)}
    >
      Build the city
    </Button>
  )
}

function UrlFieldDemo({ sample, size }: { sample: UrlSample; size: UrlFieldSize }) {
  const [value, setValue] = useState(sample.value)
  return (
    <UrlField
      state={sample.state}
      size={size}
      value={value}
      onChange={setValue}
      onClear={() => setValue('')}
      onSubmit={() => {}}
      message={sample.message}
      submitLabel={sample.submitLabel}
      submittingLabel="Submitting…"
      showLabel={sample.state === 'empty'}
    />
  )
}

export function ActionsSection() {
  const [mode, setMode] = useState<'simplified' | 'realistic'>('simplified')
  const [tab, setTab] = useState('overview')
  const tabLabel = FILE_TABS.find((item) => item.id === tab)?.label ?? ''

  return (
    <section className={styles.section}>
      <h2 className="heading-2">{TEXT.title}</h2>
      <p className={`body-s ${styles.secondary}`}>{TEXT.hint}</p>

      <div className={styles.block}>
        <h3 className="heading-3">{TEXT.buttons}</h3>
        <div className={styles.scroll}>
          <table className={styles.matrix}>
            <thead>
              <tr>
                <td />
                {TEXT.states.map((state) => (
                  <th key={state} scope="col" className="eyebrow-mono">
                    {state}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {BUTTONS.map((sample) => (
                <ButtonRow key={sample.variant} {...sample} />
              ))}
              <tr>
                <th scope="row" className="code-s">
                  {TEXT.iconOnly}
                </th>
                <td>
                  <Button iconOnly icon="share" label="Share this city" />
                </td>
                <td>
                  <Button iconOnly icon="share" label="Share this city" disabled />
                </td>
                <td>
                  <Button iconOnly icon="share" label="Share this city" blocked />
                </td>
                <td>
                  <Button iconOnly icon="share" label="Share this city" loading />
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className={`body-s ${styles.secondary}`}>{TEXT.touch}</p>
        <h4 className="eyebrow-mono">{TEXT.large}</h4>
        <div className={styles.row}>
          <LiveLoadingButton />
          <Button variant="primary" size="lg" loading loadingLabel="Starting…">
            Build the city
          </Button>
          <Button size="lg">See progress</Button>
          <Button variant="github" size="lg" icon="github">
            Sign in with GitHub
          </Button>
        </div>
        <p className={`body-s ${styles.secondary}`}>{TEXT.liveLoading}</p>
      </div>

      <div className={styles.block}>
        <h3 className="heading-3">{TEXT.urlField}</h3>
        {(['md', 'lg'] as const).map((size) => (
          <div key={size} className={styles.urlGroup}>
            <h4 className="eyebrow-mono">{size}</h4>
            {URL_SAMPLES.map((sample) => (
              <div key={sample.state} className={styles.urlRow}>
                <span className="code-s">{sample.state}</span>
                <UrlFieldDemo sample={sample} size={size} />
              </div>
            ))}
          </div>
        ))}
      </div>

      <div className={styles.block}>
        <h3 className="heading-3">{TEXT.segmented}</h3>
        <div className={styles.row}>
          <SegmentedControl
            label="Building style"
            options={MODES}
            value={mode}
            onChange={setMode}
          />
          <SegmentedControl
            label="Building style, disabled"
            options={MODES}
            value={mode}
            onChange={setMode}
            disabled
          />
        </div>
      </div>

      <div className={styles.block}>
        <h3 className="heading-3">{TEXT.tabs}</h3>
        <div className={styles.panel}>
          <Tabs label="File sheet" tabs={FILE_TABS} selected={tab} onSelect={setTab}>
            <p className={`body-m ${styles.tabPanel}`}>{TEXT.tabPanel(tabLabel)}</p>
          </Tabs>
        </div>
      </div>

      <div className={styles.block}>
        <h3 className="heading-3">{TEXT.keys}</h3>
        <dl className={styles.shortcuts}>
          {SHORTCUTS.map(({ action, keys }) => (
            <div key={action} className={styles.shortcut}>
              <dt className="body-s">{action}</dt>
              <dd className={styles.keys}>
                {keys.map((key) => (
                  <Kbd key={key}>{key}</Kbd>
                ))}
              </dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  )
}
