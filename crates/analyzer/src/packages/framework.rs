//! What a package is built with and where it starts: the framework its
//! manifests declare, the entry and routes its conventions give, and
//! whether it runs on its own (an app) or serves others (a library).

use std::collections::{BTreeSet, HashMap};

use model::Framework;
use serde_json::Value;

use super::manifest::Npm;

/// What is known of one package before its framework is read.
pub(super) struct Package<'a> {
    /// Its folder, from the root.
    pub dir: &'a str,
    pub npm: Option<&'a Npm>,
    /// Python projects its `pyproject.toml` and `requirements*.txt`
    /// declare, as pip compares them.
    pub python: &'a BTreeSet<String>,
    /// The manifests directly in its folder, by file name.
    pub own: &'a HashMap<&'a str, &'a [u8]>,
    /// Its production code files, by path, sorted.
    pub code: &'a [(&'a str, u32)],
    /// The file its `package.json` starts from (`main`, `bin` or a script).
    pub start: Option<u32>,
    /// Its first Go file that starts a program.
    pub go_main: Option<u32>,
    /// Whether it declares a program to install: `bin` of its
    /// `package.json`, `[project.scripts]` of its `pyproject.toml`.
    pub program: bool,
    /// Whether a production file of another package imports it.
    pub imported: bool,
}

/// What its framework says of a package.
#[derive(Debug, Default, PartialEq, Eq)]
pub(super) struct Found {
    pub framework: Option<Framework>,
    pub app: bool,
    pub entry: Option<u32>,
    /// The folder of its routes, from the root, with the number of routes
    /// and of API routes.
    pub routes: Option<(String, u32, u32)>,
}

pub(super) fn read(package: &Package<'_>) -> Found {
    let framework = framework(package);
    let mut found = Found {
        framework,
        ..Found::default()
    };
    match framework {
        Some(Framework::Nestjs) => found.entry = nest_entry(package),
        Some(Framework::Nextjs) => {
            if let Some((dir, routes, api, entry)) = next_routes(package) {
                found.routes = Some((dir, routes, api));
                found.entry = entry;
            }
        }
        Some(Framework::ReactNative) => {
            let router = package
                .npm
                .and_then(|npm| npm.main.as_deref())
                .is_some_and(|main| main.starts_with("expo-router"));
            if router {
                found.routes = expo_routes(package);
            }
        }
        _ => {}
    }
    found.entry = found.entry.or(package.start).or(package.go_main);
    found.app = match nx_project_type(package) {
        Some(declared) => declared,
        None => runs_on_its_own(package, framework, &found),
    };
    found
}

/// What the repository says a package is, other than Nx: a script that
/// starts it or serves it, a platform manifest, a framework's entry, a Go
/// `main`, or a program or a Python web app no other package imports. A
/// library can ship a program too (`@babel/parser`): the packages that
/// import it make it a library.
fn runs_on_its_own(package: &Package<'_>, framework: Option<Framework>, found: &Found) -> bool {
    let scripts = package.npm.map(|npm| &npm.scripts);
    let starts = scripts.is_some_and(|scripts| scripts.contains_key("start"));
    let serves = scripts.is_some_and(|scripts| {
        ["dev", "serve"]
            .iter()
            .filter_map(|name| scripts.get(*name))
            .any(|script| serves_an_app(script))
    });
    let platform = framework == Some(Framework::BrowserExtension) || is_expo_app(package);
    let convention = framework == Some(Framework::Nestjs) && found.entry.is_some()
        || found.routes.as_ref().is_some_and(|routes| routes.1 > 0);
    let python_app = matches!(
        framework,
        Some(Framework::Fastapi | Framework::Django | Framework::Flask)
    );
    let alone = (package.program || python_app) && !package.imported;
    starts || serves || platform || convention || package.go_main.is_some() || alone
}

/// `projectType` of its Nx `project.json`: `application` or `library`.
fn nx_project_type(package: &Package<'_>) -> Option<bool> {
    let project = package.own.get("project.json")?;
    let project: Value = serde_json::from_slice(project).ok()?;
    match project.get("projectType")?.as_str()? {
        "application" => Some(true),
        "library" => Some(false),
        _ => None,
    }
}

/// Commands that start a development server or an app window, with the
/// subcommands that do (`""` none, `"*"` any: `electron .` opens a
/// folder): a script that runs one makes its package an app. A bundler
/// that only builds (`vite build`) or watches (`tsup --watch`) does not.
const SERVERS: &[(&str, &[&str])] = &[
    ("vite", &["", "dev", "serve"]),
    ("next", &["dev"]),
    ("nuxt", &["dev"]),
    ("nuxi", &["dev"]),
    ("astro", &["dev"]),
    ("remix", &["dev", "vite:dev"]),
    ("react-router", &["dev"]),
    ("ng", &["serve"]),
    ("wrangler", &["dev"]),
    ("electron", &["*"]),
    ("electron-vite", &["dev", "preview"]),
    ("electron-forge", &["start"]),
    ("expo", &["start"]),
    ("webpack", &["serve"]),
    ("webpack-dev-server", &[""]),
    ("rspack", &["serve", "dev"]),
    ("rsbuild", &["dev"]),
    ("parcel", &["", "serve"]),
];

/// Whether a script runs one of [`SERVERS`], in any of its commands.
fn serves_an_app(script: &str) -> bool {
    script.split(['&', ';', '|']).any(|command| {
        let mut words = command
            .split_whitespace()
            // Environment, runners and package managers before the command
            .skip_while(|word| {
                word.contains('=')
                    || matches!(
                        *word,
                        "npx"
                            | "pnpx"
                            | "bunx"
                            | "yarn"
                            | "pnpm"
                            | "npm"
                            | "bun"
                            | "exec"
                            | "run"
                            | "dlx"
                            | "cross-env"
                            | "dotenv"
                            | "--"
                    )
            });
        let Some(program) = words.next() else {
            return false;
        };
        let subcommand = words
            .next()
            .filter(|word| !word.starts_with('-'))
            .unwrap_or("");
        SERVERS.iter().any(|(name, subcommands)| {
            *name == program && (subcommands.contains(&subcommand) || subcommands.contains(&"*"))
        })
    })
}

/// The first framework of the table its dependencies name. Peer
/// dependencies say what a library works with, not what it is built with:
/// they never count.
fn framework(package: &Package<'_>) -> Option<Framework> {
    let runs = |dependency: &str| {
        package
            .npm
            .is_some_and(|npm| npm.runtime.contains(dependency))
    };
    let python = |project: &str| package.python.contains(project);
    let storybook = package.npm.is_some_and(|npm| {
        let declared = npm
            .runtime
            .iter()
            .chain(&npm.dev)
            .any(|name| name == "storybook" || name.starts_with("@storybook/"));
        declared
            && npm
                .scripts
                .values()
                .any(|script| script.contains("storybook"))
    });
    let extension = package
        .own
        .get("manifest.json")
        .and_then(|content| serde_json::from_slice::<Value>(content).ok())
        .is_some_and(|manifest| manifest.get("manifest_version").is_some());
    if runs("next") {
        Some(Framework::Nextjs)
    } else if runs("@nestjs/core") {
        Some(Framework::Nestjs)
    } else if runs("expo") || runs("react-native") {
        Some(Framework::ReactNative)
    } else if storybook {
        Some(Framework::Storybook)
    } else if runs("fastify") {
        Some(Framework::Fastify)
    } else if runs("express") {
        Some(Framework::Express)
    } else if python("fastapi") {
        Some(Framework::Fastapi)
    } else if python("django") {
        Some(Framework::Django)
    } else if python("flask") {
        Some(Framework::Flask)
    } else if extension {
        Some(Framework::BrowserExtension)
    } else {
        None
    }
}

/// `sourceRoot/entryFile` of its `nest-cli.json`, `src/main` by default.
fn nest_entry(package: &Package<'_>) -> Option<u32> {
    let config = package
        .own
        .get("nest-cli.json")
        .and_then(|content| serde_json::from_slice::<Value>(content).ok());
    let field = |name: &str, default: &'static str| {
        config
            .as_ref()
            .and_then(|config| config.get(name)?.as_str().map(str::to_owned))
            .unwrap_or_else(|| default.to_owned())
    };
    let base = within(
        package.dir,
        &format!(
            "{}/{}",
            field("sourceRoot", "src"),
            field("entryFile", "main")
        ),
    );
    [".ts", ".js"]
        .iter()
        .find_map(|extension| find(package.code, &format!("{base}{extension}")))
}

/// The routes folder with the most routes: `pages/` counts its files but
/// those starting with `_`, `pages/api/` its API routes; `app/` counts its
/// `page` and `route` files, `route` ones being API routes. Each may sit
/// under `src/`. With the folder: its routes, API routes, and the file
/// around every page (`_app` or the root `layout`).
fn next_routes(package: &Package<'_>) -> Option<(String, u32, u32, Option<u32>)> {
    let mut best: Option<(String, u32, u32, Option<u32>)> = None;
    for (folder, pages) in [
        ("pages", true),
        ("src/pages", true),
        ("app", false),
        ("src/app", false),
    ] {
        let dir = within(package.dir, folder);
        let prefix = format!("{dir}/");
        let mut routes = 0;
        let mut api = 0;
        for (path, _) in package
            .code
            .iter()
            .filter(|(path, _)| path.starts_with(&prefix))
        {
            let name = stem(path);
            if pages {
                if name.starts_with('_') {
                    continue;
                }
                routes += 1;
                api += u32::from(path[prefix.len()..].starts_with("api/"));
            } else if name == "page" || name == "route" {
                routes += 1;
                api += u32::from(name == "route");
            }
        }
        let shell = if pages { "_app" } else { "layout" };
        let entry = [".tsx", ".jsx", ".ts", ".js"]
            .iter()
            .find_map(|extension| find(package.code, &format!("{dir}/{shell}{extension}")));
        if routes > best.as_ref().map_or(0, |best| best.1) {
            best = Some((dir, routes, api, entry));
        }
    }
    best
}

/// Expo Router's `app/` folder, under `src/` or not: its files but those
/// starting with `_` are routes, `+api` ones API routes.
fn expo_routes(package: &Package<'_>) -> Option<(String, u32, u32)> {
    ["app", "src/app"].iter().find_map(|folder| {
        let dir = within(package.dir, folder);
        let prefix = format!("{dir}/");
        let names: Vec<&str> = package
            .code
            .iter()
            .filter(|(path, _)| path.starts_with(&prefix))
            .map(|(path, _)| stem(path))
            .filter(|name| !name.starts_with('_'))
            .collect();
        let api = names.iter().filter(|name| name.ends_with("+api")).count();
        (!names.is_empty()).then(|| {
            (
                dir,
                crate::saturating_u32(names.len()),
                crate::saturating_u32(api),
            )
        })
    })
}

/// An `app.json` with an `expo` section.
fn is_expo_app(package: &Package<'_>) -> bool {
    package
        .own
        .get("app.json")
        .and_then(|content| serde_json::from_slice::<Value>(content).ok())
        .is_some_and(|app| app.get("expo").is_some())
}

/// The file name without its last extension: `page` for `page.tsx`.
fn stem(path: &str) -> &str {
    let name = path.rsplit('/').next().unwrap_or(path);
    name.rsplit_once('.').map_or(name, |(stem, _)| stem)
}

fn within(dir: &str, path: &str) -> String {
    if dir.is_empty() {
        path.to_owned()
    } else {
        format!("{dir}/{path}")
    }
}

fn find(code: &[(&str, u32)], path: &str) -> Option<u32> {
    code.binary_search_by(|(known, _)| (*known).cmp(path))
        .ok()
        .map(|at| code[at].1)
}

#[cfg(test)]
mod tests {
    use super::super::manifest;
    use super::*;

    struct Fixture {
        npm: Option<Npm>,
        python: BTreeSet<String>,
        own: Vec<(&'static str, &'static str)>,
        code: Vec<&'static str>,
        start: Option<u32>,
        go_main: Option<u32>,
        imported: bool,
    }

    impl Fixture {
        fn npm(json: &str) -> Self {
            Self {
                npm: manifest::npm(json.as_bytes()),
                python: BTreeSet::new(),
                own: Vec::new(),
                code: Vec::new(),
                start: None,
                go_main: None,
                imported: false,
            }
        }

        fn read(&self) -> Found {
            let own: HashMap<&str, &[u8]> = self
                .own
                .iter()
                .map(|(name, content)| (*name, content.as_bytes()))
                .collect();
            let mut code: Vec<(&str, u32)> = self
                .code
                .iter()
                .enumerate()
                .map(|(row, path)| (*path, crate::saturating_u32(row)))
                .collect();
            code.sort_unstable();
            read(&Package {
                dir: "apps/web",
                npm: self.npm.as_ref(),
                python: &self.python,
                own: &own,
                code: &code,
                start: self.start,
                go_main: self.go_main,
                program: self.npm.as_ref().is_some_and(|npm| npm.bin)
                    || self.own.iter().any(|(name, content)| {
                        *name == "pyproject.toml" && content.contains("[project.scripts]")
                    }),
                imported: self.imported,
            })
        }
    }

    #[test]
    fn next_routes_count_pages_and_api_routes() {
        let mut fixture = Fixture::npm(
            r#"{"dependencies": {"next": "15", "express": "4"}, "scripts": {"start": "next start"}}"#,
        );
        fixture.code = vec![
            "apps/web/pages/_app.tsx",
            "apps/web/pages/index.tsx",
            "apps/web/pages/admin/[id].tsx",
            "apps/web/pages/api/users.ts",
            "apps/web/components/button.tsx",
        ];
        let found = fixture.read();
        assert_eq!(found.framework, Some(Framework::Nextjs));
        assert!(found.app);
        assert_eq!(found.routes, Some(("apps/web/pages".to_owned(), 3, 1)));
        assert_eq!(found.entry, Some(0));
    }

    #[test]
    fn app_router_routes_may_sit_under_src() {
        let mut fixture = Fixture::npm(r#"{"dependencies": {"next": "15"}}"#);
        fixture.code = vec![
            "apps/web/src/app/layout.tsx",
            "apps/web/src/app/page.tsx",
            "apps/web/src/app/users/page.tsx",
            "apps/web/src/app/api/users/route.ts",
            "apps/web/src/app/users/table.tsx",
        ];
        let found = fixture.read();
        assert_eq!(found.routes, Some(("apps/web/src/app".to_owned(), 3, 1)));
        // Routes make an app, even without a start script
        assert!(found.app);
    }

    #[test]
    fn a_nest_app_starts_where_its_cli_says() {
        let mut fixture = Fixture::npm(r#"{"dependencies": {"@nestjs/core": "11"}}"#);
        fixture.code = vec!["apps/web/server/boot.ts", "apps/web/src/main.ts"];
        fixture.own = vec![(
            "nest-cli.json",
            r#"{"sourceRoot": "server", "entryFile": "boot"}"#,
        )];
        let found = fixture.read();
        assert_eq!(found.framework, Some(Framework::Nestjs));
        assert_eq!(found.entry, Some(0));
        assert!(found.app);
        fixture.own.clear();
        assert_eq!(fixture.read().entry, Some(1));
    }

    #[test]
    fn peer_dependencies_do_not_make_a_framework() {
        let mut fixture = Fixture::npm(
            r#"{"main": "index.js", "peerDependencies": {"@nestjs/core": "11", "express": "5"}}"#,
        );
        fixture.start = Some(4);
        let found = fixture.read();
        assert_eq!(found.framework, None);
        assert!(!found.app);
        assert_eq!(found.entry, Some(4));
    }

    #[test]
    fn storybook_needs_its_script() {
        let mut fixture = Fixture::npm(
            r#"{"devDependencies": {"@storybook/react": "8"}, "scripts": {"dev": "storybook dev"}}"#,
        );
        assert_eq!(fixture.read().framework, Some(Framework::Storybook));
        fixture.npm = manifest::npm(br#"{"devDependencies": {"@storybook/react": "8"}}"#);
        assert_eq!(fixture.read().framework, None);
    }

    #[test]
    fn expo_routes_and_platform_manifests_make_apps() {
        let mut expo = Fixture::npm(
            r#"{"main": "expo-router/entry", "dependencies": {"expo": "52", "react-native": "0.76"}}"#,
        );
        expo.code = vec![
            "apps/web/app/_layout.tsx",
            "apps/web/app/index.tsx",
            "apps/web/app/hello+api.ts",
        ];
        let found = expo.read();
        assert_eq!(found.framework, Some(Framework::ReactNative));
        assert_eq!(found.routes, Some(("apps/web/app".to_owned(), 2, 1)));
        assert!(found.app);

        let mut extension = Fixture::npm("{}");
        extension.npm = None;
        extension.own = vec![("manifest.json", r#"{"manifest_version": 3, "name": "x"}"#)];
        let found = extension.read();
        assert_eq!(found.framework, Some(Framework::BrowserExtension));
        assert!(found.app);
    }

    #[test]
    fn python_frameworks_come_from_declared_projects() {
        let mut fixture = Fixture::npm(r#"{"scripts": {"start": "uvicorn src.main:app"}}"#);
        fixture.python = BTreeSet::from(["fastapi".to_owned(), "uvicorn".to_owned()]);
        let found = fixture.read();
        assert_eq!(found.framework, Some(Framework::Fastapi));
        assert!(found.app);
    }

    #[test]
    fn a_library_has_no_start() {
        let mut fixture = Fixture::npm(
            r#"{"main": "dist/index.js", "scripts": {"build": "tsc", "dev": "tsc --watch"}}"#,
        );
        fixture.start = Some(2);
        let found = fixture.read();
        assert!(!found.app);
        assert_eq!(found.entry, Some(2));
        let mut go = Fixture::npm("{}");
        go.go_main = Some(3);
        assert!(go.read().app);
    }

    #[test]
    fn nx_says_whether_a_project_is_an_application() {
        let mut fixture = Fixture::npm(r#"{"name": "front"}"#);
        assert!(!fixture.read().app);
        fixture
            .own
            .push(("project.json", r#"{"projectType": "application"}"#));
        assert!(fixture.read().app);
        // Nx outranks a start script
        let mut fixture = Fixture::npm(r#"{"scripts": {"start": "node ."}}"#);
        fixture
            .own
            .push(("project.json", r#"{"projectType": "library"}"#));
        assert!(!fixture.read().app);
    }

    #[test]
    fn a_script_that_serves_an_app_makes_an_app() {
        for script in [
            "vite",
            "vite --port 3000",
            "cross-env NODE_ENV=dev vite dev",
            "next dev --turbo",
            "pnpm exec wrangler dev",
            "yarn native:setup && electron .",
            "npx nuxi dev",
            "ng serve",
        ] {
            let json = format!(r#"{{"scripts": {{"dev": "{script}"}}}}"#);
            assert!(Fixture::npm(&json).read().app, "{script}");
        }
        for script in [
            "vite build",
            "tsup --watch",
            "tsc -w",
            "vitest",
            "next build",
        ] {
            let json = format!(r#"{{"scripts": {{"dev": "{script}"}}}}"#);
            assert!(!Fixture::npm(&json).read().app, "{script}");
        }
    }

    #[test]
    fn a_program_no_package_imports_is_an_app() {
        let mut cli = Fixture::npm(r#"{"bin": {"babel": "./bin/babel.js"}}"#);
        assert!(cli.read().app);
        // @babel/parser has a program too, but others import it
        cli.imported = true;
        assert!(!cli.read().app);
        let mut python = Fixture::npm("{}");
        python.npm = None;
        python
            .own
            .push(("pyproject.toml", "[project.scripts]\nclai = \"clai:cli\"\n"));
        assert!(python.read().app);
    }

    #[test]
    fn a_python_web_app_no_package_imports_is_an_app() {
        let mut backend = Fixture::npm("{}");
        backend.npm = None;
        backend.python = BTreeSet::from(["fastapi".to_owned()]);
        let found = backend.read();
        assert_eq!(found.framework, Some(Framework::Fastapi));
        assert!(found.app);
        backend.imported = true;
        assert!(!backend.read().app);
    }
}
