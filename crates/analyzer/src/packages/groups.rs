//! Packages grouped by the prefix of their folder names: `acme`, `acme-api`
//! and `acme-web`. A name shared by two packages proves nothing on its
//! own, so a prefix groups three packages or more, or two that import one
//! another.

use std::collections::{BTreeMap, HashSet};

/// Packages a prefix groups three of, at least.
const MIN_UNLINKED: usize = 3;

/// One group: its prefix, its packages (rows, sorted), and whether an
/// import joins two of them.
#[derive(Debug, PartialEq, Eq)]
pub(super) struct Group {
    pub prefix: String,
    pub members: Vec<usize>,
    pub linked: bool,
}

/// `names` are the folder names of the packages; `imports` the pairs of
/// packages (importing, imported) that a production import joins. Groups
/// come sorted by prefix.
pub(super) fn groups(names: &[&str], imports: &HashSet<(usize, usize)>) -> Vec<Group> {
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
            (members.len() >= 2 && (linked || members.len() >= MIN_UNLINKED)).then(|| Group {
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
        groups(names, &imports.iter().copied().collect())
            .into_iter()
            .map(|group| (group.prefix, group.members, group.linked))
            .collect()
    }

    #[test]
    fn three_names_group_without_imports() {
        let names = ["acme", "acme-app", "acme-site", "acme-ui", "web"];
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
}
