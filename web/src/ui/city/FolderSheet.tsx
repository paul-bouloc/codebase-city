import type { ReactNode } from 'react'
import { Button } from '../Button'
import { Icon } from '../Icon'
import { LinkButton } from '../LinkButton'
import { Breadcrumb } from './Breadcrumb'
import styles from './FolderSheet.module.css'
import { orderedLinks } from './island-links'
import { LanguageBar } from './LanguageBar'
import { formatShare, LANGUAGE_NAMES } from './legend-content'
import { MetricPairs } from './MetricPairs'
import { ROLE_NAMES } from './role-names'
import { SheetFrame } from './SheetFrame'
import { Skeleton } from './Skeleton'
import type { FolderSheetData, IslandLink, KeyFile } from './sheet-data'
import { splitPath } from './shorten-folder'

const numbers = new Intl.NumberFormat('en-US')
const compact = new Intl.NumberFormat('en-US', { notation: 'compact', maximumSignificantDigits: 3 })

const TEXT = {
  github: 'Open on GitHub',
  copyLink: 'Copy link to this folder',
  island: (layer: number, of: number) => `Island · layer ${layer} of ${of}`,
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
  mostImported: (count: number) => `most imported here · ${numbers.format(count)}`,
  mostComplex: (value: number) => `most complex here · ${numbers.format(value)}`,
  importsFrom: 'imports from',
  importedBy: 'imported by',
  upward: '· upward',
  imports: (count: number) => `${numbers.format(count)} ${count === 1 ? 'import' : 'imports'}`,
  loading: 'Loading folder details',
  unanalyzedTitle: 'Nothing in this folder is analyzed yet.',
  unanalyzedBody:
    ' Its files keep only their lines, size and code, with no imports between them. They stand in raw concrete in the city.',
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

  const actions = (
    <>
      <LinkButton href={folder.githubUrl} icon="external">
        {TEXT.github}
      </LinkButton>
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
      contentKey={folder.path}
    >
      {loading ? (
        <div className={styles.loading} role="status">
          <span className="visually-hidden">{TEXT.loading}</span>
          <Skeleton width="100%" height="48px" />
          <Skeleton width="100%" height="10px" />
          <Skeleton width="100%" height="140px" />
        </div>
      ) : (
        <>
          {!folder.analyzed && (
            <p className={styles.unanalyzed}>
              <Icon name="info" size={20} className={styles.unanalyzedIcon} />
              <span>
                <strong>{TEXT.unanalyzedTitle}</strong>
                {TEXT.unanalyzedBody}
              </span>
            </p>
          )}

          <MetricPairs
            columns={3}
            metrics={[
              { label: TEXT.files, value: numbers.format(folder.files) },
              { label: TEXT.lines, value: compact.format(folder.lines).toLowerCase() },
              { label: TEXT.subFolders, value: numbers.format(folder.subFolders) },
            ]}
          />

          {folder.languages.length > 0 && (
            <Section title={TEXT.languages}>
              <LanguageBar languages={folder.languages} />
              <ul className={styles.inline}>
                {folder.languages.map(({ language, share }) => (
                  <li key={language} className={styles.inlineItem}>
                    <span className={styles.dot} data-language={language} />
                    {LANGUAGE_NAMES[language]}
                    <span className={styles.secondary}>{formatShare(share)}</span>
                  </li>
                ))}
              </ul>
            </Section>
          )}

          {folder.analyzed && folder.keyFiles.length > 0 && (
            <Section title={TEXT.keyFiles}>
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
            </Section>
          )}

          {folder.analyzed && folder.links.length > 0 && (
            <Section title={TEXT.links}>
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
            </Section>
          )}

          {folder.readme && (
            <Section title={TEXT.readme}>
              <p className={styles.readme}>{folder.readme.text}</p>
              <a className={styles.readMore} href={folder.readme.url}>
                {TEXT.readMore}
              </a>
            </Section>
          )}
        </>
      )}
    </SheetFrame>
  )
}

function subtitle(kind: FolderSheetData['kind']): string {
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

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className={styles.section} aria-label={title}>
      <h3 className={styles.eyebrow}>{title}</h3>
      {children}
    </section>
  )
}
