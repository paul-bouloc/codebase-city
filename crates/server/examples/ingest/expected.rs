//! What a person expects of a repository, read from `--expect`.

/// Roles a person expects, by path; a Go package's path ends with `/`.
#[derive(Default)]
pub(crate) struct Expected {
    pub(crate) entries: Vec<String>,
    pub(crate) foundations: Vec<String>,
    pub(crate) conductors: Vec<String>,
    /// Islands by path, layer by layer from the bottom.
    pub(crate) layers: Vec<Vec<String>>,
}

impl Expected {
    /// Reads `key: [a, b]` lines; anything else is ignored, comments too.
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
                _ => {}
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
