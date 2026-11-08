import { Badge } from '../../../ui/display/Badge'
import type { FileSheetData } from '../sheet-data'
import { RoleBadge } from './RoleBadge'

interface FileBadgesProps {
  file: FileSheetData
}

export function FileBadges({ file }: FileBadgesProps) {
  return (
    <>
      <Badge kind="language" language={file.language} name={file.languageName} />
      {!file.analyzed && <Badge kind="language" language="other" />}
      {file.roles.map(({ role, reason }) => (
        <RoleBadge key={role} fileRole={role} reason={reason} />
      ))}
    </>
  )
}
