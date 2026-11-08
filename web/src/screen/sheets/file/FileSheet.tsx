import { Button } from '../../../ui/actions/Button'
import { LinkButton } from '../../../ui/actions/LinkButton'
import { safeGithubHref } from '../../github-links'
import { Skeleton } from '../../parts/Skeleton'
import { splitPath } from '../../parts/shorten-folder'
import { Breadcrumb } from '../Breadcrumb'
import { SheetFrame } from '../SheetFrame'
import type { FileSheetData } from '../sheet-data'
import { FileBadges } from './FileBadges'
import { FileDetails, type FileTab } from './FileDetails'
import styles from './FileSheet.module.css'

const TEXT = {
  github: 'Open on GitHub',
  copyPath: 'Copy path',
  copyLink: 'Copy link to this file',
  loading: 'Loading file details',
  showImpact: 'Show impact',
  findPath: 'Find a path to…',
}

interface FileSheetProps {
  open: boolean
  file: FileSheetData
  // Details still on their way: the breadcrumb and the name are shown, the rest is a skeleton.
  loading?: boolean
  onClose: () => void
  onOpenFolder: (path: string) => void
  onSelectFile: (path: string) => void
  onShowCycle: (index: number) => void
  onCopyPath: () => void
  onCopyLink: () => void
  onRetryCode: () => void
  // The Code tab is on show: its code is read from GitHub only then.
  onOpenCode?: () => void
  // The guide's questions on a file; the footer that offers them shows once they exist.
  onShowImpact?: () => void
  onFindPath?: () => void
  // For the demonstration page: open on a given tab, list or comment unfolded.
  defaultTab?: FileTab
  defaultExpanded?: boolean
  // A line to show in the Code tab, as a symbol's from the search: each new `request` opens it.
  openLine?: { line: number; request: number }
}

export function FileSheet({
  open,
  file,
  loading = false,
  onClose,
  onOpenFolder,
  onSelectFile,
  onShowCycle,
  onCopyPath,
  onCopyLink,
  onRetryCode,
  onOpenCode,
  onShowImpact,
  onFindPath,
  defaultTab,
  defaultExpanded = false,
  openLine,
}: FileSheetProps) {
  const { folder, name } = splitPath(file.path)
  const folders = folder.split('/').filter(Boolean)
  const githubHref = safeGithubHref(file.githubUrl)

  const actions = (
    <>
      {githubHref && (
        <LinkButton href={githubHref} icon="external" newTab>
          {TEXT.github}
        </LinkButton>
      )}
      <Button
        iconOnly
        icon="copy"
        label={TEXT.copyPath}
        title={TEXT.copyPath}
        onClick={onCopyPath}
      />
      <Button
        iconOnly
        icon="link"
        label={TEXT.copyLink}
        title={TEXT.copyLink}
        onClick={onCopyLink}
      />
    </>
  )

  const footer =
    !loading && file.analyzed && onShowImpact && onFindPath ? (
      <>
        <Button onClick={onShowImpact}>{TEXT.showImpact}</Button>
        <Button onClick={onFindPath}>{TEXT.findPath}</Button>
      </>
    ) : undefined

  return (
    <SheetFrame
      open={open}
      onClose={onClose}
      breadcrumb={<Breadcrumb folders={folders} onOpenFolder={onOpenFolder} />}
      icon="file"
      tone="accent"
      title={name}
      badges={loading ? <Skeleton width="180px" height="24px" /> : <FileBadges file={file} />}
      actions={actions}
      footer={footer}
      busy={loading}
      busyLabel={TEXT.loading}
      contentKey={file.path}
    >
      {loading ? (
        <div className={styles.loading}>
          <Skeleton width="100%" height="48px" />
          <Skeleton width="80%" height="14px" />
          <Skeleton width="65%" height="14px" />
          <Skeleton width="100%" height="120px" />
        </div>
      ) : (
        <FileDetails
          // A new file starts afresh: first tab, lists and comment folded.
          key={file.path}
          file={file}
          onOpenFolder={onOpenFolder}
          onSelectFile={onSelectFile}
          onShowCycle={onShowCycle}
          onRetryCode={onRetryCode}
          onOpenCode={onOpenCode}
          defaultTab={defaultTab}
          defaultExpanded={defaultExpanded}
          openLine={openLine}
        />
      )}
    </SheetFrame>
  )
}
