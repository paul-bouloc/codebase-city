//! Ingestion: a commit's tarball, streamed from GitHub, becomes the files
//! the analyzer works on, without touching the disk.
//!
//! The download runs on the async runtime and hands its chunks to a
//! blocking thread that inflates and reads the archive. Every limit is
//! checked while the archive flows, and the first one crossed stops both.

mod archive;

use std::io::{self, Read};
use std::sync::Arc;
use std::time::Duration;

use analyzer::files::SourceFile;
use bytes::Bytes;
use model::Ignored;
use tokio::sync::mpsc;
use tokio::time::Instant;

use crate::github::{GithubClient, GithubError, RepoName};
use archive::unpack;

const MB: u64 = 1024 * 1024;

/// Chunks in flight between the download and the reader: a few megabytes.
const CHANNEL_CHUNKS: usize = 64;

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

/// Reads a gzipped tarball shaped like GitHub's (every file under one
/// top folder), with the same limits as a download: for tools that work
/// on a local copy. Blocks: call it off the async runtime.
pub fn ingest_archive(
    archive: impl Read,
    archive_bytes: u64,
    limits: &Limits,
    on_progress: &dyn Fn(Progress),
) -> Result<Ingested, IngestError> {
    if archive_bytes > limits.archive_bytes {
        return Err(IngestError::ArchiveTooLarge {
            limit: limits.archive_bytes,
        });
    }
    Ok(Ingested {
        archive_bytes,
        ..unpack(archive, limits, on_progress)?
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
