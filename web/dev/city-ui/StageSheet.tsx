import { FileSheet } from '../../src/screen/sheets/file/FileSheet'
import { FolderSheet } from '../../src/screen/sheets/folder/FolderSheet'
import { SELECTIONS, type Selection } from './stage-states'

interface StageSheetProps {
  selection: Selection | null
  open: boolean
  onClose: () => void
  onSelectFile: () => void
  onOpenFolder: () => void
}

export function StageSheet({
  selection,
  open,
  onClose,
  onSelectFile,
  onOpenFolder,
}: StageSheetProps) {
  // Nothing selected yet: a closed sheet waits off screen.
  const shown = SELECTIONS[selection ?? 'file']
  const noop = () => {}
  if ('file' in shown) {
    return (
      <FileSheet
        open={open && selection !== null}
        file={shown.file}
        loading={shown.loading}
        onClose={onClose}
        onOpenFolder={onOpenFolder}
        onSelectFile={onSelectFile}
        onShowCycle={noop}
        onCopyPath={noop}
        onCopyLink={noop}
        onRetryCode={noop}
        onShowImpact={noop}
        onFindPath={noop}
      />
    )
  }
  return (
    <FolderSheet
      open={open && selection !== null}
      folder={shown.folder}
      loading={shown.loading}
      onClose={onClose}
      onOpenFolder={onOpenFolder}
      onSelectFile={onSelectFile}
      onCopyLink={noop}
    />
  )
}
