//! Go: an import names a package, the folder at that path inside the module
//! that declares it. Modules come from every `go.mod` of the repository.

use std::collections::HashMap;

use model::Confidence;

use super::{Index, Outcome, Target, under};
use crate::files::split_path;

pub(super) struct Resolver {
    /// Module path and folder of each `go.mod`, the longest path first so
    /// that a nested module wins over the one around it.
    modules: Vec<(String, String)>,
}

impl Resolver {
    pub(super) fn new(manifests: &HashMap<&str, &[u8]>) -> Self {
        let mut modules: Vec<(String, String)> = manifests
            .iter()
            .filter(|(path, _)| split_path(path).1 == "go.mod")
            .filter_map(|(path, content)| {
                let module = module_path(&String::from_utf8_lossy(content))?;
                Some((module, split_path(path).0.to_owned()))
            })
            .collect();
        modules.sort_by(|a, b| b.0.len().cmp(&a.0.len()).then_with(|| a.cmp(b)));
        Self { modules }
    }

    pub(super) fn resolve(&self, index: &Index<'_>, specifier: &str) -> Outcome {
        let Some((module, dir)) = self.modules.iter().find(|(module, _)| {
            specifier == module
                || specifier
                    .strip_prefix(module.as_str())
                    .is_some_and(|rest| rest.starts_with('/'))
        }) else {
            return Outcome::External;
        };
        let rest = specifier[module.len()..].trim_start_matches('/');
        let package = under(dir, rest);
        let has_go_file = index
            .files_in(&package)
            .iter()
            .any(|&row| index.path(row).ends_with(".go"));
        if has_go_file {
            Outcome::Resolved(vec![(Target::Dir(package), Confidence::Exact)])
        } else {
            Outcome::Unresolved
        }
    }
}

/// The path of the `module` directive, quoted or not, comment left out.
fn module_path(go_mod: &str) -> Option<String> {
    go_mod.lines().find_map(|line| {
        let line = line.split("//").next()?.trim();
        let path = line.strip_prefix("module")?;
        if !path.starts_with([' ', '\t']) {
            return None;
        }
        let path = path.trim().trim_matches(['"', '`']);
        (!path.is_empty()).then(|| path.to_owned())
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_module_directive_may_be_quoted_or_commented() {
        assert_eq!(
            module_path("// header\nmodule github.com/acme/harbor // the module\n\ngo 1.22\n")
                .as_deref(),
            Some("github.com/acme/harbor")
        );
        assert_eq!(
            module_path("module \"example.com/x\"\n").as_deref(),
            Some("example.com/x")
        );
        assert_eq!(module_path("modules x\n"), None);
    }
}
