//! What a person expects of a repository, read from `--expect`.

/// Roles a person expects, by path; a Go package's path ends with `/`.
#[derive(Default)]
pub(crate) struct Expected {
    pub(crate) entries: Vec<String>,
    pub(crate) foundations: Vec<String>,
    pub(crate) conductors: Vec<String>,
    /// Islands by path, layer by layer from the bottom.
    pub(crate) layers: Vec<Vec<String>>,
    /// The kind of workspace (`[npm]`), `[]` for none; `None` when not
    /// written.
    pub(crate) workspace: Option<Vec<String>>,
    /// Package folders, and those that are apps; `None` when not written.
    pub(crate) packages: Option<Vec<String>>,
    pub(crate) apps: Option<Vec<String>>,
    /// `folder=framework` pairs, for the packages listed only.
    pub(crate) frameworks: Vec<(String, String)>,
    /// `group prefix: [folders]` lines.
    pub(crate) groups: Vec<(String, Vec<String>)>,
    /// Dependencies expected among the most imported ones.
    pub(crate) built_on: Vec<String>,
}

impl Expected {
    /// Reads `key: [a, b]` lines (`group prefix: [a, b]` for a group);
    /// anything else is ignored, comments too.
    pub(crate) fn parse(text: &str) -> Self {
        let mut expected = Self::default();
        for line in text.lines() {
            let Some((key, list)) = line.split_once(':') else {
                continue;
            };
            let list = list.split('#').next().unwrap_or_default().trim();
            if key.trim() == "layers" {
                expected.layers = parse_layers(list);
                continue;
            }
            let Some(list) = list
                .strip_prefix('[')
                .and_then(|list| list.strip_suffix(']'))
            else {
                continue;
            };
            let paths: Vec<String> = list
                .split(',')
                .map(|path| {
                    path.trim()
                        .trim_matches(|c| c == '"' || c == '\'')
                        .to_owned()
                })
                .filter(|path| !path.is_empty())
                .collect();
            match key.trim() {
                "entries" => expected.entries = paths,
                "foundations" => expected.foundations = paths,
                "conductors" => expected.conductors = paths,
                "workspace" => expected.workspace = Some(paths),
                "packages" => expected.packages = Some(paths),
                "apps" => expected.apps = Some(paths),
                "frameworks" => {
                    expected.frameworks = paths
                        .iter()
                        .filter_map(|pair| {
                            let (dir, framework) = pair.split_once('=')?;
                            Some((dir.trim().to_owned(), framework.trim().to_owned()))
                        })
                        .collect();
                }
                "built_on" => expected.built_on = paths,
                key => {
                    if let Some(prefix) = key.strip_prefix("group ") {
                        expected.groups.push((prefix.trim().to_owned(), paths));
                    }
                }
            }
        }
        expected
    }
}

/// `[a, [b, c], d]`: one layer per item, a bracketed item being several
/// islands of the same layer.
fn parse_layers(list: &str) -> Vec<Vec<String>> {
    let inner = list
        .strip_prefix('[')
        .and_then(|list| list.strip_suffix(']'))
        .unwrap_or_default();
    let mut layers = Vec::new();
    let mut current: Option<Vec<String>> = None;
    for token in inner.split(',') {
        let token = token.trim();
        let opens = token.starts_with('[');
        let closes = token.ends_with(']');
        let path = token
            .trim_matches(|c| c == '[' || c == ']')
            .trim()
            .to_owned();
        match (&mut current, opens) {
            (Some(group), _) => group.push(path),
            (None, true) => current = Some(vec![path]),
            (None, false) if !path.is_empty() => layers.push(vec![path]),
            (None, false) => {}
        }
        if closes && let Some(group) = current.take() {
            layers.push(group);
        }
    }
    layers
}
