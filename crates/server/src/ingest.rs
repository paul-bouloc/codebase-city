//! Ingestion: a commit's tarball, streamed from GitHub, becomes the files
//! the analyzer works on, without touching the disk.
//!
//! The download runs on the async runtime and hands its chunks to a
//! blocking thread that inflates and reads the archive. Every limit is
//! checked while the archive flows, and the first one crossed stops both.

use std::io::{self, Read};
use std::sync::Arc;
use std::time::Duration;

use analyzer::files::{
    self, Attributes, HEAD_BYTES, Language, LineCounter, Skip, SourceFile, Verdict,
};
use bytes::Bytes;
use flate2::read::GzDecoder;
use model::Ignored;
use tokio::sync::mpsc;
use tokio::time::Instant;

use crate::github::{GithubClient, GithubError, RepoName};

const MB: u64 = 1024 * 1024;

/// Chunks in flight between the download and the reader: a few megabytes.
const CHANNEL_CHUNKS: usize = 64;

/// How often, in files read, the reading progress is reported.
const PROGRESS_EVERY: u32 = 500;

/// The guards of one ingestion. The defaults come from measuring real
/// repositories, up to the Linux kernel.
#[derive(Debug, Clone)]
pub struct Limits {
    /// Size of the downloaded archive.
    pub archive_bytes: u64,
    /// Size of the archive once inflated.
    pub unpacked_bytes: u64,
    /// Larger files are counted in lines but their content is not kept.
    pub file_bytes: u64,
    /// Content kept in memory for the analyzer.
    pub kept_bytes: u64,
    /// Files whose content is kept.
    pub kept_files: u32,
    /// Entries of the archive, folders included.
    pub entries: u32,
    /// Time spent waiting for the archive, once GitHub starts sending it.
    /// The time the reader takes is not counted.
    pub download: Duration,
}

impl Default for Limits {
    fn default() -> Self {
        Self {
            archive_bytes: 512 * MB,
            unpacked_bytes: 2560 * MB,
            file_bytes: MB,
            kept_bytes: 400 * MB,
            kept_files: 50_000,
            entries: 250_000,
            download: Duration::from_secs(60),
        }
    }
}

/// Where an ingestion stands.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Progress {
    /// GitHub limits our requests; the download resumes after this wait.
    WaitingForGithub(Duration),
    /// Bytes of the archive received so far.
    Downloading { bytes: u64 },
    /// Files read so far, kept as buildings or skipped.
    Reading { kept: u32, skipped: u32 },
}

pub type OnProgress = Arc<dyn Fn(Progress) + Send + Sync>;

/// The files of a commit, ready for the analyzer.
#[derive(Debug)]
pub struct Ingested {
    pub files: Vec<SourceFile>,
    pub ignored: Ignored,
    pub archive_bytes: u64,
    pub unpacked_bytes: u64,
    /// Content kept in memory, the sum of the files' `content`.
    pub kept_bytes: u64,
}

#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum IngestError {
    #[error(transparent)]
    Github(#[from] GithubError),
    #[error("the archive is larger than {limit} bytes")]
    ArchiveTooLarge { limit: u64 },
    #[error("the unpacked archive is larger than {limit} bytes")]
    UnpackedTooLarge { limit: u64 },
    #[error("the kept content is larger than {limit} bytes")]
    KeptTooLarge { limit: u64 },
    #[error("more than {limit} files to analyze")]
    TooManyFiles { limit: u32 },
    #[error("more than {limit} entries in the archive")]
    TooManyEntries { limit: u32 },
    #[error("the archive did not arrive within {limit:?}")]
    DownloadTimeout { limit: Duration },
    #[error("the archive is not a valid tar.gz: {0}")]
    InvalidArchive(String),
    #[error("the archive reader stopped unexpectedly")]
    ReaderFailed,
}

/// Downloads and reads the archive of `sha`.
pub async fn ingest(
    client: &GithubClient,
    repo: &RepoName,
    sha: &str,
    limits: &Limits,
    on_progress: OnProgress,
) -> Result<Ingested, IngestError> {
    let on_wait = |wait| on_progress(Progress::WaitingForGithub(wait));
    let response = client.tarball(repo, sha, &on_wait).await?;

    let (sender, receiver) = mpsc::channel(CHANNEL_CHUNKS);
    let reader_limits = limits.clone();
    let reader_progress = Arc::clone(&on_progress);
    let reading = tokio::task::spawn_blocking(move || {
        unpack(
            ChannelReader::new(receiver),
            &reader_limits,
            &*reader_progress,
        )
    });

    let downloaded = download(response, sender, limits, &*on_progress).await;
    // The reader ends once the sender is dropped, or earlier on a limit.
    let unpacked = reading.await.map_err(|_| IngestError::ReaderFailed)?;
    let archive_bytes = downloaded?;
    Ok(Ingested {
        archive_bytes,
        ..unpacked?
    })
}

/// Sends the archive's chunks to the reader. Stops early, without error,
/// when the reader has stopped.
///
/// The download limit counts the time spent waiting for GitHub only: while
/// the reader is busy and the channel full, the archive is not late.
async fn download(
    mut response: reqwest::Response,
    sender: mpsc::Sender<Bytes>,
    limits: &Limits,
    on_progress: &(dyn Fn(Progress) + Sync),
) -> Result<u64, IngestError> {
    let mut waited = Duration::ZERO;
    let mut received = 0u64;
    loop {
        let started = Instant::now();
        let left = limits.download.saturating_sub(waited);
        let chunk = match tokio::time::timeout(left, response.chunk()).await {
            Err(_) => {
                return Err(IngestError::DownloadTimeout {
                    limit: limits.download,
                });
            }
            Ok(Err(_)) => return Err(GithubError::Unavailable.into()),
            Ok(Ok(None)) => return Ok(received),
            Ok(Ok(Some(chunk))) => chunk,
        };
        waited += started.elapsed();
        received += chunk.len() as u64;
        if received > limits.archive_bytes {
            return Err(IngestError::ArchiveTooLarge {
                limit: limits.archive_bytes,
            });
        }
        on_progress(Progress::Downloading { bytes: received });
        if sender.send(chunk).await.is_err() {
            return Ok(received);
        }
    }
}

/// Inflates and reads the archive. Runs on a blocking thread.
fn unpack(
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
    };
    *counter = counter.saturating_add(1);
}

fn reading(kept: u32, ignored: &Ignored) -> Progress {
    Progress::Reading {
        kept,
        skipped: ignored
            .vendored
            .saturating_add(ignored.minified)
            .saturating_add(ignored.binary),
    }
}

/// Reads the chunks sent by the download, blocking while none is there.
struct ChannelReader {
    receiver: mpsc::Receiver<Bytes>,
    chunk: Bytes,
}

impl ChannelReader {
    fn new(receiver: mpsc::Receiver<Bytes>) -> Self {
        Self {
            receiver,
            chunk: Bytes::new(),
        }
    }
}

impl Read for ChannelReader {
    fn read(&mut self, out: &mut [u8]) -> io::Result<usize> {
        while self.chunk.is_empty() {
            match self.receiver.blocking_recv() {
                Some(chunk) => self.chunk = chunk,
                None => return Ok(0),
            }
        }
        let read = out.len().min(self.chunk.len());
        out[..read].copy_from_slice(&self.chunk.split_to(read));
        Ok(read)
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
