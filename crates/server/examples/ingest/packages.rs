//! The packages found: the workspace, apps and libraries, frameworks,
//! groups and the dependencies they import, against what a person expects.

use model::{AnalysisResult, PackageKind};

use crate::expected::Expected;
use crate::paths::{dir_path, path};

/// Dependencies printed per package, the most imported first.
const SHOWN_EXTERNALS: usize = 5;

pub(crate) fn print_packages(result: &AnalysisResult, expected: Option<&Expected>) {
    let packages = &result.packages;
    let folder = |row: usize| {
        dir_path(result, packages.dir[row])
            .trim_end_matches('/')
            .to_owned()
    };
    match &result.workspace {
        Some(workspace) => println!(
            "workspace     {:?} in {}, {} packages ({} apps)",
            workspace.kind,
            path(result, workspace.manifest as usize),
            packages.dir.len(),
            packages
                .kind
                .iter()
                .filter(|&&kind| kind == PackageKind::App)
                .count()
        ),
        None => println!("workspace     none"),
    }
    for row in 0..packages.dir.len() {
        let framework = packages.framework[row]
            .map(|framework| format!(" {framework:?}"))
            .unwrap_or_default();
        let group = packages.group[row]
            .map(|group| format!(" [{}]", result.package_groups.prefix[group as usize]))
            .unwrap_or_default();
        let entry = packages.entry[row]
            .map(|file| format!(", from {}", path(result, file as usize)))
            .unwrap_or_default();
        let routes = packages.routes[row]
            .map(|_| {
                format!(
                    ", {} routes ({} API)",
                    packages.route_count[row], packages.api_route_count[row]
                )
            })
            .unwrap_or_default();
        println!(
            "  {:40} {:?}{framework}{group}, {} code files{routes}{entry}",
            folder(row),
            packages.kind[row],
            packages.code_files[row]
        );
    }
    for (group, prefix) in result.package_groups.prefix.iter().enumerate() {
        let members = (0..packages.dir.len())
            .filter(|&row| packages.group[row] == Some(group as u32))
            .count();
        let linked = if result.package_groups.linked[group] {
            "linked by imports"
        } else {
            "by name only"
        };
        println!("  group {prefix}: {members} packages, {linked}");
    }
    print_externals(result);
    if let Some(expected) = expected {
        compare(result, expected, &folder);
    }
}

/// The dependencies most imported, outside packages and in each.
fn print_externals(result: &AnalysisResult) {
    let externals = &result.externals;
    let mut owners: Vec<Option<u32>> = externals.package.clone();
    owners.dedup();
    for owner in owners {
        let mut rows: Vec<usize> = (0..externals.name.len())
            .filter(|&row| externals.package[row] == owner)
            .collect();
        rows.sort_by_key(|&row| std::cmp::Reverse(externals.files[row]));
        let shown: Vec<String> = rows
            .iter()
            .take(SHOWN_EXTERNALS)
            .map(|&row| format!("{} {}", externals.name[row], externals.files[row]))
            .collect();
        let owner = owner.map_or_else(
            || "outside packages".to_owned(),
            |package| result.packages.name[package as usize].clone(),
        );
        println!(
            "  imports of {owner}: {} ({} in all)",
            shown.join(", "),
            rows.len()
        );
    }
}

fn compare(result: &AnalysisResult, expected: &Expected, folder: &dyn Fn(usize) -> String) {
    let packages = &result.packages;
    let found: Vec<String> = (0..packages.dir.len()).map(folder).collect();
    let apps: Vec<String> = (0..packages.dir.len())
        .filter(|&row| packages.kind[row] == PackageKind::App)
        .map(folder)
        .collect();
    if let Some(workspace) = &expected.workspace {
        let kind = result
            .workspace
            .as_ref()
            .map(|workspace| format!("{:?}", workspace.kind).to_lowercase());
        let ok = workspace.first().map(|kind| kind.to_lowercase()) == kind;
        println!(
            "  expected workspace {workspace:?}: {}",
            if ok { "ok" } else { "differs" }
        );
    }
    let mut gaps = 0;
    for (what, expected, found) in [
        ("packages", &expected.packages, &found),
        ("apps", &expected.apps, &apps),
    ] {
        let Some(expected) = expected else {
            continue;
        };
        let missing: Vec<&String> = expected.iter().filter(|dir| !found.contains(dir)).collect();
        let extra: Vec<&String> = found.iter().filter(|dir| !expected.contains(dir)).collect();
        gaps += missing.len() + extra.len();
        println!(
            "  expected {what}: {}/{} found, missing {missing:?}, extra {extra:?}",
            expected.len() - missing.len(),
            expected.len()
        );
    }
    for (dir, framework) in &expected.frameworks {
        let row = found.iter().position(|known| known == dir);
        let actual = row
            .and_then(|row| packages.framework[row])
            .map(|framework| format!("{framework:?}"));
        if actual.as_deref().map(str::to_lowercase) != Some(framework.to_lowercase()) {
            gaps += 1;
            println!("  expected framework of {dir}: {framework}, found {actual:?}");
        }
    }
    let groups = &result.package_groups;
    for (prefix, members) in &expected.groups {
        let actual: Vec<String> = groups
            .prefix
            .iter()
            .position(|known| known == prefix)
            .map(|group| {
                (0..packages.dir.len())
                    .filter(|&row| packages.group[row] == Some(group as u32))
                    .map(folder)
                    .collect()
            })
            .unwrap_or_default();
        let mut sorted = members.clone();
        sorted.sort();
        let mut actual_sorted = actual.clone();
        actual_sorted.sort();
        if sorted != actual_sorted {
            gaps += 1;
            println!("  expected group {prefix}: {members:?}, found {actual:?}");
        }
    }
    let unexpected: Vec<&String> = groups
        .prefix
        .iter()
        .filter(|prefix| !expected.groups.iter().any(|(known, _)| known == *prefix))
        .collect();
    if expected.packages.is_some() && !unexpected.is_empty() {
        gaps += unexpected.len();
        println!("  groups found but not expected: {unexpected:?}");
    }
    if !expected.built_on.is_empty() {
        let externals = &result.externals;
        let mut rows: Vec<usize> = (0..externals.name.len()).collect();
        rows.sort_by_key(|&row| std::cmp::Reverse(externals.files[row]));
        let top: Vec<&String> = rows
            .iter()
            .take(SHOWN_EXTERNALS)
            .map(|&row| &externals.name[row])
            .collect();
        let hits = expected
            .built_on
            .iter()
            .filter(|name| top.contains(name))
            .count();
        gaps += expected.built_on.len() - hits;
        println!(
            "  expected built on {:?}: {hits}/{} among the {SHOWN_EXTERNALS} most imported",
            expected.built_on,
            expected.built_on.len()
        );
    }
    println!("  package gaps: {gaps}");
}
