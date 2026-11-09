//! The declaration of a workspace: which manifest at the root lists the
//! packages, and the patterns of their folders.

use globset::{GlobBuilder, GlobSet, GlobSetBuilder};
use model::WorkspaceKind;
use serde_json::Value;

use super::manifest::{toml_array, toml_sections};

/// The patterns a workspace declares its packages with.
pub(super) struct Declaration {
    pub kind: WorkspaceKind,
    /// Path of the manifest that declares them.
    pub manifest: String,
    include: GlobSet,
    exclude: GlobSet,
}

impl Declaration {
    /// Whether the folder at `path` matches the declaration.
    pub fn matches(&self, path: &str) -> bool {
        self.include.is_match(path) && !self.exclude.is_match(path)
    }
}

/// Reads the patterns of one kind of manifest.
type Reader = fn(&str) -> Vec<String>;

/// The first declaration found at the root, in the order the tools are
/// usually layered: pnpm and npm before lerna, which may sit on top of
/// them.
pub(super) fn declaration(manifests: &[(&str, &[u8])]) -> Option<Declaration> {
    let root = |name: &str| {
        manifests
            .iter()
            .find(|(path, _)| *path == name)
            .map(|(_, content)| String::from_utf8_lossy(content))
    };
    let readers: [(WorkspaceKind, &str, Reader); 5] = [
        (WorkspaceKind::Pnpm, "pnpm-workspace.yaml", pnpm),
        (WorkspaceKind::Npm, "package.json", npm),
        (WorkspaceKind::Lerna, "lerna.json", lerna),
        (WorkspaceKind::GoWork, "go.work", go_work),
        (WorkspaceKind::Uv, "pyproject.toml", uv),
    ];
    readers.into_iter().find_map(|(kind, manifest, read)| {
        let patterns = read(&root(manifest)?);
        let (include, exclude) = globs(&patterns)?;
        Some(Declaration {
            kind,
            manifest: manifest.to_owned(),
            include,
            exclude,
        })
    })
}

/// Patterns as folder globs: `*` stays within a folder, `**` crosses them,
/// `!` excludes. `None` when nothing is included.
fn globs(patterns: &[String]) -> Option<(GlobSet, GlobSet)> {
    let mut include = GlobSetBuilder::new();
    let mut exclude = GlobSetBuilder::new();
    let mut any = false;
    for pattern in patterns {
        let (negated, pattern) = match pattern.strip_prefix('!') {
            Some(rest) => (true, rest),
            None => (false, pattern.as_str()),
        };
        let pattern = pattern
            .trim()
            .trim_start_matches("./")
            .trim_end_matches('/');
        if pattern.is_empty() || pattern.starts_with('/') || pattern.contains("..") {
            continue;
        }
        let Ok(glob) = GlobBuilder::new(pattern).literal_separator(true).build() else {
            continue;
        };
        if negated {
            exclude.add(glob);
        } else {
            include.add(glob);
            any = true;
        }
    }
    let empty = || GlobSetBuilder::new().build().ok();
    if !any {
        return None;
    }
    Some((
        include.build().ok().or_else(empty)?,
        exclude.build().ok().or_else(empty)?,
    ))
}

/// `workspaces` of a `package.json`: a list, or `{ "packages": [...] }`.
fn npm(content: &str) -> Vec<String> {
    let Ok(manifest) = serde_json::from_str::<Value>(content) else {
        return Vec::new();
    };
    let workspaces = manifest.get("workspaces");
    let list = workspaces
        .and_then(|value| value.get("packages"))
        .or(workspaces);
    strings(list)
}

/// `packages` of a `lerna.json`.
fn lerna(content: &str) -> Vec<String> {
    serde_json::from_str::<Value>(content)
        .map(|manifest| strings(manifest.get("packages")))
        .unwrap_or_default()
}

fn strings(list: Option<&Value>) -> Vec<String> {
    list.and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|item| Some(item.as_str()?.to_owned()))
        .collect()
}

/// The `packages:` list of a `pnpm-workspace.yaml`, as written in practice:
/// one `- pattern` item per line, quoted or not, or a `[a, b]` flow list.
fn pnpm(content: &str) -> Vec<String> {
    let mut patterns = Vec::new();
    let mut inside = false;
    for line in content.lines() {
        let text = line.split(" #").next().unwrap_or_default().trim_end();
        if text.trim().is_empty() || text.trim_start().starts_with('#') {
            continue;
        }
        let top_level = !text.starts_with([' ', '\t', '-']);
        if top_level {
            inside = false;
            if let Some(rest) = text.strip_prefix("packages:") {
                inside = true;
                let rest = rest.trim();
                if let Some(flow) = rest.strip_prefix('[').and_then(|r| r.strip_suffix(']')) {
                    patterns.extend(flow.split(',').map(unquote).filter(|p| !p.is_empty()));
                    inside = false;
                }
            }
            continue;
        }
        if inside && let Some(item) = text.trim_start().strip_prefix('-') {
            patterns.push(unquote(item));
        }
    }
    patterns
}

/// The folders of `use` directives of a `go.work`, single or in a block.
fn go_work(content: &str) -> Vec<String> {
    let mut patterns = Vec::new();
    let mut block = false;
    for line in content.lines() {
        let line = line.split("//").next().unwrap_or_default().trim();
        if block {
            if line.starts_with(')') {
                block = false;
            } else if !line.is_empty() {
                patterns.push(unquote(line));
            }
            continue;
        }
        let Some(rest) = line.strip_prefix("use") else {
            continue;
        };
        let rest = rest.trim();
        if rest == "(" {
            block = true;
        } else if !rest.is_empty() && line.starts_with("use ") {
            patterns.push(unquote(rest));
        }
    }
    patterns
}

/// `members` of `[tool.uv.workspace]`, `exclude` as negated patterns.
fn uv(content: &str) -> Vec<String> {
    let sections = toml_sections(content);
    let Some(workspace) = sections.get("tool.uv.workspace") else {
        return Vec::new();
    };
    let mut patterns = toml_array(workspace, "members");
    patterns.extend(
        toml_array(workspace, "exclude")
            .into_iter()
            .map(|pattern| format!("!{pattern}")),
    );
    patterns
}

fn unquote(text: &str) -> String {
    text.trim()
        .trim_matches(|c| c == '"' || c == '\'')
        .to_owned()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn declared(manifests: &[(&str, &str)]) -> Option<Declaration> {
        let manifests: Vec<(&str, &[u8])> = manifests
            .iter()
            .map(|(path, content)| (*path, content.as_bytes()))
            .collect();
        declaration(&manifests)
    }

    #[test]
    fn npm_workspaces_are_a_list_or_an_object() {
        let list =
            declared(&[("package.json", r#"{"workspaces": ["apps/*", "libs/*"]}"#)]).unwrap();
        assert_eq!(list.kind, WorkspaceKind::Npm);
        assert!(list.matches("apps/web"));
        assert!(!list.matches("apps/web/src"));
        assert!(!list.matches("apps"));
        let object = declared(&[(
            "package.json",
            r#"{"workspaces": {"packages": ["./packages/*/"]}}"#,
        )])
        .unwrap();
        assert!(object.matches("packages/core"));
    }

    #[test]
    fn a_root_without_workspaces_declares_nothing() {
        assert!(declared(&[("package.json", r#"{"name": "express"}"#)]).is_none());
        assert!(declared(&[("apps/web/package.json", r#"{"workspaces": ["*"]}"#)]).is_none());
        assert!(declared(&[("package.json", r#"{"workspaces": []}"#)]).is_none());
    }

    #[test]
    fn pnpm_lists_patterns_and_exclusions() {
        let pnpm = declared(&[
            (
                "pnpm-workspace.yaml",
                "packages:\n  - 'packages/**'\n  - \"apps/*\" # the apps\n  - '!**/test/**'\ncatalog:\n  react: ^18\n",
            ),
            ("package.json", r#"{"workspaces": ["other/*"]}"#),
        ])
        .unwrap();
        assert_eq!(pnpm.kind, WorkspaceKind::Pnpm);
        assert!(pnpm.matches("packages/a/b"));
        assert!(pnpm.matches("apps/web"));
        assert!(!pnpm.matches("packages/a/test/fixture"));
        assert!(!pnpm.matches("other/x"));
        let flow = declared(&[("pnpm-workspace.yaml", "packages: [a/*, 'b']\n")]).unwrap();
        assert!(flow.matches("a/x") && flow.matches("b"));
    }

    #[test]
    fn lerna_go_work_and_uv_declare_packages_too() {
        let lerna = declared(&[("lerna.json", r#"{"packages": ["modules/*"]}"#)]).unwrap();
        assert_eq!(lerna.kind, WorkspaceKind::Lerna);
        assert!(lerna.matches("modules/x"));
        let go = declared(&[(
            "go.work",
            "go 1.22\n\nuse (\n\t./cmd/tool // the tool\n\t./lib\n)\nuse ./extra\n",
        )])
        .unwrap();
        assert_eq!(go.kind, WorkspaceKind::GoWork);
        assert!(go.matches("cmd/tool") && go.matches("lib") && go.matches("extra"));
        let uv = declared(&[(
            "pyproject.toml",
            "[project]\nname = \"root\"\n\n[tool.uv.workspace]\nmembers = [\n  \"packages/*\",\n]\nexclude = [\"packages/legacy\"]\n",
        )])
        .unwrap();
        assert_eq!(uv.kind, WorkspaceKind::Uv);
        assert!(uv.matches("packages/a"));
        assert!(!uv.matches("packages/legacy"));
    }

    #[test]
    fn patterns_cannot_leave_the_repository() {
        assert!(declared(&[("package.json", r#"{"workspaces": ["../x/*", "/abs"]}"#)]).is_none());
    }
}
