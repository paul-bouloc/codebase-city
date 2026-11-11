//! The steps read from the structure of the islands: layers and cycles.

use model::{AnalysisResult, TourStep};

use super::monorepo::Monorepo;
use super::{count, first_max};

/// Fewer islands in layers say little about the architecture.
const MIN_LAYERED_ISLANDS: usize = 3;

/// How the imports between islands follow their layers, when there are
/// two layers or more and enough islands in them.
pub(super) fn layers(result: &AnalysisResult) -> Option<TourStep> {
    let layers = &result.islands.layer;
    let mut distinct: Vec<u32> = layers.iter().flatten().copied().collect();
    let layered = distinct.len();
    distinct.sort_unstable();
    distinct.dedup();
    if layered < MIN_LAYERED_ISLANDS || distinct.len() < 2 {
        return None;
    }
    let links = &result.links;
    let (mut down, mut level, mut up) = (0u64, 0u64, 0u64);
    for row in 0..links.from.len() {
        let from = layers[links.from[row] as usize];
        let to = layers[links.to[row] as usize];
        let (Some(from), Some(to)) = (from, to) else {
            continue;
        };
        let imports = u64::from(links.imports[row]);
        if to < from {
            down += imports;
        } else if to == from {
            level += imports;
        }
        // Going up, the imports that are not counted upward are a barrel's
        // re-exports: not a dependency
        up += u64::from(links.upward[row]);
    }
    Some(TourStep::Layers {
        down: count(down),
        level: count(level),
        up: count(up),
        worst_link: first_max(links.upward.iter().map(|&upward| u64::from(upward))),
    })
}

/// The largest loop, and the deepest folder that holds it; in a monorepo,
/// the package that holds it and the loops that cross packages.
pub(super) fn cycles(result: &AnalysisResult, repo: Option<&Monorepo<'_>>) -> Option<TourStep> {
    let members = result.cycles.members.first()?;
    let parents = &result.dirs.parent;
    let ancestors = |dir: u32| {
        let mut chain = vec![dir];
        let mut current = dir;
        while let Some(parent) = parents[current as usize] {
            chain.push(parent);
            current = parent;
        }
        chain.reverse();
        chain
    };
    let mut common = ancestors(result.files.dir[members[0] as usize]);
    for &file in &members[1..] {
        let chain = ancestors(result.files.dir[file as usize]);
        let shared = common
            .iter()
            .zip(&chain)
            .take_while(|(a, b)| a == b)
            .count();
        common.truncate(shared);
    }
    // The package that holds all the files of a loop, if one does
    let package_of = |members: &[u32]| {
        let repo = repo?;
        let package = repo.package_of_file(members[0] as usize)?;
        members[1..]
            .iter()
            .all(|&file| repo.package_of_file(file as usize) == Some(package))
            .then_some(package)
    };
    let package = package_of(members);
    let (mut in_package, mut crossing) = (0u64, 0u64);
    if repo.is_some() {
        for members in &result.cycles.members {
            match package_of(members) {
                None => crossing += 1,
                Some(holder) => in_package += u64::from(Some(holder) == package),
            }
        }
    }
    Some(TourStep::Cycles {
        cycle: 0,
        // The root is everyone's ancestor
        dir: common.last().copied().unwrap_or(0),
        package,
        in_package: count(in_package),
        crossing: count(crossing),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::tour::fixture::Fixture;
    use model::Scope;

    #[test]
    fn imports_between_layers_go_down_level_or_up() {
        let mut repo = Fixture::layered();
        assert_eq!(
            layers(&repo.result),
            Some(TourStep::Layers {
                down: 4,
                level: 0,
                up: 0,
                worst_link: None,
            })
        );
        let lib = repo.island("lib");
        repo.file("lib/x.ts", Scope::Source);
        repo.result.islands.layer[lib as usize] = Some(2);
        let [core, ui] = ["core", "ui"].map(|name| repo.island(name));
        // From `core` (1) up to `ui` (2) and `lib` (2), and between the two
        repo.result.links = model::Links::default();
        repo.link(core, ui, 3, 3);
        repo.link(core, lib, 4, 1);
        repo.link(ui, lib, 2, 0);
        assert_eq!(
            layers(&repo.result),
            Some(TourStep::Layers {
                down: 0,
                level: 2,
                up: 4,
                worst_link: Some(0),
            })
        );
    }

    #[test]
    fn layers_need_three_islands_in_two_layers() {
        let mut repo = Fixture::layered();
        let app = repo.island("app");
        repo.result.islands.layer[app as usize] = None;
        assert_eq!(layers(&repo.result), None);
        let mut repo = Fixture::layered();
        for layer in &mut repo.result.islands.layer {
            *layer = layer.map(|_| 1);
        }
        assert_eq!(layers(&repo.result), None);
    }

    #[test]
    fn a_cycle_is_shown_in_the_deepest_folder_that_holds_it() {
        let mut repo = Fixture::layered();
        assert_eq!(cycles(&repo.result, None), None);
        let loop_files = [
            "core/io/read.ts",
            "core/io/net/socket.ts",
            "core/io/write.ts",
        ]
        .map(|path| crate::saturating_u32(repo.file(path, Scope::Source)));
        let io = repo.dir("core/io");
        repo.result.cycles.members = vec![loop_files.to_vec(), vec![0, 1]];
        assert_eq!(
            cycles(&repo.result, None),
            Some(TourStep::Cycles {
                cycle: 0,
                dir: io,
                package: None,
                in_package: 0,
                crossing: 0,
            })
        );
        // With `app/main.ts`, only the root holds the loop
        repo.result.cycles.members[0].push(5);
        assert_eq!(
            cycles(&repo.result, None),
            Some(TourStep::Cycles {
                cycle: 0,
                dir: 0,
                package: None,
                in_package: 0,
                crossing: 0,
            })
        );
    }

    #[test]
    fn in_a_monorepo_a_cycle_is_shown_in_its_package() {
        let mut repo = Fixture::monorepo();
        let [page, a, b, admin, log] = [
            "apps/web/pages/index.ts",
            "apps/web/components/a.ts",
            "apps/web/components/b.ts",
            "apps/admin/index.ts",
            "libs/log/index.ts",
        ]
        .map(|path| crate::saturating_u32(repo.file_at(path)));
        repo.result.cycles.members = vec![vec![page, a, b], vec![a, b], vec![admin, log]];
        let web = repo.dir("apps/web");
        let monorepo = Monorepo::of(&repo.result);
        assert_eq!(
            cycles(&repo.result, monorepo.as_ref()),
            Some(TourStep::Cycles {
                cycle: 0,
                dir: web,
                package: Some(0),
                in_package: 2,
                crossing: 1,
            })
        );
        // The largest loop crosses two packages
        repo.result.cycles.members.swap(0, 2);
        let monorepo = Monorepo::of(&repo.result);
        assert_eq!(
            cycles(&repo.result, monorepo.as_ref()),
            Some(TourStep::Cycles {
                cycle: 0,
                dir: 0,
                package: None,
                in_package: 0,
                crossing: 1,
            })
        );
    }
}
