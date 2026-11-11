//! What the steps of a monorepo's tour read: the package of each folder,
//! the production imports between packages, and the apps gathered into
//! units.

use std::collections::{BTreeMap, HashMap};

use model::{AnalysisResult, AppUnit, EdgeKind, PackageKind};

use super::is_production;
use crate::saturating_u32 as index;

/// A unit of apps is a main one when it holds this share of the apps' code,
/// in percent, at least: low enough to keep an app of 5% that people name
/// among the main ones, high enough to leave out the small tools.
const MAIN_SHARE: u64 = 3;
/// The most main units: more would read as a list, not an architecture.
const MAX_MAIN_UNITS: usize = 5;

/// Production imports from one package to another.
#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
pub(super) struct PackageLink {
    pub imports: u32,
    /// Production files that import the other package.
    pub files: u32,
    /// Of them, files that import only its types.
    pub type_only: u32,
}

pub(super) struct Monorepo<'a> {
    pub result: &'a AnalysisResult,
    /// The package of each folder.
    package_of_dir: Vec<Option<u32>>,
    /// By importing package, then imported package.
    pub links: BTreeMap<(u32, u32), PackageLink>,
    /// The packages that import each package, with their link, in order.
    importers: Vec<Vec<(u32, PackageLink)>>,
    /// Every app, in units, the largest unit first.
    pub units: Vec<AppUnit>,
    /// How many of [`Monorepo::units`] are main ones.
    pub main_units: usize,
    /// Code files of all the apps.
    pub app_files: u32,
}

impl<'a> Monorepo<'a> {
    /// The monorepo of a result, `None` for another repository: the same
    /// rule as its islands (`packages::monorepo_dirs`).
    pub fn of(result: &'a AnalysisResult) -> Option<Self> {
        if crate::packages::monorepo_dirs(&result.packages).is_empty() {
            return None;
        }
        let package_of_dir =
            crate::packages::package_of_dirs(&result.dirs.parent, &result.packages.dir);
        let mut repo = Self {
            result,
            package_of_dir,
            links: BTreeMap::new(),
            importers: vec![Vec::new(); result.packages.dir.len()],
            units: Vec::new(),
            main_units: 0,
            app_files: 0,
        };
        repo.links = repo.package_links();
        for (&(from, to), &link) in &repo.links {
            repo.importers[to as usize].push((from, link));
        }
        repo.units = units(result);
        let app_files: u64 = repo.units.iter().map(|unit| u64::from(unit.files)).sum();
        repo.app_files = super::count(app_files);
        let main = repo
            .units
            .iter()
            .take_while(|unit| u64::from(unit.files) * 100 >= app_files * MAIN_SHARE)
            .count();
        // The largest unit is always presented, whatever its share
        repo.main_units = main.clamp(1, MAX_MAIN_UNITS).min(repo.units.len());
        Some(repo)
    }

    pub fn package_of_file(&self, file: usize) -> Option<u32> {
        self.package_of_dir[self.result.files.dir[file] as usize]
    }

    fn package_of_dir(&self, dir: u32) -> Option<u32> {
        self.package_of_dir[dir as usize]
    }

    /// The package an edge imports from.
    pub fn target_package(&self, edge: usize) -> Option<u32> {
        let edges = &self.result.edges;
        let dir = match edges.to[edge] {
            Some(file) => self.result.files.dir[file as usize],
            None => edges.to_dir[edge]?,
        };
        self.package_of_dir(dir)
    }

    pub fn is_app(&self, package: u32) -> bool {
        self.result.packages.kind[package as usize] == PackageKind::App
    }

    pub fn has_apps(&self) -> bool {
        !self.units.is_empty()
    }

    /// The units presented as the main apps.
    pub fn main(&self) -> &[AppUnit] {
        &self.units[..self.main_units]
    }

    /// Production imports from a production file of a package to another
    /// package.
    fn package_links(&self) -> BTreeMap<(u32, u32), PackageLink> {
        let edges = &self.result.edges;
        // Whether each file imports only types of each package it imports
        let mut by_file: HashMap<(u32, u32), bool> = HashMap::new();
        let mut links: BTreeMap<(u32, u32), PackageLink> = BTreeMap::new();
        for edge in 0..edges.from.len() {
            let file = edges.from[edge] as usize;
            if !is_production(self.result, file) {
                continue;
            }
            let (Some(from), Some(to)) = (self.package_of_file(file), self.target_package(edge))
            else {
                continue;
            };
            if from == to {
                continue;
            }
            links.entry((from, to)).or_default().imports += 1;
            let types = edges.kind[edge] == EdgeKind::Type;
            by_file
                .entry((index(file), to))
                .and_modify(|only| *only &= types)
                .or_insert(types);
        }
        for ((file, to), only_types) in by_file {
            let from = self.package_of_file(file as usize).unwrap_or_default();
            let link = links.entry((from, to)).or_default();
            link.files += 1;
            link.type_only += u32::from(only_types);
        }
        links
    }

    /// The packages that import a package, with their link.
    pub fn importers(&self, package: u32) -> &[(u32, PackageLink)] {
        &self.importers[package as usize]
    }
}

/// Whether a package holds production code: a workspace also declares
/// packages of tooling and tests, which the tour leaves out.
pub(super) fn has_code(result: &AnalysisResult, package: usize) -> bool {
    result.packages.code_files[package] > 0
}

/// The apps of a group by name make one unit, each other app its own; the
/// largest first, the apps of a unit too. An app without code is left out.
fn units(result: &AnalysisResult) -> Vec<AppUnit> {
    let packages = &result.packages;
    let files = |app: &u32| packages.code_files[*app as usize];
    let mut grouped: BTreeMap<u32, Vec<u32>> = BTreeMap::new();
    let mut units = Vec::new();
    for package in 0..packages.dir.len() {
        if packages.kind[package] != PackageKind::App || !has_code(result, package) {
            continue;
        }
        let app = index(package);
        match packages.group[package] {
            Some(group) => grouped.entry(group).or_default().push(app),
            None => units.push((None, vec![app])),
        }
    }
    units.extend(grouped.into_iter().map(|(group, apps)| (Some(group), apps)));
    let mut units: Vec<AppUnit> = units
        .into_iter()
        .map(|(group, mut apps)| {
            apps.sort_by_key(|app| (std::cmp::Reverse(files(app)), *app));
            AppUnit {
                group,
                files: apps.iter().map(files).sum(),
                apps,
            }
        })
        .collect();
    units.sort_by_key(|unit| (std::cmp::Reverse(unit.files), unit.apps[0]));
    units
}
