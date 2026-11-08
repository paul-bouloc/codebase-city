//! Reading the archive: inflating it, sorting its files, and keeping the
//! content the analyzer needs, within the limits.

use std::io::{self, Read};

use analyzer::files::{
    self, Attributes, HEAD_BYTES, Language, LineCounter, Skip, SourceFile, Verdict,
};
use flate2::read::GzDecoder;
use model::Ignored;

use super::{IngestError, Ingested, Limits, Progress};

/// How often, in files read, the reading progress is reported.
const PROGRESS_EVERY: u32 = 500;

/// Inflates and reads the archive. Runs on a blocking thread.
pub(super) fn unpack(
    reader: impl Read,
    limits: &Limits,
    on_progress: &dyn Fn(Progress),
) -> Result<Ingested, IngestError> {
    let counted = CountingReader {
        inner: GzDecoder::new(reader),
        count: 0,
        limit: limits.unpacked_bytes,
        exceeded: false,
    };
    let mut archive = tar::Archive::new(counted);
    let read = read_entries(&mut archive, limits, on_progress);
    let counted = archive.into_inner();
    if counted.exceeded {
        return Err(IngestError::UnpackedTooLarge {
            limit: limits.unpacked_bytes,
        });
    }
    let mut ingested = read?;
    ingested.unpacked_bytes = counted.count;
    Ok(ingested)
}

fn read_entries<R: Read>(
    archive: &mut tar::Archive<R>,
    limits: &Limits,
    on_progress: &dyn Fn(Progress),
) -> Result<Ingested, IngestError> {
    let invalid = |error: io::Error| IngestError::InvalidArchive(error.to_string());
    let mut files = Vec::new();
    let mut ignored = Ignored::default();
    let mut attributes = Attributes::default();
    let mut entries = 0u32;
    let mut kept_files = 0u32;
    let mut kept_bytes = 0u64;
    let mut buffer = Vec::new();

    for entry in archive.entries().map_err(invalid)? {
        entries += 1;
        if entries > limits.entries {
            return Err(IngestError::TooManyEntries {
                limit: limits.entries,
            });
        }
        let mut entry = entry.map_err(invalid)?;
        if !entry.header().entry_type().is_file() {
            continue;
        }
        let Some(path) = repo_path(&entry.path_bytes()) else {
            continue;
        };
        let language = Language::of(&path);
        let path_generated = match files::classify_path(&path) {
            Verdict::Skip(skip) => {
                count(&mut ignored, skip);
                continue;
            }
            Verdict::Keep { generated } => generated,
        };

        let size = entry.size();
        let (verdict, lines, content) = if size <= limits.file_bytes {
            buffer.clear();
            entry.read_to_end(&mut buffer).map_err(invalid)?;
            let lines = files::count_lines(&buffer);
            let verdict = files::classify_content(language, &buffer, size, lines);
            (verdict, lines, Some(&buffer))
        } else {
            let (head, lines) = skim(&mut entry).map_err(invalid)?;
            let verdict = files::classify_content(language, &head, size, lines);
            (verdict, lines, None)
        };
        let content_generated = match verdict {
            Verdict::Skip(skip) => {
                count(&mut ignored, skip);
                continue;
            }
            Verdict::Keep { generated } => generated,
        };

        if let Some(content) = content
            && let (dir, ".gitattributes") = files::split_path(&path)
        {
            attributes.add(dir, content);
        }
        // Rules already read drop vendored files before they count against
        // the limits; the pass at the end covers the rules that come later
        if !attributes.is_empty() && attributes.lookup(&path).vendored == Some(true) {
            count(&mut ignored, Skip::Vendored);
            continue;
        }
        let content = content.filter(|_| files::keeps_content(&path)).cloned();
        if let Some(content) = &content {
            kept_files += 1;
            kept_bytes += content.len() as u64;
            if kept_files > limits.kept_files {
                return Err(IngestError::TooManyFiles {
                    limit: limits.kept_files,
                });
            }
            if kept_bytes > limits.kept_bytes {
                return Err(IngestError::KeptTooLarge {
                    limit: limits.kept_bytes,
                });
            }
        }
        files.push(SourceFile {
            path,
            language,
            lines,
            generated: path_generated || content_generated,
            content,
        });

        let read = u32::try_from(files.len()).unwrap_or(u32::MAX);
        if read % PROGRESS_EVERY == 0 {
            on_progress(reading(read, &ignored));
        }
    }

    // A `.gitattributes` file may come after the files it covers.
    if !attributes.is_empty() {
        files.retain_mut(|file| {
            let attribute = attributes.lookup(&file.path);
            if attribute.vendored == Some(true) {
                count(&mut ignored, Skip::Vendored);
                kept_bytes -= file
                    .content
                    .as_ref()
                    .map_or(0, |content| content.len() as u64);
                return false;
            }
            if let Some(generated) = attribute.generated {
                file.generated = generated;
            }
            true
        });
    }
    on_progress(reading(
        u32::try_from(files.len()).unwrap_or(u32::MAX),
        &ignored,
    ));

    Ok(Ingested {
        files,
        ignored,
        archive_bytes: 0,
        unpacked_bytes: 0,
        kept_bytes,
    })
}

/// The path inside the repository: GitHub puts every file under an
/// `owner-repo-sha/` folder. Paths that are not plain UTF-8 relative paths
/// are dropped.
fn repo_path(raw: &[u8]) -> Option<String> {
    let path = std::str::from_utf8(raw).ok()?;
    let (_, path) = path.split_once('/')?;
    let plain = !path.is_empty()
        && path
            .split('/')
            .all(|part| !part.is_empty() && part != "." && part != "..");
    plain.then(|| path.to_owned())
}

/// Reads a file too large to keep: its first bytes and its line count.
fn skim(file: &mut impl Read) -> io::Result<(Vec<u8>, u32)> {
    let mut head = Vec::with_capacity(HEAD_BYTES);
    let mut lines = LineCounter::default();
    let mut chunk = vec![0; 64 * 1024];
    loop {
        let read = file.read(&mut chunk)?;
        if read == 0 {
            return Ok((head, lines.lines()));
        }
        let chunk = &chunk[..read];
        let missing = HEAD_BYTES.saturating_sub(head.len());
        head.extend_from_slice(&chunk[..missing.min(read)]);
        lines.feed(chunk);
    }
}

fn count(ignored: &mut Ignored, skip: Skip) {
    let counter = match skip {
        Skip::Vendored => &mut ignored.vendored,
        Skip::Minified => &mut ignored.minified,
        Skip::Binary => &mut ignored.binary,
        Skip::TooDeep => &mut ignored.deep,
    };
    *counter = counter.saturating_add(1);
}

fn reading(kept: u32, ignored: &Ignored) -> Progress {
    Progress::Reading {
        kept,
        skipped: ignored.total(),
    }
}

/// Counts the inflated bytes and fails past the limit. The flag tells this
/// failure apart from a corrupt archive once the tar reader has wrapped it.
struct CountingReader<R> {
    inner: R,
    count: u64,
    limit: u64,
    exceeded: bool,
}

impl<R: Read> Read for CountingReader<R> {
    fn read(&mut self, out: &mut [u8]) -> io::Result<usize> {
        let read = self.inner.read(out)?;
        self.count += read as u64;
        if self.count > self.limit {
            self.exceeded = true;
            return Err(io::Error::other("unpacked size limit exceeded"));
        }
        Ok(read)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_archive_folder_is_stripped() {
        assert_eq!(
            repo_path(b"acme-harbor-1a2b3c4/src/main.ts").as_deref(),
            Some("src/main.ts")
        );
        assert_eq!(repo_path(b"acme-harbor-1a2b3c4/"), None);
        assert_eq!(repo_path(b"pax_global_header"), None);
        assert_eq!(repo_path(b"root/a/../b.ts"), None);
        assert_eq!(repo_path(b"root/a//b.ts"), None);
        assert_eq!(repo_path(b"root/\xff.ts"), None);
    }

    #[test]
    fn skimming_keeps_the_head_and_counts_lines() {
        let content = "line\n".repeat(10_000);
        let (head, lines) = skim(&mut content.as_bytes()).unwrap();
        assert_eq!(head.len(), HEAD_BYTES);
        assert_eq!(lines, 10_000);
    }
}
