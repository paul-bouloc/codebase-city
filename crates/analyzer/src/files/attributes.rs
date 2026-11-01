//! The Linguist overrides of `.gitattributes` files: `linguist-generated`
//! and `linguist-vendored`, set, unset or made unspecified again.

use globset::{Glob, GlobBuilder, GlobSet, GlobSetBuilder};

/// The overrides that apply to one path; `None` when no rule sets them.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct Attribute {
    pub generated: Option<bool>,
    pub vendored: Option<bool>,
}

/// The rules of every `.gitattributes` file of a repository.
#[derive(Debug, Default)]
pub struct Attributes {
    /// Shallowest files first, then in file order: the last match wins, as in git.
    rules: Vec<Rule>,
    /// The globs of `rules`, in the same order, matched in one pass.
    set: GlobSet,
}

#[derive(Debug)]
struct Rule {
    glob: Glob,
    depth: usize,
    generated: Setting,
    vendored: Setting,
}

/// What a rule does to one attribute: `None` when it does not mention it,
/// `Some(None)` when it makes it unspecified again (`!attr`), which hands the
/// file back to the usual detection.
type Setting = Option<Option<bool>>;

impl Attributes {
    /// Adds the rules of the `.gitattributes` file found in `dir` (`""` for
    /// the root). Lines without a Linguist attribute are ignored, and so are
    /// patterns that are not valid globs.
    pub fn add(&mut self, dir: &str, content: &[u8]) {
        let depth = if dir.is_empty() {
            0
        } else {
            dir.split('/').count()
        };
        let prefix = if dir.is_empty() {
            String::new()
        } else {
            format!("{}/", globset::escape(dir))
        };
        for line in String::from_utf8_lossy(content).lines() {
            let mut parts = line.split_whitespace();
            let Some(pattern) = parts.next() else {
                continue;
            };
            if pattern.starts_with('#') {
                continue;
            }
            let (generated, vendored) = parse_settings(parts);
            if generated.is_none() && vendored.is_none() {
                continue;
            }
            // A pattern without a slash matches a name at any depth; with one,
            // it is relative to the folder of the `.gitattributes` file.
            let pattern = pattern.trim_end_matches('/');
            let glob = if pattern.contains('/') {
                format!("{prefix}{}", pattern.trim_start_matches('/'))
            } else {
                format!("{prefix}**/{pattern}")
            };
            // Linguist users write `docs/ linguist-vendored` for a whole
            // folder, which git alone would not apply to its files.
            for glob in [format!("{glob}/**"), glob] {
                if let Ok(glob) = GlobBuilder::new(&glob).literal_separator(true).build() {
                    self.rules.push(Rule {
                        glob,
                        depth,
                        generated,
                        vendored,
                    });
                }
            }
        }
        // Stable: rules of the same depth keep their file order
        self.rules.sort_by_key(|rule| rule.depth);
        let mut set = GlobSetBuilder::new();
        for rule in &self.rules {
            set.add(rule.glob.clone());
        }
        // Every glob compiled on its own already; a set too large to build
        // leaves the overrides out rather than failing the analysis
        self.set = set.build().unwrap_or_else(|_| GlobSet::empty());
    }

    pub fn is_empty(&self) -> bool {
        self.rules.is_empty()
    }

    pub fn lookup(&self, path: &str) -> Attribute {
        let mut matches = self.set.matches(path);
        matches.sort_unstable();
        let mut found = Attribute::default();
        for rule in matches.into_iter().map(|index| &self.rules[index]) {
            if let Some(generated) = rule.generated {
                found.generated = generated;
            }
            if let Some(vendored) = rule.vendored {
                found.vendored = vendored;
            }
        }
        found
    }
}

/// The settings of `linguist-generated` and `linguist-vendored` on one line.
fn parse_settings<'a>(parts: impl Iterator<Item = &'a str>) -> (Setting, Setting) {
    let (mut generated, mut vendored) = (None, None);
    for part in parts {
        let (value, part) = if let Some(rest) = part.strip_prefix('!') {
            (None, rest)
        } else if let Some(rest) = part.strip_prefix('-') {
            (Some(false), rest)
        } else {
            match part.split_once('=') {
                Some((name, value)) => (Some(value != "false"), name),
                None => (Some(true), part),
            }
        };
        match part {
            "linguist-generated" => generated = Some(value),
            "linguist-vendored" => vendored = Some(value),
            _ => {}
        }
    }
    (generated, vendored)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn generated(value: bool) -> Attribute {
        Attribute {
            generated: Some(value),
            vendored: None,
        }
    }

    #[test]
    fn a_name_pattern_matches_at_any_depth() {
        let mut attributes = Attributes::default();
        attributes.add("", b"*.pb.ts linguist-generated\n");
        assert_eq!(attributes.lookup("api/user.pb.ts"), generated(true));
        assert_eq!(attributes.lookup("user.pb.ts"), generated(true));
        assert_eq!(attributes.lookup("api/user.ts"), Attribute::default());
    }

    #[test]
    fn a_path_pattern_is_relative_to_its_folder() {
        let mut attributes = Attributes::default();
        attributes.add("web", b"/static/** linguist-vendored\n");
        let vendored = Attribute {
            generated: None,
            vendored: Some(true),
        };
        assert_eq!(attributes.lookup("web/static/lib.js"), vendored);
        assert_eq!(attributes.lookup("static/lib.js"), Attribute::default());
    }

    #[test]
    fn a_folder_pattern_covers_its_files() {
        let mut attributes = Attributes::default();
        attributes.add("", b"docs/ linguist-vendored\n");
        assert_eq!(attributes.lookup("docs/a/b.md").vendored, Some(true));
    }

    #[test]
    fn values_can_be_unset_or_false() {
        let mut attributes = Attributes::default();
        attributes.add(
            "",
            b"a.ts -linguist-generated\nb.ts linguist-generated=false\n",
        );
        assert_eq!(attributes.lookup("a.ts"), generated(false));
        assert_eq!(attributes.lookup("b.ts"), generated(false));
    }

    #[test]
    fn a_negated_value_is_unspecified_again() {
        let mut attributes = Attributes::default();
        attributes.add("", b"*.ts linguist-generated\n");
        attributes.add("api", b"*.ts !linguist-generated\n");
        assert_eq!(attributes.lookup("api/user.ts"), Attribute::default());
        assert_eq!(attributes.lookup("web/user.ts"), generated(true));
    }

    #[test]
    fn deeper_files_and_later_lines_win() {
        let mut attributes = Attributes::default();
        attributes.add("api", b"*.ts -linguist-generated\n");
        attributes.add(
            "",
            b"*.ts linguist-generated\napi/*.ts linguist-generated\n",
        );
        assert_eq!(attributes.lookup("api/user.ts"), generated(false));
        assert_eq!(attributes.lookup("web/user.ts"), generated(true));

        let mut attributes = Attributes::default();
        attributes.add("", b"*.ts linguist-generated\n*.ts -linguist-generated\n");
        assert_eq!(attributes.lookup("user.ts"), generated(false));
    }

    #[test]
    fn other_lines_are_ignored() {
        let mut attributes = Attributes::default();
        attributes.add(
            "",
            b"# comment\n\n*.sh text eol=lf\n[bad linguist-generated\n",
        );
        assert!(attributes.is_empty());
    }
}
