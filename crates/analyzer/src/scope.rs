//! What part of the repository a file belongs to, from its path alone.
//!
//! Folders decide first, from the root down: `test/fixtures/a.js` is a test,
//! `examples/app.test.js` an example. A file in none of these folders is
//! then judged by its name (`*.spec.ts`, `conftest.py`, `vite.config.ts`).

use model::Scope;

use crate::files::split_path;

/// The scope of the file at `path`.
pub fn of(path: &str) -> Scope {
    let (dir, name) = split_path(path);
    of_dir(dir).unwrap_or_else(|| of_name(name))
}

/// The scope a folder gives the files under it; `None` when it gives none,
/// for the folder and all its ancestors.
pub fn of_dir(dir: &str) -> Option<Scope> {
    let mut in_src = false;
    for segment in dir.split('/').filter(|segment| !segment.is_empty()) {
        if let Some(scope) = of_segment(segment, in_src) {
            return Some(scope);
        }
        in_src |= segment == "src";
    }
    None
}

/// A folder name that sets the scope. `build`, `dist`, `out` and
/// `integration` under `src` are taken for modules of the code, not for
/// build output or integration tests.
fn of_segment(segment: &str, in_src: bool) -> Option<Scope> {
    let scope = match segment.to_ascii_lowercase().as_str() {
        "test" | "tests" | "__tests__" | "__test__" | "spec" | "specs" | "e2e" => Scope::Test,
        "integration" | "integration-tests" | "integration_tests" if !in_src => Scope::Test,
        "fixture" | "fixtures" | "__fixtures__" | "testdata" | "__mocks__" | "__snapshots__" => {
            Scope::Fixture
        }
        "example" | "examples" | "demo" | "demos" | "sample" | "samples" | "playground"
        | "docs_src" => Scope::Example,
        "doc" | "docs" | "documentation" => Scope::Docs,
        "bench" | "benches" | "benchmark" | "benchmarks" => Scope::Bench,
        "build" | "dist" | "out" if !in_src => Scope::Build,
        // `.github`, `.vscode`, `.husky`…
        _ if segment.starts_with('.') => Scope::Config,
        _ => return None,
    };
    Some(scope)
}

/// Tools configured by a `<tool>.config.*` file.
const TOOLS: &[&str] = &[
    "astro",
    "babel",
    "commitlint",
    "cypress",
    "docusaurus",
    "drizzle",
    "electron-builder",
    "esbuild",
    "eslint",
    "jest",
    "karma",
    "knip",
    "lint-staged",
    "next",
    "nuxt",
    "playwright",
    "postcss",
    "prettier",
    "release",
    "remix",
    "rollup",
    "rspack",
    "stylelint",
    "svelte",
    "tailwind",
    "tsup",
    "turbo",
    "unocss",
    "vite",
    "vitest",
    "vue",
    "webpack",
];

/// The scope of a file from its name, outside any folder that sets one.
fn of_name(name: &str) -> Scope {
    let lower = name.to_ascii_lowercase();
    let (stem, extension) = match lower.rsplit_once('.') {
        Some((stem, extension)) if !stem.is_empty() => (stem, extension),
        _ => (lower.as_str(), ""),
    };
    // `.eslintrc.js`, `.prettierrc`
    if lower.starts_with('.') {
        return Scope::Config;
    }
    let code = matches!(
        extension,
        "ts" | "tsx" | "mts" | "cts" | "js" | "jsx" | "mjs" | "cjs" | "py" | "go"
    );
    if code {
        // `store.test`, `store.spec.node`, `store.test-d`
        let tagged = |tags: &[&str]| {
            stem.split('.').skip(1).any(|part| {
                tags.iter().any(|tag| {
                    part.strip_prefix(tag)
                        .is_some_and(|rest| rest.is_empty() || rest.starts_with('-'))
                })
            })
        };
        if tagged(&["test", "spec", "e2e"])
            || stem.ends_with("_test")
            // Django puts an app's tests in `tests.py`
            || (extension == "py"
                && (stem.starts_with("test_") || matches!(stem, "conftest" | "tests")))
        {
            return Scope::Test;
        }
        // `vite.config.ts` configures a tool; `app.config.ts` is the app's
        let tool = stem.split('.').next().unwrap_or(stem);
        if (tagged(&["config"]) && TOOLS.contains(&tool))
            || matches!(stem, "gulpfile" | "gruntfile" | "jakefile")
            || (extension == "py" && matches!(stem, "setup" | "noxfile"))
        {
            return Scope::Config;
        }
        return Scope::Source;
    }
    // `LICENSE`, `LICENSE.APACHE`, `README`, and without an extension
    // `LICENSE-MIT`
    let base = match extension {
        "" => stem.split(['-', '_']).next().unwrap_or(stem),
        _ => stem,
    };
    if matches!(
        base,
        "readme"
            | "license"
            | "licence"
            | "copying"
            | "notice"
            | "authors"
            | "contributors"
            | "changelog"
            | "changes"
            | "history"
    ) {
        return Scope::Docs;
    }
    if extension == "txt" && stem.starts_with("requirements") {
        return Scope::Config;
    }
    match extension {
        "md" | "markdown" | "mdx" | "rst" | "adoc" | "txt" => Scope::Docs,
        "json" | "jsonc" | "json5" | "yaml" | "yml" | "toml" | "ini" | "cfg" | "lock" => {
            Scope::Config
        }
        _ if matches!(
            lower.as_str(),
            "dockerfile" | "makefile" | "gnumakefile" | "go.mod" | "go.sum" | "go.work"
        ) =>
        {
            Scope::Config
        }
        _ => Scope::Source,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scopes(paths: &[&str]) -> Vec<Scope> {
        paths.iter().map(|path| of(path)).collect()
    }

    #[test]
    fn test_folders_and_names_make_tests() {
        assert!(
            scopes(&[
                "test/app.js",
                "packages/core/__tests__/store.ts",
                "src/spec/view.ts",
                "e2e/login.ts",
                "integration/microservices/app.module.ts",
                "src/store.test.ts",
                "src/store.spec.tsx",
                "src/store.test-d.ts",
                "lib/app.e2e.js",
                "gin_test.go",
                "pkg/test_utils.py",
                "tests_util/conftest.py",
                "app_test.py",
                "polls/tests.py",
            ])
            .iter()
            .all(|&scope| scope == Scope::Test)
        );
    }

    #[test]
    fn fixtures_examples_docs_and_benchmarks_have_their_scope() {
        assert_eq!(
            scopes(&[
                "fixtures/repo/index.js",
                "pkg/testdata/a.go",
                "src/__mocks__/fs.ts",
                "examples/app/main.go",
                "docs_src/tutorial/main.py",
                "demo/index.html",
                "docs/guide.md",
                "documentation/conf.py",
                "LICENSE",
                "HISTORY.md",
                "NOTICE.txt",
                "LICENSE-MIT",
                "README",
                "benchmarks/parse.js",
                "packages/a/bench/run.ts",
            ]),
            [
                Scope::Fixture,
                Scope::Fixture,
                Scope::Fixture,
                Scope::Example,
                Scope::Example,
                Scope::Example,
                Scope::Docs,
                Scope::Docs,
                Scope::Docs,
                Scope::Docs,
                Scope::Docs,
                Scope::Docs,
                Scope::Docs,
                Scope::Bench,
                Scope::Bench,
            ]
        );
    }

    #[test]
    fn the_first_folder_from_the_root_wins() {
        assert_eq!(
            scopes(&[
                "test/fixtures/a.js",
                "examples/app.test.js",
                "fixtures/tests/a.js"
            ]),
            [Scope::Test, Scope::Example, Scope::Fixture]
        );
    }

    #[test]
    fn build_output_and_tooling_are_build() {
        assert_eq!(
            scopes(&[
                "build/three.module.js",
                "build/gulpfile.vscode.js",
                "packages/core/dist/index.js",
                "out/main.js",
                // A module of the code that happens to be called `build`
                "src/build/index.ts",
                "src/vs/build/helper.ts",
                "src/integration/slack.ts",
                "src/out/channel.ts",
                "packages/a/src/dist/format.ts",
            ]),
            [
                Scope::Build,
                Scope::Build,
                Scope::Build,
                Scope::Build,
                Scope::Source,
                Scope::Source,
                Scope::Source,
                Scope::Source,
                Scope::Source,
            ]
        );
    }

    #[test]
    fn configuration_files_are_config() {
        assert!(
            scopes(&[
                "package.json",
                "tsconfig.base.json",
                "vite.config.ts",
                "vitest.config.unit.ts",
                "webpack.config.prod.js",
                "packages/a/jest.config.js",
                "eslint.config.mjs",
                "gulpfile.js",
                "setup.py",
                "go.mod",
                "Dockerfile",
                "Makefile",
                ".eslintrc.js",
                ".github/workflows/ci.yml",
                "pyproject.toml",
                "requirements-dev.txt",
                "data/history-data.json",
            ])
            .iter()
            .all(|&scope| scope == Scope::Config)
        );
    }

    #[test]
    fn everything_else_is_source() {
        assert!(
            scopes(&[
                "index.js",
                "src/vs/base/common/lifecycle.ts",
                "fastapi/testclient.py",
                "src/testing/helpers.ts",
                "context.go",
                "scripts/release.sh",
                "tools/gen.py",
                "src/theme.css",
                "src/contest.py",
                "src/latest.ts",
                "src/configure.ts",
                "src/app/app.config.ts",
                "src/database.config.ts",
            ])
            .iter()
            .all(|&scope| scope == Scope::Source)
        );
    }

    #[test]
    fn a_folder_gives_its_scope_to_what_it_holds() {
        assert_eq!(of_dir("pkg/testdata/x"), Some(Scope::Fixture));
        assert_eq!(of_dir("src/core"), None);
        assert_eq!(of_dir(""), None);
    }
}
