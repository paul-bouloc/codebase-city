import { useRef, useState } from 'react'
import { AccountMenu } from '../src/ui/AccountMenu'
import { Avatar } from '../src/ui/Avatar'
import { Button } from '../src/ui/actions/Button'
import { ConfirmField } from '../src/ui/actions/ConfirmField'
import { confirmationMatches } from '../src/ui/actions/confirmation'
import { Dialog } from '../src/ui/Dialog'
import { EmptyState } from '../src/ui/EmptyState'
import { InlineAlert } from '../src/ui/InlineAlert'
import { LiveRegion } from '../src/ui/LiveRegion'
import { ToastProvider } from '../src/ui/ToastProvider'
import { useToast } from '../src/ui/use-toast'
import styles from './FeedbackSection.module.css'

const TEXT = {
  title: 'Feedback',
  hint: 'Compare with the “DS · Components 3 · Feedback & more” board. The toasts, the dialog and the account menu are live: try them with the mouse and the keyboard.',
  alerts: 'Inline alerts',
  liveAlert: 'Toggle an alert inside a live region',
  toasts: 'Toasts',
  dialog: 'Dialog and type-to-confirm field',
  confirmStates: 'Field states',
  avatars: 'Avatars',
  menu: 'Account menu',
  empty: 'Empty states',
}

const LOGIN = 'lena-okafor'
// A real GitHub avatar, and one that fails to load.
const AVATAR = 'https://avatars.githubusercontent.com/u/9919?v=4'
const BROKEN_AVATAR = 'https://avatars.githubusercontent.com/u/0-missing'

function ToastButtons() {
  const { show } = useToast()
  return (
    <div className={styles.row}>
      <Button
        onClick={() =>
          show({
            tone: 'success',
            title: 'Done · microsoft/vscode',
            body: '15,212 files, built in 2 min 14 s.',
            action: { label: 'Open', onClick: () => {} },
          })
        }
      >
        Success
      </Button>
      <Button
        onClick={() =>
          show({
            tone: 'error',
            title: 'Failed · expressjs/express',
            body: 'We couldn’t download the code: GitHub returned 503.',
            action: { label: 'Retry', onClick: () => {} },
          })
        }
      >
        Error
      </Button>
      <Button onClick={() => show({ tone: 'info', title: 'Link copied' })}>Info</Button>
    </div>
  )
}

type DeleteStep = 'ask' | 'deleting' | 'error' | 'done'

function DeleteDemo() {
  const [open, setOpen] = useState(false)
  const [value, setValue] = useState('')
  const [step, setStep] = useState<DeleteStep>('ask')
  const attempts = useRef(0)
  const field = useRef<HTMLInputElement>(null)
  const matches = confirmationMatches(value, LOGIN)

  const openDialog = () => {
    setValue('')
    setStep('ask')
    attempts.current = 0
    setOpen(true)
  }

  // The first attempt fails, the second succeeds, to show both outcomes.
  const remove = () => {
    if (!matches || step === 'deleting') {
      return
    }
    setStep('deleting')
    attempts.current += 1
    setTimeout(() => setStep(attempts.current === 1 ? 'error' : 'done'), 1200)
  }

  if (step === 'done') {
    return (
      <>
        <Button variant="danger" onClick={openDialog}>
          Delete account…
        </Button>
        <Dialog open={open} onClose={() => setOpen(false)} title="Your account is deleted">
          <p>
            You’re signed out. Your analysis history is gone; the cities you built stay in the
            gallery for everyone. Thanks for visiting.
          </p>
        </Dialog>
      </>
    )
  }

  return (
    <>
      <Button variant="danger" onClick={openDialog}>
        Delete account…
      </Button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="Delete your account?"
        initialFocus={field}
        actions={
          <>
            <Button onClick={() => setOpen(false)}>Cancel</Button>
            <Button
              variant="danger"
              blocked={!matches}
              loading={step === 'deleting'}
              loadingLabel="Deleting…"
              onClick={remove}
            >
              {step === 'error' ? 'Try again' : 'Delete account'}
            </Button>
          </>
        }
      >
        <p>
          This removes your GitHub connection and your analysis history. Cities you built stay
          public in the gallery. This can’t be undone.
        </p>
        <ConfirmField
          expected={LOGIN}
          value={value}
          onChange={setValue}
          readOnly={step === 'deleting'}
          inputRef={field}
        />
        <LiveRegion>
          {step === 'error' && (
            <InlineAlert tone="error" title="We couldn’t delete your account.">
              Nothing was removed and you’re still signed in. Try again in a moment.
            </InlineAlert>
          )}
        </LiveRegion>
      </Dialog>
    </>
  )
}

export function FeedbackSection() {
  const [alertShown, setAlertShown] = useState(false)
  const [confirmValues, setConfirmValues] = useState(['', 'lena-okafo', LOGIN])

  return (
    <ToastProvider>
      <section id="feedback" className={styles.section}>
        <h2 className="heading-2">{TEXT.title}</h2>
        <p className={`body-s ${styles.secondary}`}>{TEXT.hint}</p>

        <div className={styles.block}>
          <h3 className="heading-3">{TEXT.alerts}</h3>
          <div className={styles.alerts}>
            <InlineAlert tone="info" title="Under maintenance" icon="wrench">
              Building is paused for a few minutes. The cities stay open.
            </InlineAlert>
            <InlineAlert tone="success" title="Login matches." />
            <InlineAlert tone="warning" title="GitHub’s rate limit was reached." icon="clock">
              We resume by ourselves in about 4 min. Nothing to do, and nothing extra is used.
            </InlineAlert>
            <InlineAlert
              tone="error"
              title="The analysis took too long and was stopped."
              action={<Button variant="primary">Try again</Button>}
            >
              Your analysis was refunded.
            </InlineAlert>
            <InlineAlert tone="neutral" title="You cancelled the build.">
              Your analysis was given back: 8 of 10 left today.
            </InlineAlert>
            <InlineAlert tone="warning" title="Reconnecting…" compact>
              The build goes on on our side; progress will catch up.
            </InlineAlert>
          </div>
          <div className={styles.row}>
            <Button onClick={() => setAlertShown((shown) => !shown)}>{TEXT.liveAlert}</Button>
          </div>
          <LiveRegion className={styles.alerts}>
            {alertShown && (
              <InlineAlert tone="warning" title="2 of 10 analyses left today">
                Large repositories may use more.
              </InlineAlert>
            )}
          </LiveRegion>
        </div>

        <div className={styles.block}>
          <h3 className="heading-3">{TEXT.toasts}</h3>
          <ToastButtons />
        </div>

        <div className={styles.block}>
          <h3 className="heading-3">{TEXT.dialog}</h3>
          <div className={styles.row}>
            <DeleteDemo />
          </div>
          <h4 className="eyebrow-mono">{TEXT.confirmStates}</h4>
          <div className={styles.confirms}>
            {confirmValues.map((value, index) => (
              <ConfirmField
                // biome-ignore lint/suspicious/noArrayIndexKey: three fixed samples
                key={index}
                expected={LOGIN}
                value={value}
                onChange={(next) =>
                  setConfirmValues((values) => values.map((v, i) => (i === index ? next : v)))
                }
              />
            ))}
          </div>
        </div>

        <div className={styles.block}>
          <h3 className="heading-3">{TEXT.avatars}</h3>
          <div className={styles.row}>
            <Avatar login={LOGIN} src={AVATAR} size={72} />
            <Avatar login={LOGIN} src={AVATAR} size={40} />
            <Avatar login={LOGIN} src={AVATAR} size={32} />
            <Avatar login={LOGIN} src={BROKEN_AVATAR} size={72} />
            <Avatar login={LOGIN} src={BROKEN_AVATAR} size={40} />
            <Avatar login="torvalds" size={32} />
          </div>
        </div>

        <div className={styles.block}>
          <h3 className="heading-3">{TEXT.menu}</h3>
          <div className={styles.menuRow}>
            <AccountMenu
              login={LOGIN}
              avatarSrc={AVATAR}
              quota="7 of 10 analyses left today · resets at 1:00 AM"
              accountHref="#account"
              onSignOut={() => {}}
            />
            <AccountMenu
              login="ada-dev"
              avatarSrc={BROKEN_AVATAR}
              accountHref="#account"
              onSignOut={() => {}}
            />
          </div>
        </div>

        <div className={styles.block}>
          <h3 className="heading-3">{TEXT.empty}</h3>
          <div className={styles.row}>
            <EmptyState
              title="No cities yet"
              action={<Button variant="primary">Analyze a repository</Button>}
            >
              Paste a public GitHub repository to build your first city. A repo like
              expressjs/express takes about a minute.
            </EmptyState>
            <EmptyState title="No files match “textmod”" compact>
              Try a folder name.
            </EmptyState>
          </div>
        </div>
      </section>
    </ToastProvider>
  )
}
