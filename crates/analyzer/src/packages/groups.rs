//! Packages grouped by the prefix of their folder names: `acme`, `acme-api`
//! and `acme-web`. A name shared by two packages proves nothing on its
//! own, so a prefix groups three packages or more, or two that import one
//! another. A prefix that names the whole repository (`twenty-front`,
//! `twenty-server` in `twenty`) is a namespace: it groups nothing.

use std::collections::{BTreeMap, HashSet};

/// Packages a prefix groups three of, at least.
const MIN_UNLINKED: usize = 3;
/// A prefix most packages carry is the project's namespace, whatever the
/// repository is called: more than three quarters (sveltejs/kit's seven
/// `adapter-*` of twelve stay a family).
const NAMESPACE_SHARE: (usize, usize) = (3, 4);

/// One group: its prefix, its packages (rows, sorted), and whether an
/// import joins two of them.
#[derive(Debug, PartialEq, Eq)]
pub(super) struct Group {
    pub prefix: String,
    pub members: Vec<usize>,
    pub linked: bool,
}

/// `names` are the folder names of the packages; `imports` the pairs of
/// packages (importing, imported) that a production import joins;
/// `namespaces` the names of the repository and of its root manifest
/// (`twenty-monorepo` names the namespace `twenty`). Groups come sorted by
/// prefix.
pub(super) fn groups(
    names: &[&str],
    imports: &HashSet<(usize, usize)>,
    namespaces: &[&str],
) -> Vec<Group> {
    let namespace = |prefix: &str, members: usize| {
        namespaces.iter().any(|name| {
            let name = name.rsplit('/').next().unwrap_or(name);
            name == prefix
                || name
                    .strip_prefix(prefix)
                    .is_some_and(|rest| rest.starts_with('-'))
        }) || members * NAMESPACE_SHARE.1 > names.len() * NAMESPACE_SHARE.0
    };
    let mut by_prefix: BTreeMap<&str, Vec<usize>> = BTreeMap::new();
    for (row, name) in names.iter().enumerate() {
        if let Some((prefix, rest)) = name.split_once('-')
            && !prefix.is_empty()
            && !rest.is_empty()
        {
            by_prefix.entry(prefix).or_default().push(row);
        }
    }
    by_prefix
        .into_iter()
        .filter_map(|(prefix, mut members)| {
            // The package named after the prefix joins its group
            members.extend(names.iter().position(|name| *name == prefix));
            members.sort_unstable();
            let linked = members.iter().any(|&from| {
                members
                    .iter()
                    .any(|&to| from != to && imports.contains(&(from, to)))
            });
            let grouped = members.len() >= 2 && (linked || members.len() >= MIN_UNLINKED);
            (grouped && !namespace(prefix, members.len())).then(|| Group {
                prefix: prefix.to_owned(),
                members,
                linked,
            })
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn prefixes(names: &[&str], imports: &[(usize, usize)]) -> Vec<(String, Vec<usize>, bool)> {
        groups(names, &imports.iter().copied().collect(), &["repo"])
            .into_iter()
            .map(|group| (group.prefix, group.members, group.linked))
            .collect()
    }

    #[test]
    fn three_names_group_without_imports() {
        let names = ["acme", "acme-app", "acme-site", "acme-ui", "web", "docs"];
        assert_eq!(
            prefixes(&names, &[]),
            [("acme".to_owned(), vec![0, 1, 2, 3], false)]
        );
        let platforms = [
            "common",
            "platform-express",
            "platform-fastify",
            "platform-ws",
        ];
        assert_eq!(
            prefixes(&platforms, &[(1, 0)]),
            [("platform".to_owned(), vec![1, 2, 3], false)]
        );
    }

    #[test]
    fn two_names_group_only_when_an_import_joins_them() {
        let names = [
            "api",
            "api-contracts",
            "mobile",
            "mobile-api",
            "server-a",
            "server-b",
        ];
        assert_eq!(
            prefixes(&names, &[(0, 1), (4, 2)]),
            [("api".to_owned(), vec![0, 1], true)]
        );
    }

    #[test]
    fn a_name_without_a_prefix_groups_nothing() {
        assert!(prefixes(&["-a", "-b", "-c", "x-", "y"], &[]).is_empty());
    }

    #[test]
    fn the_name_of_the_repository_is_a_namespace() {
        let names = [
            "twenty-front",
            "twenty-server",
            "twenty-ui",
            "docs",
            "e2e",
            "utils",
        ];
        let imports = HashSet::from([(0, 2)]);
        assert!(groups(&names, &imports, &["twenty"]).is_empty());
        // The root manifest's name, scoped or not
        assert!(groups(&names, &imports, &["acme", "twenty-monorepo"]).is_empty());
        assert!(groups(&names, &imports, &["@org/twenty"]).is_empty());
        assert_eq!(groups(&names, &imports, &["acme"]).len(), 1);
    }

    #[test]
    fn a_prefix_on_more_than_three_quarters_of_the_packages_is_a_namespace() {
        let mut names = vec![
            "babel-core",
            "babel-parser",
            "babel-types",
            "babel-cli",
            "eslint",
        ];
        assert!(prefixes(&names, &[]).is_empty());
        // Three quarters exactly, and fewer, still group
        names.push("codemods");
        names.truncate(4);
        names[3] = "eslint";
        assert_eq!(prefixes(&names, &[]).len(), 1);
        let kit = [
            "adapter-auto",
            "adapter-bun",
            "adapter-cloudflare",
            "adapter-netlify",
            "adapter-node",
            "adapter-static",
            "adapter-vercel",
            "enhanced-img",
            "kit",
            "package",
            "test-redirect-importer",
            "basic",
        ];
        assert_eq!(prefixes(&kit, &[]).len(), 1);
    }
}
