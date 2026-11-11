//! The declarations of a workspace: which manifests at the root list the
//! packages, the patterns of their folders, and the manifest a member has.

use globset::{GlobBuilder, GlobSet, GlobSetBuilder};
use model::WorkspaceKind;
use serde_json::Value;

use super::manifest::{toml_array, toml_sections};

/// The patterns a declaration lists its packages with.
pub(super) struct Declaration {
    pub kind: WorkspaceKind,
    /// Path of the manifest that declares them.
    pub manifest: String,
    include: GlobSet,
    exclude: GlobSet,
    /// Whether the root itself is a member: `.` in `go.work`, or the root
    /// project of a uv workspace, which uv always installs.
    pub root: bool,
}

impl Declaration {
    /// Whether the folder at `path` matches the declaration.
    pub fn matches(&self, path: &str) -> bool {
        self.include.is_match(path) && !self.exclude.is_match(path)
    }

    /// The manifests one of which makes a matching folder a package: the
    /// tool installs no member without it. A browser extension or an Expo
    /// app declares itself by its platform manifest.
    pub fn members(&self) -> &'static [&'static str] {
        match self.kind {
            WorkspaceKind::Npm | WorkspaceKind::Pnpm | WorkspaceKind::Lerna => {
                &["package.json", "manifest.json", "app.json"]
            }
            WorkspaceKind::Nx => &["project.json"],
            WorkspaceKind::GoWork => &["go.mod"],
            WorkspaceKind::Uv => &["pyproject.toml"],
            WorkspaceKind::Deno => &["deno.json", "deno.jsonc", "package.json"],
        }
    }
}

/// Reads the patterns of one kind of manifest.
type Reader = fn(&str) -> Vec<String>;

/// Every declaration at the root. pnpm installs the folders of its own
/// file and ignores the `workspaces` of `package.json`; lerna and Nx name
/// projects on top of the installed packages; Go, uv and Deno declare
/// packages of their own languages beside them.
pub(super) fn declarations(manifests: &[(&str, &[u8])]) -> Vec<Declaration> {
    let root = |name: &str| {
        manifests
            .iter()
            .find(|(path, _)| *path == name)
            .map(|(_, content)| String::from_utf8_lossy(content))
    };
    let read = |kind: WorkspaceKind, manifest: &str, reader: Reader| {
        let patterns = reader(&root(manifest)?);
        let (include, exclude, root) = globs(&patterns)?;
        Some(Declaration {
            kind,
            manifest: manifest.to_owned(),
            include,
            exclude,
            root,
        })
    };
    let installed = read(WorkspaceKind::Pnpm, "pnpm-workspace.yaml", pnpm)
        .or_else(|| read(WorkspaceKind::Npm, "package.json", npm));
    let deno = read(WorkspaceKind::Deno, "deno.json", deno)
        .or_else(|| read(WorkspaceKind::Deno, "deno.jsonc", deno));
    let nx = root("nx.json").and_then(|_| {
        let projects: Vec<String> = manifests
            .iter()
            .filter_map(|(path, _)| path.strip_suffix("/project.json"))
            .map(globset::escape)
            .collect();
        let (include, exclude, _) = globs(&projects)?;
        Some(Declaration {
            kind: WorkspaceKind::Nx,
            manifest: "nx.json".to_owned(),
            include,
            exclude,
            root: false,
        })
    });
    // uv installs the root project of its workspace with the members
    let uv = read(WorkspaceKind::Uv, "pyproject.toml", uv).map(|mut uv| {
        let project = root("pyproject.toml")
            .is_some_and(|content| toml_sections(&content).contains_key("project"));
        uv.root |= project;
        uv
    });
    [
        installed,
        read(WorkspaceKind::Lerna, "lerna.json", lerna),
        nx,
        read(WorkspaceKind::GoWork, "go.work", go_work),
        uv,
        deno,
    ]
    .into_iter()
    .flatten()
    .collect()
}

/// Patterns as folder globs: `*` stays within a folder, `**` crosses them,
/// `!` excludes; and whether `.` lists the root. `None` when nothing is
/// included.
fn globs(patterns: &[String]) -> Option<(GlobSet, GlobSet, bool)> {
    let mut include = GlobSetBuilder::new();
    let mut exclude = GlobSetBuilder::new();
    let mut any = false;
    let mut root = false;
    for pattern in patterns {
        let (negated, pattern) = match pattern.strip_prefix('!') {
            Some(rest) => (true, rest),
            None => (false, pattern.as_str()),
        };
        if matches!(pattern.trim(), "." | "./") {
            root |= !negated;
            continue;
        }
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
    if !any && !root {
        return None;
    }
    Some((
        include.build().ok().or_else(empty)?,
        exclude.build().ok().or_else(empty)?,
        root,
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

/// `workspace` of a `deno.json` or `deno.jsonc`, comments left out.
fn deno(content: &str) -> Vec<String> {
    serde_json::from_str::<Value>(&without_comments(content))
        .map(|manifest| strings(manifest.get("workspace")))
        .unwrap_or_default()
}

/// JSON with comments, as `deno.jsonc` allows, made plain: `//` and
/// `/* */` comments outside strings are dropped, and so are the commas
/// that close a list or an object.
fn without_comments(text: &str) -> String {
    let mut plain = String::with_capacity(text.len());
    let mut chars = text.chars().peekable();
    let mut string = false;
    while let Some(c) = chars.next() {
        if string {
            plain.push(c);
            match c {
                '\\' => plain.extend(chars.next()),
                '"' => string = false,
                _ => {}
            }
            continue;
        }
        match (c, chars.peek()) {
            ('"', _) => {
                string = true;
                plain.push(c);
            }
            ('/', Some('/')) => while chars.next_if(|&next| next != '\n').is_some() {},
            ('/', Some('*')) => {
                chars.next();
                let mut previous = ' ';
                for next in chars.by_ref() {
                    if previous == '*' && next == '/' {
                        break;
                    }
                    previous = next;
                }
            }
            _ => plain.push(c),
        }
    }
    // A trailing comma before `]` or `}`
    let mut cleaned = String::with_capacity(plain.len());
    let mut pending: Option<char> = None;
    let mut string = false;
    let mut escaped = false;
    for c in plain.chars() {
        if string {
            cleaned.push(c);
            if escaped {
                escaped = false;
            } else if c == '\\' {
                escaped = true;
            } else if c == '"' {
                string = false;
            }
            continue;
        }
        if c == ',' {
            pending = Some(c);
            continue;
        }
        if let Some(comma) = pending
            && !c.is_whitespace()
        {
            if c != ']' && c != '}' {
                cleaned.push(comma);
            }
            pending = None;
        }
        if c == '"' {
            string = true;
        }
        cleaned.push(c);
    }
    cleaned
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
        declarations(&manifests).into_iter().next()
    }

    fn kinds(manifests: &[(&str, &str)]) -> Vec<WorkspaceKind> {
        let manifests: Vec<(&str, &[u8])> = manifests
            .iter()
            .map(|(path, content)| (*path, content.as_bytes()))
            .collect();
        declarations(&manifests)
            .into_iter()
            .map(|declaration| declaration.kind)
            .collect()
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

    #[test]
    fn every_declaration_is_read_pnpm_instead_of_npm() {
        let manifests = [
            ("package.json", r#"{"workspaces": ["frontend"]}"#),
            ("pnpm-workspace.yaml", "packages:\n  - apps/*\n"),
            ("lerna.json", r#"{"packages": ["apps/*"]}"#),
            ("go.work", "use ./server\n"),
            (
                "pyproject.toml",
                "[tool.uv.workspace]\nmembers = [\"backend\"]\n",
            ),
        ];
        assert_eq!(
            kinds(&manifests),
            [
                WorkspaceKind::Pnpm,
                WorkspaceKind::Lerna,
                WorkspaceKind::GoWork,
                WorkspaceKind::Uv
            ]
        );
        // Without pnpm, the workspaces of package.json
        assert_eq!(kinds(&manifests[..1]), [WorkspaceKind::Npm],);
    }

    #[test]
    fn nx_declares_the_folders_of_its_project_files() {
        let manifests = [
            ("nx.json", "{}"),
            ("project.json", "{}"),
            ("apps/web/project.json", "{}"),
            ("libs/[ui]/project.json", "{}"),
        ];
        let nx = declared(&manifests).unwrap();
        assert_eq!(nx.kind, WorkspaceKind::Nx);
        assert!(nx.matches("apps/web") && nx.matches("libs/[ui]"));
        assert!(!nx.matches("apps/api") && !nx.matches("libs/u"));
        assert_eq!(nx.members(), ["project.json"]);
        // Project files without nx.json declare nothing
        assert!(declared(&manifests[1..]).is_none());
    }

    #[test]
    fn deno_declares_its_workspace_with_comments() {
        let deno = declared(&[(
            "deno.jsonc",
            "{\n  // the modules\n  \"workspace\": [\"./assert\", \"./http\", /* last */],\n  \"url\": \"https://a.b//c\"\n}",
        )])
        .unwrap();
        assert_eq!(deno.kind, WorkspaceKind::Deno);
        assert!(deno.matches("assert") && deno.matches("http"));
        assert!(!deno.matches("fs"));
    }

    #[test]
    fn a_dot_lists_the_root_and_uv_always_installs_its_root_project() {
        let go = declared(&[("go.work", "use (\n\t.\n\t./pkg/sdk\n)\n")]).unwrap();
        assert!(go.root && go.matches("pkg/sdk"));
        let only_root = declared(&[("go.work", "use ./\n")]).unwrap();
        assert!(only_root.root);
        let npm = declared(&[("package.json", r#"{"workspaces": ["apps/*", ""]}"#)]).unwrap();
        assert!(!npm.root);
        let uv = declared(&[(
            "pyproject.toml",
            "[project]\nname = \"meta\"\n\n[tool.uv.workspace]\nmembers = [\"libs/*\"]\n",
        )])
        .unwrap();
        assert!(uv.root);
        let bare_uv = declared(&[(
            "pyproject.toml",
            "[tool.uv.workspace]\nmembers = [\"libs/*\"]\n",
        )])
        .unwrap();
        assert!(!bare_uv.root);
    }
}
