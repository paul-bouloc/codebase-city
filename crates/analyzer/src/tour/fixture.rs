//! Small results written by hand, to test the steps of the tour.

use model::{AnalysisResult, EntryReason, FORMAT_VERSION, Repo, Scope, Tour};

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
