import type { ReactNode } from 'react'
import { Button } from '../../../ui/actions/Button'
import { ExternalLink } from '../../../ui/actions/ExternalLink'
import { LinkButton } from '../../../ui/actions/LinkButton'
import { exactCount, percent } from '../../../ui/display/count-format'
import { ROLE_NAMES } from '../../../ui/display/role-names'
import { Icon } from '../../../ui/Icon'
import { safeGithubHref } from '../../github-links'
import { LanguageBar } from '../../legend/LanguageBar'
import { LANGUAGE_NAMES } from '../../legend/legend-content'
import { LanguageDot } from '../../parts/LanguageDot'
import { Skeleton } from '../../parts/Skeleton'
import { splitPath } from '../../parts/shorten-folder'
import { Breadcrumb } from '../Breadcrumb'
import { MetricPairs } from '../MetricPairs'
import { SheetFrame } from '../SheetFrame'
import { SheetSection } from '../SheetSection'
import type { FolderSheetData, IslandLink, KeyFile } from '../sheet-data'
import { UnanalyzedNote } from '../UnanalyzedNote'
import styles from './FolderSheet.module.css'
import { orderedLinks } from './island-links'

const compact = new Intl.NumberFormat('en-US', { notation: 'compact', maximumSignificantDigits: 3 })

const TEXT = {
  github: 'Open on GitHub',
  copyLink: 'Copy link to this folder',
  island: (layer: number, of: number) => `Island · layer ${layer} of ${of}`,
  // An island without production code stands on no layer.
  plainIsland: 'Island',
  // A folder that holds islands, without being one.
  plainFolder: 'Folder',
  parcel: (island: string) => `Folder · on ${island}`,
  tests: 'Tests · park',
  files: 'Files',
  lines: 'Lines',
  subFolders: 'Sub-folders',
  languages: 'Languages',
  keyFiles: 'Key files',
  links: 'Links with other islands',
  readme: 'From its README',
  readMore: 'Read the whole README on GitHub',
  likely: '· likely',
  mostImported: (count: number) => `most imported here · ${exactCount(count)}`,
  mostComplex: (value: number) => `most complex here · ${exactCount(value)}`,
  importsFrom: 'imports from',
  importedBy: 'imported by',
  upward: '· upward',
  imports: (count: number) => `${exactCount(count)} ${count === 1 ? 'import' : 'imports'}`,
  loading: 'Loading folder details',
  unanalyzedTitle: 'Nothing in this folder is analyzed yet.',
  unanalyzedBody:
    'Its files keep only their lines, size and code, with no imports between them. They stand in raw concrete in the city.',
}

interface FolderSheetProps {
  open: boolean
  folder: FolderSheetData
  loading?: boolean
  onClose: () => void
  onOpenFolder: (path: string) => void
  onSelectFile: (path: string) => void
  onCopyLink: () => void
}

// An island, a parcel or the test park. No analysis actions here: impact and paths are defined
// for files only.
export function FolderSheet({
  open,
  folder,
  loading = false,
  onClose,
  onOpenFolder,
  onSelectFile,
  onCopyLink,
}: FolderSheetProps) {
  const { folder: parent, name } = splitPath(folder.path)
  const parents = parent.split('/').filter(Boolean)
  const githubHref = safeGithubHref(folder.githubUrl)
  const readmeHref = safeGithubHref(folder.readme?.url)

  const actions = (
    <>
      {githubHref && (
        <LinkButton href={githubHref} icon="external" newTab>
          {TEXT.github}
        </LinkButton>
      )}
      <Button
        iconOnly
        icon="link"
        label={TEXT.copyLink}
        title={TEXT.copyLink}
        onClick={onCopyLink}
      />
    </>
  )

  return (
    <SheetFrame
      open={open}
      onClose={onClose}
      breadcrumb={<Breadcrumb folders={parents} onOpenFolder={onOpenFolder} />}
      icon="folder"
      tone="neutral"
      title={`${name}/`}
      subtitle={subtitle(folder.kind)}
      actions={actions}
      busy={loading}
      busyLabel={TEXT.loading}
      contentKey={folder.path}
    >
      {loading ? (
        <div className={styles.loading}>
          <Skeleton width="100%" height="48px" />
          <Skeleton width="100%" height="10px" />
          <Skeleton width="100%" height="140px" />
        </div>
      ) : (
        <>
          {!folder.analyzed && (
            <UnanalyzedNote title={TEXT.unanalyzedTitle} body={TEXT.unanalyzedBody} />
          )}

          <MetricPairs
            columns={3}
            metrics={[
              { label: TEXT.files, value: exactCount(folder.files) },
              { label: TEXT.lines, value: compact.format(folder.lines).toLowerCase() },
              { label: TEXT.subFolders, value: exactCount(folder.subFolders) },
            ]}
          />

          {folder.languages.length > 0 && (
            <SheetSection title={TEXT.languages}>
              <LanguageBar languages={folder.languages} />
              <ul className={styles.inline}>
                {folder.languages.map(({ language, share }) => (
                  <li key={language} className={styles.inlineItem}>
                    <LanguageDot language={language} size={8} />
                    {LANGUAGE_NAMES[language]}
                    <span className={styles.secondary}>{percent(share)}</span>
                  </li>
                ))}
              </ul>
            </SheetSection>
          )}

          {folder.analyzed && folder.keyFiles.length > 0 && (
            <SheetSection title={TEXT.keyFiles}>
              <ul className={styles.list}>
                {folder.keyFiles.map((file) => (
                  <li key={file.path}>
                    <KeyFileRow
                      file={file}
                      folderPath={folder.path}
                      onSelect={() => onSelectFile(file.path)}
                    />
                  </li>
                ))}
              </ul>
            </SheetSection>
          )}

          {folder.analyzed && folder.links.length > 0 && (
            <SheetSection title={TEXT.links}>
              <ul className={styles.list}>
                {orderedLinks(folder.links).map((link) => (
                  <li
                    key={`${link.direction}-${link.islandPath}-${link.upward}`}
                    className={link.upward ? `${styles.link} ${styles.upward}` : styles.link}
                  >
                    <span className={`${styles.trait} ${styles[traitClass(link)]}`} />
                    <span className={styles.linkText}>
                      {link.direction === 'imports' ? TEXT.importsFrom : TEXT.importedBy}{' '}
                      <button
                        type="button"
                        className={styles.island}
                        onClick={() => onOpenFolder(link.islandPath)}
                      >
                        {link.island}
                      </button>
                      {link.upward && ` ${TEXT.upward}`}
                    </span>
                    <span className={styles.count}>{TEXT.imports(link.count)}</span>
                  </li>
                ))}
              </ul>
            </SheetSection>
          )}

          {folder.readme && (
            <SheetSection title={TEXT.readme}>
              <p className={styles.readme}>{folder.readme.text}</p>
              {readmeHref && (
                <ExternalLink className={styles.readMore} href={readmeHref}>
                  {TEXT.readMore}
                </ExternalLink>
              )}
            </SheetSection>
          )}
        </>
      )}
    </SheetFrame>
  )
}

function subtitle(kind: FolderSheetData['kind']): string {
  if (kind === 'island') {
    return TEXT.plainIsland
  }
  if (kind === 'folder') {
    return TEXT.plainFolder
  }
  if (kind === 'tests') {
    return TEXT.tests
  }
  return 'island' in kind
    ? TEXT.island(kind.island.layer, kind.island.of)
    : TEXT.parcel(kind.parcel.island)
}

function traitClass(link: IslandLink): 'upwardTrait' | 'incoming' | 'outgoing' {
  if (link.upward) {
    return 'upwardTrait'
  }
  return link.direction === 'imports' ? 'outgoing' : 'incoming'
}

function KeyFileRow({
  file,
  folderPath,
  onSelect,
}: {
  file: KeyFile
  folderPath: string
  onSelect: () => void
}) {
  const { folder, name } = splitPath(file.path)
  // The folder is written from this one: `browser/widget/`.
  const relative = folder.startsWith(`${folderPath}/`)
    ? folder.slice(folderPath.length + 1)
    : folder
  let reason: ReactNode
  if ('role' in file.reason) {
    reason = (
      <>
        <Icon name={file.reason.role} size={14} />
        {ROLE_NAMES[file.reason.role]} {TEXT.likely}
      </>
    )
  } else if ('mostImported' in file.reason) {
    reason = TEXT.mostImported(file.reason.mostImported)
  } else {
    reason = TEXT.mostComplex(file.reason.mostComplex)
  }
  return (
    <button type="button" className={styles.keyFile} title={file.path} onClick={onSelect}>
      <span className={styles.names}>
        <span className={styles.name}>{name}</span>
        {relative && <span className={styles.folder}>{relative}</span>}
      </span>
      <span className={styles.reason}>{reason}</span>
    </button>
  )
}
