//! Sorting the files of a repository before analysis: which are skipped,
//! which are generated, which language each one is in.
//!
//! The rules follow GitHub Linguist where it matters for a map of the code:
//! vendored, minified and binary files are skipped, generated files are kept
//! but marked. Classification runs in two steps so a caller reading an
//! archive can skip a file from its path alone, before reading its bytes.

mod attributes;

pub use attributes::{Attribute, Attributes};

/// The language of a file, from its name.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Language {
    TypeScript,
    JavaScript,
    Python,
    Go,
    /// Not analyzed: shown as a building, counted in lines. Holds the name
    /// shown to the user, `"Other"` when the extension is unknown.
    Other(&'static str),
}

impl Language {
    pub fn of(path: &str) -> Self {
        let name = file_name(path);
        match name {
            "Dockerfile" => return Self::Other("Dockerfile"),
            "Makefile" | "GNUmakefile" => return Self::Other("Makefile"),
            _ => {}
        }
        match extension(name).to_ascii_lowercase().as_str() {
            "ts" | "tsx" | "mts" | "cts" => Self::TypeScript,
            "js" | "jsx" | "mjs" | "cjs" => Self::JavaScript,
            "py" | "pyi" => Self::Python,
            "go" => Self::Go,
            "md" | "markdown" | "mdx" => Self::Other("Markdown"),
            "json" | "jsonc" => Self::Other("JSON"),
            "yaml" | "yml" => Self::Other("YAML"),
            "toml" => Self::Other("TOML"),
            "css" => Self::Other("CSS"),
            "scss" | "sass" => Self::Other("SCSS"),
            "less" => Self::Other("Less"),
            "html" | "htm" => Self::Other("HTML"),
            "vue" => Self::Other("Vue"),
            "svelte" => Self::Other("Svelte"),
            "sh" | "bash" | "zsh" => Self::Other("Shell"),
            "c" | "h" => Self::Other("C"),
            "cc" | "cpp" | "cxx" | "hh" | "hpp" | "hxx" => Self::Other("C++"),
            "rs" => Self::Other("Rust"),
            "java" => Self::Other("Java"),
            "kt" | "kts" => Self::Other("Kotlin"),
            "swift" => Self::Other("Swift"),
            "rb" => Self::Other("Ruby"),
            "php" => Self::Other("PHP"),
            "cs" => Self::Other("C#"),
            "sql" => Self::Other("SQL"),
            "xml" => Self::Other("XML"),
            "svg" => Self::Other("SVG"),
            "proto" => Self::Other("Protocol Buffers"),
            "txt" | "rst" => Self::Other("Text"),
            _ => Self::Other("Other"),
        }
    }

    pub const fn name(self) -> &'static str {
        match self {
            Self::TypeScript => "TypeScript",
            Self::JavaScript => "JavaScript",
            Self::Python => "Python",
            Self::Go => "Go",
            Self::Other(name) => name,
        }
    }

    /// Whether the analyzer parses this language.
    pub const fn is_analyzed(self) -> bool {
        !matches!(self, Self::Other(_))
    }
}

/// A file of the repository, as the analyzer receives it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SourceFile {
    /// Path from the repository root, with `/` separators.
    pub path: String,
    pub language: Language,
    pub lines: u32,
    pub generated: bool,
    /// The bytes, only when [`keeps_content`] says the analyzer needs them
    /// and the file is not too large.
    pub content: Option<Vec<u8>>,
}

/// Why a file is left out of the city.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Skip {
    /// Third-party code or build output copied into the repository.
    Vendored,
    Minified,
    Binary,
}

/// What to do with a file.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Verdict {
    Skip(Skip),
    Keep { generated: bool },
}

/// Folders whose content is third-party code or build output.
const VENDORED_DIRS: &[&str] = &[
    "node_modules",
    "vendor",
    "vendors",
    "third_party",
    "third-party",
    "thirdparty",
    "bower_components",
    "jspm_packages",
    "Godeps",
    "dist",
    ".git",
    ".yarn",
    "__pycache__",
];

/// Folders whose files are generated, by convention.
const GENERATED_DIRS: &[&str] = &["generated", "gen"];

/// Lockfiles are written by package managers: Linguist counts them as generated.
const LOCKFILES: &[&str] = &[
    "package-lock.json",
    "npm-shrinkwrap.json",
    "yarn.lock",
    "pnpm-lock.yaml",
    "bun.lockb",
    "Cargo.lock",
    "go.sum",
    "poetry.lock",
    "Pipfile.lock",
    "uv.lock",
    "composer.lock",
    "Gemfile.lock",
];

const GENERATED_SUFFIXES: &[&str] = &[
    ".map",
    "_pb2.py",
    "_pb2.pyi",
    "_pb2_grpc.py",
    ".pb.go",
    ".pb.cc",
    ".pb.h",
];

const MINIFIED_SUFFIXES: &[&str] = &[".min.js", ".min.css", "-min.js"];

const BINARY_EXTENSIONS: &[&str] = &[
    "png", "jpg", "jpeg", "gif", "bmp", "ico", "icns", "webp", "avif", "tif", "tiff", "psd",
    "heic", "woff", "woff2", "ttf", "otf", "eot", "zip", "gz", "tgz", "bz2", "xz", "7z", "rar",
    "jar", "war", "tar", "zst", "pdf", "mp3", "mp4", "wav", "ogg", "webm", "mov", "avi", "flac",
    "m4a", "aac", "exe", "dll", "so", "dylib", "a", "o", "obj", "lib", "bin", "wasm", "pyc",
    "class", "fbx", "glb", "hdr", "exr", "ktx2", "basis", "drc", "3ds", "blend", "dds", "db",
    "sqlite", "npy", "npz", "pkl", "swf", "xcf", "jks", "keystore", "der", "p12", "mo",
];

/// Configuration files whose content import resolution needs, although
/// their language is not analyzed.
const MANIFESTS: &[&str] = &[
    "package.json",
    "jsconfig.json",
    "go.mod",
    "go.work",
    "pyproject.toml",
    "setup.cfg",
];

/// How many bytes from the start of a file [`classify_content`] needs.
pub const HEAD_BYTES: usize = 8000;

/// Average line length above which JavaScript or CSS counts as minified.
const MINIFIED_LINE_LENGTH: u64 = 110;

/// Classifies a file from its path alone. A file kept here may still be
/// skipped by [`classify_content`].
pub fn classify_path(path: &str) -> Verdict {
    let (dirs, name) = split_path(path);
    let mut dirs = dirs.split('/');
    if dirs.clone().any(|dir| VENDORED_DIRS.contains(&dir)) {
        return Verdict::Skip(Skip::Vendored);
    }
    let lower = name.to_ascii_lowercase();
    if MINIFIED_SUFFIXES
        .iter()
        .any(|suffix| lower.ends_with(suffix))
    {
        return Verdict::Skip(Skip::Minified);
    }
    if BINARY_EXTENSIONS.contains(&extension(&lower)) {
        return Verdict::Skip(Skip::Binary);
    }
    let generated = dirs.any(|dir| GENERATED_DIRS.contains(&dir))
        || LOCKFILES.contains(&name)
        || lower.contains(".generated.")
        || GENERATED_SUFFIXES
            .iter()
            .any(|suffix| lower.ends_with(suffix));
    Verdict::Keep { generated }
}

/// Classifies a file from its content: `head` is its first [`HEAD_BYTES`]
/// bytes (or all of it), `bytes` and `lines` its full size.
pub fn classify_content(language: Language, head: &[u8], bytes: u64, lines: u32) -> Verdict {
    let head = &head[..head.len().min(HEAD_BYTES)];
    if head.contains(&0) {
        return Verdict::Skip(Skip::Binary);
    }
    let minifiable = matches!(language, Language::JavaScript | Language::Other("CSS"));
    if minifiable && bytes > 1000 && bytes / u64::from(lines.max(1)) > MINIFIED_LINE_LENGTH {
        return Verdict::Skip(Skip::Minified);
    }
    Verdict::Keep {
        generated: has_generated_header(head),
    }
}

/// Whether the analyzer needs the file's content, and not only its size.
pub fn keeps_content(path: &str) -> bool {
    let name = file_name(path);
    Language::of(path).is_analyzed()
        || MANIFESTS.contains(&name)
        || (name.starts_with("tsconfig") && name.ends_with(".json"))
}

/// The Go convention (`// Code generated … DO NOT EDIT.` before the package
/// clause) and the `@generated` marker in the first 5 lines.
fn has_generated_header(head: &[u8]) -> bool {
    let text = String::from_utf8_lossy(head);
    let text = text.strip_prefix('\u{feff}').unwrap_or(&text);
    let lines = text.lines();
    lines
        .clone()
        .take(5)
        .any(|line| line.contains("@generated"))
        // A generator may hold the marker in a template, after its own package clause
        || lines
            .take_while(|line| !line.starts_with("package "))
            .any(|line| line.starts_with("// Code generated") && line.contains("DO NOT EDIT"))
}

/// Counts lines over chunks: the last line counts even without a final newline.
#[derive(Debug, Clone, Copy, Default)]
pub struct LineCounter {
    newlines: u32,
    open_line: bool,
}

impl LineCounter {
    pub fn feed(&mut self, chunk: &[u8]) {
        let Some(&last) = chunk.last() else { return };
        let newlines = chunk.iter().filter(|&&byte| byte == b'\n').count();
        self.newlines = self
            .newlines
            .saturating_add(crate::saturating_u32(newlines));
        self.open_line = last != b'\n';
    }

    pub fn lines(self) -> u32 {
        self.newlines.saturating_add(u32::from(self.open_line))
    }
}

pub fn count_lines(content: &[u8]) -> u32 {
    let mut counter = LineCounter::default();
    counter.feed(content);
    counter.lines()
}

/// The folder and the name of a path; the folder is `""` at the root.
pub fn split_path(path: &str) -> (&str, &str) {
    path.rsplit_once('/').unwrap_or(("", path))
}

fn file_name(path: &str) -> &str {
    split_path(path).1
}

/// Extension without the dot; empty for none and for dotfiles like `.env`.
fn extension(name: &str) -> &str {
    match name.rfind('.') {
        Some(dot) if dot > 0 => &name[dot + 1..],
        _ => "",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const KEEP: Verdict = Verdict::Keep { generated: false };
    const GENERATED: Verdict = Verdict::Keep { generated: true };

    #[test]
    fn languages_come_from_the_extension() {
        assert_eq!(Language::of("src/app.tsx"), Language::TypeScript);
        assert_eq!(Language::of("lib/index.mjs"), Language::JavaScript);
        assert_eq!(Language::of("pkg/stubs.pyi"), Language::Python);
        assert_eq!(Language::of("cmd/main.go"), Language::Go);
        assert_eq!(Language::of("README.MD"), Language::Other("Markdown"));
        assert_eq!(
            Language::of("build/Dockerfile"),
            Language::Other("Dockerfile")
        );
        assert_eq!(Language::of("LICENSE"), Language::Other("Other"));
        assert_eq!(Language::of(".env"), Language::Other("Other"));
    }

    #[test]
    fn only_the_four_mvp_languages_are_analyzed() {
        assert!(Language::TypeScript.is_analyzed());
        assert!(Language::Go.is_analyzed());
        assert!(!Language::of("main.c").is_analyzed());
        assert_eq!(Language::of("main.c").name(), "C");
    }

    #[test]
    fn vendored_folders_are_skipped_at_any_depth() {
        let vendored = Verdict::Skip(Skip::Vendored);
        assert_eq!(classify_path("node_modules/react/index.js"), vendored);
        assert_eq!(classify_path("web/node_modules/a.js"), vendored);
        assert_eq!(classify_path("pkg/vendor/github.com/x/y.go"), vendored);
        assert_eq!(classify_path("dist/bundle.js"), vendored);
        // A file named like a vendored folder is not one.
        assert_eq!(classify_path("src/vendor.ts"), KEEP);
        assert_eq!(classify_path("src/distance.ts"), KEEP);
    }

    #[test]
    fn minified_and_binary_names_are_skipped() {
        assert_eq!(
            classify_path("public/jquery.min.js"),
            Verdict::Skip(Skip::Minified)
        );
        assert_eq!(
            classify_path("assets/Logo.PNG"),
            Verdict::Skip(Skip::Binary)
        );
        assert_eq!(
            classify_path("locale/fr/django.mo"),
            Verdict::Skip(Skip::Binary)
        );
    }

    #[test]
    fn generated_files_are_kept_and_marked() {
        assert_eq!(classify_path("api/generated/client.ts"), GENERATED);
        assert_eq!(classify_path("internal/gen/types.go"), GENERATED);
        assert_eq!(classify_path("proto/user_pb2.py"), GENERATED);
        assert_eq!(classify_path("proto/user.pb.go"), GENERATED);
        assert_eq!(classify_path("src/schema.generated.ts"), GENERATED);
        assert_eq!(classify_path("package-lock.json"), GENERATED);
        assert_eq!(classify_path("web/go.sum"), GENERATED);
        assert_eq!(classify_path("build/app.js.map"), GENERATED);
        assert_eq!(classify_path("src/generator.ts"), KEEP);
    }

    #[test]
    fn a_nul_byte_marks_a_binary() {
        assert_eq!(
            classify_content(Language::Other("Other"), b"ab\0cd", 5, 1),
            Verdict::Skip(Skip::Binary)
        );
    }

    #[test]
    fn long_lines_mark_minified_javascript_and_css_only() {
        let line = "a".repeat(5000);
        let minified = Verdict::Skip(Skip::Minified);
        assert_eq!(
            classify_content(Language::JavaScript, line.as_bytes(), 5000, 1),
            minified
        );
        assert_eq!(
            classify_content(Language::Other("CSS"), line.as_bytes(), 5000, 1),
            minified
        );
        assert_eq!(
            classify_content(Language::Python, line.as_bytes(), 5000, 1),
            KEEP
        );
        // A short file with one long line is not minified.
        assert_eq!(
            classify_content(Language::JavaScript, &line.as_bytes()[..900], 900, 1),
            KEEP
        );
    }

    #[test]
    fn generated_headers_mark_generated_files() {
        let go = b"// Code generated by protoc-gen-go. DO NOT EDIT.\n\npackage api\n";
        assert_eq!(classify_content(Language::Go, go, 60, 3), GENERATED);
        let marker = b"/**\n * This file is @generated by a script.\n */\nexport {}\n";
        assert_eq!(
            classify_content(Language::TypeScript, marker, 60, 4),
            GENERATED
        );
        let late = b"1\n2\n3\n4\n5\n// @generated\n";
        assert_eq!(classify_content(Language::TypeScript, late, 20, 6), KEEP);
    }

    #[test]
    fn the_go_marker_counts_before_the_package_clause_only() {
        let generator =
            b"package gen\n\nvar tmpl = `\n// Code generated by mytool. DO NOT EDIT.\npackage x`\n";
        assert_eq!(classify_content(Language::Go, generator, 90, 5), KEEP);
        let with_bom = "\u{feff}// Code generated by stringer. DO NOT EDIT.\n\npackage kind\n";
        assert_eq!(
            classify_content(Language::Go, with_bom.as_bytes(), 60, 3),
            GENERATED
        );
    }

    #[test]
    fn manifests_keep_their_content() {
        assert!(keeps_content("src/index.ts"));
        assert!(keeps_content("package.json"));
        assert!(keeps_content("apps/web/tsconfig.app.json"));
        assert!(keeps_content("go.mod"));
        assert!(!keeps_content("README.md"));
        assert!(!keeps_content("data/fixture.json"));
    }

    #[test]
    fn lines_count_over_chunks() {
        assert_eq!(count_lines(b""), 0);
        assert_eq!(count_lines(b"one"), 1);
        assert_eq!(count_lines(b"one\n"), 1);
        assert_eq!(count_lines(b"one\ntwo"), 2);
        let mut counter = LineCounter::default();
        counter.feed(b"one\ntw");
        counter.feed(b"");
        counter.feed(b"o\nthree");
        assert_eq!(counter.lines(), 3);
    }
}
