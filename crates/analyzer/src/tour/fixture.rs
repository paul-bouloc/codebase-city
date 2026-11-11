//! Small results written by hand, to test the steps of the tour.

use model::{
    AnalysisResult, Confidence, EdgeKind, EntryReason, FORMAT_VERSION, PackageKind, Repo, Scope,
    Tour, Workspace, WorkspaceKind,
};

use crate::saturating_u32 as index;

/// A result built file by file. Each top-level folder is an island, and the
/// root is island 0.
pub(super) struct Fixture {
    pub result: AnalysisResult,
}

impl Fixture {
    pub fn new() -> Self {
        let mut result = AnalysisResult {
            format_version: FORMAT_VERSION,
            analyzer_version: "test".to_owned(),
            repo: Repo {
                owner: "acme".to_owned(),
                name: "app".to_owned(),
            },
            sha: "0".repeat(40),
            dirs: model::Dirs::default(),
            languages: vec!["TypeScript".to_owned()],
            files: model::Files::default(),
            symbols: model::Symbols::default(),
            edges: model::Edges::default(),
            roles: model::Roles::default(),
            islands: model::Islands::default(),
            links: model::Links::default(),
            cycles: model::Cycles::default(),
            workspace: None,
            packages: model::Packages::default(),
            package_groups: model::PackageGroups::default(),
            externals: model::Externals::default(),
            layout: model::Layout::default(),
            tour: Tour::default(),
            stats: model::Stats::default(),
        };
        result.dirs.parent.push(None);
        result.dirs.name.push(String::new());
        result.dirs.island.push(Some(0));
        result.islands.dir.push(0);
        result.islands.layer.push(None);
        Self { result }
    }

    /// Three islands in layers, `core` at the bottom, `ui`, then `app`;
    /// two foundations in `core`, `app/main.ts` the entry point and the only
    /// conductor; a test, a readme and a manifest. Every file has a
    /// complexity of 1.
    pub fn layered() -> Self {
        let mut repo = Self::new();
        for (path, dependents) in [
            ("core/a.ts", 5),
            ("core/b.ts", 4),
            ("core/c.ts", 2),
            ("ui/view.ts", 1),
            ("ui/panel.ts", 1),
            ("app/main.ts", 0),
        ] {
            let file = repo.file(path, Scope::Source);
            repo.result.files.dependents[file] = Some(dependents);
        }
        repo.test("test/a.test.ts");
        repo.file("README.md", Scope::Docs);
        repo.file("package.json", Scope::Config);
        repo.entry(5);
        repo.ranked(Role::Foundation, &[(0, 5), (1, 4)]);
        repo.ranked(Role::Conductor, &[(5, 5)]);
        let [core, ui, app] = ["core", "ui", "app"].map(|name| repo.island(name));
        for (island, layer) in [(core, 1), (ui, 2), (app, 3)] {
            repo.result.islands.layer[island as usize] = Some(layer);
        }
        for (from, to, imports) in [(ui, core, 2), (app, core, 1), (app, ui, 1)] {
            repo.link(from, to, imports, 0);
        }
        repo
    }

    /// A monorepo of six apps and seven libraries, each with one production
    /// file, `index.ts`, but `apps/web`: `pages/index.ts`,
    /// `components/a.ts` and `components/b.ts`. The code files the packages
    /// count are set apart: web 100, the group `shop` 25 (`shop-a` 20,
    /// `shop-b` 5), admin 2, tools 1, kiosk 1. Libraries, by the packages
    /// that import them: log 5, types 4, core 3, util 3, contracts 2 (web
    /// for its types, admin), pay 1 (web), lonely none.
    pub fn monorepo() -> Self {
        let mut repo = Self::new();
        let manifest = repo.file("package.json", Scope::Config);
        repo.result.workspace = Some(Workspace {
            kind: WorkspaceKind::Npm,
            manifest: index(manifest),
        });
        let app = PackageKind::App;
        for (dir, files) in [
            ("apps/web", 100),
            ("apps/shop-a", 20),
            ("apps/shop-b", 5),
            ("apps/admin", 2),
            ("apps/tools", 1),
            ("apps/kiosk", 1),
        ] {
            repo.package(dir, app, files);
        }
        for name in ["log", "types", "core", "util", "contracts", "pay", "lonely"] {
            repo.package(&format!("libs/{name}"), PackageKind::Library, 1);
        }
        repo.group("shop", &[1, 2]);
        let web = repo.file("apps/web/pages/index.ts", Scope::Source);
        repo.file("apps/web/components/a.ts", Scope::Source);
        repo.file("apps/web/components/b.ts", Scope::Source);
        let at = |repo: &Self, dir: &str| repo.file_at(&format!("{dir}/index.ts"));
        let imports: [(&str, &[&str]); 6] = [
            (
                "libs/log",
                &["apps/shop-a", "apps/admin", "apps/tools", "libs/types"],
            ),
            ("libs/types", &["apps/shop-a", "apps/admin", "libs/util"]),
            ("libs/core", &["apps/shop-b", "apps/admin"]),
            ("libs/util", &["apps/shop-a", "apps/tools"]),
            ("libs/contracts", &["apps/admin"]),
            ("libs/pay", &[]),
        ];
        for (library, importers) in imports {
            let target = at(&repo, library);
            repo.import(web, target, EdgeKind::Import);
            for importer in importers {
                let from = at(&repo, importer);
                repo.import(from, target, EdgeKind::Import);
            }
        }
        // web imports only the types of contracts
        let contracts = Some(index(at(&repo, "libs/contracts")));
        let edges = &mut repo.result.edges;
        let edge = (0..edges.from.len())
            .find(|&edge| edges.from[edge] == index(web) && edges.to[edge] == contracts)
            .unwrap_or_default();
        edges.kind[edge] = EdgeKind::Type;
        repo.sort_edges();
        repo
    }

    /// Sorts the edges by file then target, as a result holds them.
    pub fn sort_edges(&mut self) {
        let edges = &mut self.result.edges;
        let mut rows: Vec<_> = (0..edges.from.len())
            .map(|row| {
                (
                    edges.from[row],
                    edges.to[row],
                    edges.to_dir[row],
                    edges.kind[row],
                    edges.confidence[row],
                )
            })
            .collect();
        // File targets sort before folder targets
        rows.sort_by_key(|&(from, to, to_dir, _, _)| (from, to.is_none(), to.or(to_dir)));
        *edges = model::Edges::default();
        for (from, to, to_dir, kind, confidence) in rows {
            edges.from.push(from);
            edges.to.push(to);
            edges.to_dir.push(to_dir);
            edges.kind.push(kind);
            edges.confidence.push(confidence);
        }
    }

    /// A package at `dir`, with one production file, `index.ts`, but for
    /// `apps/web`; its code files are counted apart.
    pub fn package(&mut self, dir: &str, kind: PackageKind, code_files: u32) -> u32 {
        let folder = self.dir(dir);
        if dir != "apps/web" {
            self.file(&format!("{dir}/index.ts"), Scope::Source);
        }
        let packages = &mut self.result.packages;
        packages.dir.push(folder);
        packages
            .name
            .push(dir.rsplit('/').next().unwrap_or(dir).to_owned());
        packages.kind.push(kind);
        packages.framework.push(None);
        packages.manifest.push(None);
        packages.group.push(None);
        packages.code_files.push(code_files);
        packages.entry.push(None);
        packages.routes.push(None);
        packages.route_count.push(0);
        packages.api_route_count.push(0);
        index(packages.dir.len() - 1)
    }

    /// A group by name; groups must be added in order of their prefix.
    pub fn group(&mut self, prefix: &str, packages: &[u32]) {
        let groups = &mut self.result.package_groups;
        let group = index(groups.prefix.len());
        groups.prefix.push(prefix.to_owned());
        groups.linked.push(false);
        for &package in packages {
            self.result.packages.group[package as usize] = Some(group);
        }
    }

    /// The file at `path`.
    pub fn file_at(&self, path: &str) -> usize {
        let files = &self.result.files;
        (0..files.dir.len())
            .find(|&file| {
                let mut parts = vec![files.name[file].as_str()];
                let mut dir = files.dir[file] as usize;
                while let Some(parent) = self.result.dirs.parent[dir] {
                    parts.push(&self.result.dirs.name[dir]);
                    dir = parent as usize;
                }
                parts.reverse();
                parts.join("/") == path
            })
            .unwrap_or_else(|| panic!("no file {path}"))
    }

    /// An import from a file to another.
    pub fn import(&mut self, from: usize, to: usize, kind: EdgeKind) {
        let edges = &mut self.result.edges;
        edges.from.push(index(from));
        edges.to.push(Some(index(to)));
        edges.to_dir.push(None);
        edges.kind.push(kind);
        edges.confidence.push(Confidence::Exact);
    }

    /// The folder at `path`, added with its missing parents.
    pub fn dir(&mut self, path: &str) -> u32 {
        let dirs = &mut self.result.dirs;
        let mut current = 0;
        for name in path.split('/').filter(|name| !name.is_empty()) {
            let child = (0..dirs.name.len())
                .find(|&dir| dirs.parent[dir] == Some(current) && dirs.name[dir] == name);
            current = match child {
                Some(dir) => index(dir),
                None => {
                    let dir = index(dirs.name.len());
                    let island = if current == 0 {
                        self.result.islands.dir.push(dir);
                        self.result.islands.layer.push(None);
                        index(self.result.islands.dir.len() - 1)
                    } else {
                        dirs.island[current as usize].unwrap_or(0)
                    };
                    dirs.parent.push(Some(current));
                    dirs.name.push(name.to_owned());
                    dirs.island.push(Some(island));
                    dir
                }
            };
        }
        current
    }

    /// The island named after the top-level folder `name`.
    pub fn island(&mut self, name: &str) -> u32 {
        let dir = self.dir(name);
        self.result.dirs.island[dir as usize].unwrap_or(0)
    }

    /// Adds a file of 10 lines and a complexity of 1; a source file has
    /// no dependents yet.
    pub fn file(&mut self, path: &str, scope: Scope) -> usize {
        let (dir, name) = path.rsplit_once('/').unwrap_or(("", path));
        let dir = self.dir(dir);
        let files = &mut self.result.files;
        let source = scope == Scope::Source;
        files.dir.push(dir);
        files.name.push(name.to_owned());
        files.language.push(0);
        files.lines.push(10);
        files.complexity.push(Some(1));
        files.generated.push(false);
        files.scope.push(scope);
        files.header.push(None);
        files.barrel.push(false);
        files.dependents.push(source.then_some(0));
        files.dependencies.push(source.then_some(0));
        files.dir.len() - 1
    }

    pub fn test(&mut self, path: &str) -> usize {
        self.file(path, Scope::Test)
    }

    pub fn entry(&mut self, file: usize) {
        let entries = &mut self.result.roles.entries;
        entries.file.push(Some(index(file)));
        entries.dir.push(None);
        entries.reasons.push(vec![EntryReason::ConventionalName]);
        entries.command.push(None);
    }

    /// Replaces a ranking with `(file, count)` rows.
    pub fn ranked(&mut self, role: Role, rows: &[(usize, u32)]) {
        let roles = &mut self.result.roles;
        let ranked = match role {
            Role::Foundation => &mut roles.foundations,
            Role::Conductor => &mut roles.conductors,
        };
        ranked.file = rows.iter().map(|&(file, _)| Some(index(file))).collect();
        ranked.dir = vec![None; rows.len()];
        ranked.count = rows.iter().map(|&(_, count)| count).collect();
    }

    /// Adds a link; links must be added in order.
    pub fn link(&mut self, from: u32, to: u32, imports: u32, upward: u32) {
        let links = &mut self.result.links;
        links.from.push(from);
        links.to.push(to);
        links.imports.push(imports);
        links.upward.push(upward);
    }

    /// `tour` in the result, laid out, once checked as the web app would.
    pub fn validated(&mut self, tour: Tour) -> Tour {
        self.result.layout = crate::layout::of_result(&self.result);
        self.result.tour = tour.clone();
        assert_eq!(self.result.validate(), Ok(()));
        tour
    }
}

pub(super) enum Role {
    Foundation,
    Conductor,
}
