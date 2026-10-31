//! The Linguist overrides of `.gitattributes` files: `linguist-generated`
//! and `linguist-vendored`, set, unset or negated.

use globset::{GlobBuilder, GlobMatcher};

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
}

#[derive(Debug)]
struct Rule {
    matcher: GlobMatcher,
    depth: usize,
    attribute: Attribute,
}

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
            let attribute = parse_attribute(parts);
            if attribute == Attribute::default() {
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
                        matcher: glob.compile_matcher(),
                        depth,
                        attribute,
                    });
                }
            }
        }
        self.rules.sort_by_key(|rule| rule.depth);
    }

    pub fn is_empty(&self) -> bool {
        self.rules.is_empty()
    }

    pub fn lookup(&self, path: &str) -> Attribute {
        let mut found = Attribute::default();
        for rule in self.rules.iter().filter(|rule| rule.matcher.is_match(path)) {
            found.generated = rule.attribute.generated.or(found.generated);
            found.vendored = rule.attribute.vendored.or(found.vendored);
        }
        found
    }
}

fn parse_attribute<'a>(parts: impl Iterator<Item = &'a str>) -> Attribute {
    let mut attribute = Attribute::default();
    for part in parts {
        let (unset, part) = match part.strip_prefix(['-', '!']) {
            Some(rest) => (true, rest),
            None => (false, part),
        };
        let (name, value) = match part.split_once('=') {
            Some((name, value)) => (name, !unset && value != "false"),
            None => (part, !unset),
        };
        match name {
            "linguist-generated" => attribute.generated = Some(value),
            "linguist-vendored" => attribute.vendored = Some(value),
            _ => {}
        }
    }
    attribute
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
            b"a.ts -linguist-generated\nb.ts linguist-generated=false\nc.ts !linguist-generated\n",
        );
        assert_eq!(attributes.lookup("a.ts"), generated(false));
        assert_eq!(attributes.lookup("b.ts"), generated(false));
        assert_eq!(attributes.lookup("c.ts"), generated(false));
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
