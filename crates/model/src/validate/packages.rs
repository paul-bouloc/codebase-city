//! Checks on the packages of a result: the workspace that declares them,
//! their groups and the dependencies they import.

use super::{InvalidResult, in_bounds, in_bounds_or_null, same_length};
use crate::result::AnalysisResult;

pub(super) fn packages(result: &AnalysisResult) -> Result<(), InvalidResult> {
    let file_count = result.files.dir.len();
    let dir_count = result.dirs.parent.len();
    if let Some(workspace) = &result.workspace {
        in_bounds("workspace.manifest", &[workspace.manifest], file_count)?;
    }

    let packages = &result.packages;
    let count = packages.dir.len();
    same_length("packages.name", count, packages.name.len())?;
    same_length("packages.kind", count, packages.kind.len())?;
    same_length("packages.framework", count, packages.framework.len())?;
    same_length("packages.manifest", count, packages.manifest.len())?;
    same_length("packages.group", count, packages.group.len())?;
    same_length("packages.codeFiles", count, packages.code_files.len())?;
    same_length("packages.entry", count, packages.entry.len())?;
    same_length("packages.routes", count, packages.routes.len())?;
    same_length("packages.routeCount", count, packages.route_count.len())?;
    same_length("packages.apiRouteCount", count, packages.api_route_count.len())?;
    in_bounds("packages.dir", &packages.dir, dir_count)?;
    in_bounds_or_null("packages.manifest", &packages.manifest, file_count)?;
    in_bounds_or_null("packages.entry", &packages.entry, file_count)?;
    in_bounds_or_null("packages.routes", &packages.routes, dir_count)?;
    let groups = &result.package_groups;
    in_bounds_or_null("packages.group", &packages.group, groups.prefix.len())?;
    if count > 0 && result.workspace.is_none() {
        return Err(InvalidResult::PackagesWithoutWorkspace);
    }
    if let Some(row) = packages.dir.windows(2).position(|pair| pair[0] >= pair[1]) {
        return Err(InvalidResult::PackageOrder { row: row + 1 });
    }
    // A package inside another would split one manifest's code in two
    let mut is_package = vec![false; dir_count];
    for &dir in &packages.dir {
        is_package[dir as usize] = true;
    }
    for (row, &dir) in packages.dir.iter().enumerate() {
        let mut parent = result.dirs.parent[dir as usize];
        while let Some(dir) = parent {
            if is_package[dir as usize] {
                return Err(InvalidResult::PackageNested { row });
            }
            parent = result.dirs.parent[dir as usize];
        }
    }
    if let Some(row) = packages.name.iter().position(String::is_empty) {
        return Err(InvalidResult::PackageName { row });
    }
    for row in 0..count {
        let routes = packages.route_count[row];
        let api = packages.api_route_count[row];
        if api > routes || packages.routes[row].is_none() && routes > 0 {
            return Err(InvalidResult::PackageRoutes { row });
        }
    }

    same_length("packageGroups.linked", groups.prefix.len(), groups.linked.len())?;
    let mut members = vec![0usize; groups.prefix.len()];
    for group in packages.group.iter().flatten() {
        members[*group as usize] += 1;
    }
    if let Some(row) = (0..groups.prefix.len()).find(|&row| {
        members[row] < 2
            || groups.prefix[row].is_empty()
            || row > 0 && groups.prefix[row - 1] >= groups.prefix[row]
    }) {
        return Err(InvalidResult::PackageGroup { row });
    }

    let externals = &result.externals;
    let rows = externals.package.len();
    same_length("externals.name", rows, externals.name.len())?;
    same_length("externals.files", rows, externals.files.len())?;
    in_bounds_or_null("externals.package", &externals.package, count)?;
    for row in 0..rows {
        if externals.name[row].is_empty() || externals.files[row] == 0 {
            return Err(InvalidResult::External { row });
        }
        // `None` sorts first; strictly increasing, so a name comes once per package
        if row > 0
            && (externals.package[row - 1], &externals.name[row - 1])
                >= (externals.package[row], &externals.name[row])
        {
            return Err(InvalidResult::External { row });
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::super::tests::{invalid, result};
    use super::*;
    use crate::result::{
        Dirs, Framework, PackageGroups, PackageKind, Packages, Workspace, WorkspaceKind,
    };

    /// The fixture's `src` as one package of an npm workspace, alone in its
    /// group (made valid by [`with_two_packages`]).
    fn with_package(result: &mut AnalysisResult) {
        result.workspace = Some(Workspace {
            kind: WorkspaceKind::Npm,
            manifest: 0,
        });
        result.packages = Packages {
            dir: vec![1],
            name: vec!["@acme/app".to_owned()],
            kind: vec![PackageKind::App],
            framework: vec![Some(Framework::Nextjs)],
            manifest: vec![None],
            group: vec![None],
            code_files: vec![2],
            entry: vec![Some(1)],
            routes: vec![Some(1)],
            route_count: vec![2],
            api_route_count: vec![1],
        };
    }

    /// Two sibling packages, `src` and `lib`, grouped under `acme`.
    fn with_two_packages(result: &mut AnalysisResult) {
        with_package(result);
        result.dirs = Dirs {
            parent: vec![None, Some(0), Some(0)],
            name: vec![String::new(), "src".to_owned(), "lib".to_owned()],
            island: vec![Some(0), Some(1), Some(0)],
        };
        let packages = &mut result.packages;
        packages.dir.push(2);
        packages.name.push("acme-lib".to_owned());
        packages.kind.push(PackageKind::Library);
        packages.framework.push(None);
        packages.manifest.push(None);
        packages.group = vec![Some(0), Some(0)];
        packages.code_files.push(0);
        packages.entry.push(None);
        packages.routes.push(None);
        packages.route_count.push(0);
        packages.api_route_count.push(0);
        result.package_groups = PackageGroups {
            prefix: vec!["acme".to_owned()],
            linked: vec![false],
        };
    }

    #[test]
    fn packages_of_a_workspace_are_valid() {
        let mut result = result();
        with_two_packages(&mut result);
        assert_eq!(result.validate(), Ok(()));
    }

    #[test]
    fn packages_need_a_workspace() {
        assert_eq!(
            invalid(|result| {
                with_package(result);
                result.workspace = None;
            }),
            InvalidResult::PackagesWithoutWorkspace
        );
    }

    #[test]
    fn indexes_of_packages_point_to_existing_rows() {
        let error = invalid(|result| {
            with_package(result);
            result.packages.entry[0] = Some(9);
        });
        assert!(matches!(
            error,
            InvalidResult::IndexOutOfBounds {
                column: "packages.entry",
                ..
            }
        ));
        let error = invalid(|result| {
            with_package(result);
            result.packages.group[0] = Some(0);
        });
        assert!(matches!(
            error,
            InvalidResult::IndexOutOfBounds {
                column: "packages.group",
                ..
            }
        ));
        let error = invalid(|result| {
            with_package(result);
            result.workspace = Some(Workspace {
                kind: WorkspaceKind::Pnpm,
                manifest: 9,
            });
        });
        assert!(matches!(
            error,
            InvalidResult::IndexOutOfBounds {
                column: "workspace.manifest",
                ..
            }
        ));
    }

    #[test]
    fn packages_are_sorted_by_folder_and_never_nested() {
        assert_eq!(
            invalid(|result| {
                with_two_packages(result);
                result.packages.dir.swap(0, 1);
            }),
            InvalidResult::PackageOrder { row: 1 }
        );
        assert_eq!(
            invalid(|result| {
                with_two_packages(result);
                result.packages.dir = vec![0, 1];
            }),
            InvalidResult::PackageNested { row: 1 }
        );
    }

    #[test]
    fn a_package_has_a_name_and_routes_add_up() {
        assert_eq!(
            invalid(|result| {
                with_package(result);
                result.packages.name[0].clear();
            }),
            InvalidResult::PackageName { row: 0 }
        );
        assert_eq!(
            invalid(|result| {
                with_package(result);
                result.packages.api_route_count[0] = 3;
            }),
            InvalidResult::PackageRoutes { row: 0 }
        );
        assert_eq!(
            invalid(|result| {
                with_package(result);
                result.packages.routes[0] = None;
            }),
            InvalidResult::PackageRoutes { row: 0 }
        );
    }

    #[test]
    fn a_group_holds_two_packages_or_more() {
        assert_eq!(
            invalid(|result| {
                with_two_packages(result);
                result.packages.group[1] = None;
            }),
            InvalidResult::PackageGroup { row: 0 }
        );
        assert_eq!(
            invalid(|result| {
                with_two_packages(result);
                result.package_groups.prefix[0].clear();
            }),
            InvalidResult::PackageGroup { row: 0 }
        );
    }

    #[test]
    fn externals_are_named_counted_and_sorted() {
        assert_eq!(
            invalid(|result| result.externals.files[0] = 0),
            InvalidResult::External { row: 0 }
        );
        assert_eq!(
            invalid(|result| result.externals.name[0].clear()),
            InvalidResult::External { row: 0 }
        );
        assert_eq!(
            invalid(|result| {
                result.externals.package.push(None);
                result.externals.name.push("react".to_owned());
                result.externals.files.push(1);
            }),
            InvalidResult::External { row: 1 }
        );
        let error = invalid(|result| result.externals.package[0] = Some(0));
        assert!(matches!(
            error,
            InvalidResult::IndexOutOfBounds {
                column: "externals.package",
                ..
            }
        ));
    }
}
