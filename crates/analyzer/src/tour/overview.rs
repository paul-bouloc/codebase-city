//! The first step: the size of the city and what it is made of.

use model::{AnalysisResult, Scope, TourStep};

use super::{count, first_max, is_production, island_of_file};
use crate::files::Language;

/// What a result names the language of an unknown extension.
const OTHER: &str = "Other";

pub(super) fn step(result: &AnalysisResult) -> TourStep {
    let files = &result.files;
    let mut shown = 0u64;
    let mut lines = 0u64;
    let mut by_language = vec![0u64; result.languages.len()];
    let mut by_island = vec![0u64; result.islands.dir.len()];
    let mut code_by_island = vec![0u64; result.islands.dir.len()];
    // Code as layers count it: a barrel alone makes no code
    let mut layered_code = vec![false; result.islands.dir.len()];
    for file in 0..files.dir.len() {
        if files.generated[file] {
            continue;
        }
        shown += 1;
        let island = island_of_file(result, file).map(|island| island as usize);
        if let Some(island) = island {
            by_island[island] += 1;
        }
        if is_production(result, file) {
            lines += u64::from(files.lines[file]);
            by_language[files.language[file] as usize] += u64::from(files.lines[file]);
            if let Some(island) = island {
                code_by_island[island] += 1;
                layered_code[island] |= !files.barrel[file];
            }
        }
    }
    // An unknown extension is no language: translation catalogs (`.po`)
    // can outweigh the code
    let language = first_max(by_language.iter().enumerate().map(|(row, &lines)| {
        if result.languages[row] == OTHER {
            0
        } else {
            lines
        }
    }));
    // Outside the code, not its entrance: the root island is left out. An
    // island of code outside a monorepo's packages has no layer, but it is
    // code
    let outside = by_island.iter().enumerate().map(|(island, &files)| {
        let root = result.islands.dir[island] == 0;
        if root || layered_code[island] {
            0
        } else {
            files
        }
    });
    TourStep::Overview {
        files: count(shown),
        generated: count(
            files
                .generated
                .iter()
                .filter(|&&generated| generated)
                .count() as u64,
        ),
        lines: count(lines),
        language,
        language_lines: language.map_or(0, |language| count(by_language[language as usize])),
        language_read: language.is_some_and(|language| {
            Language::analyzed_named(&result.languages[language as usize]).is_some()
        }),
        // Docs or examples can outnumber the code: the biggest island is the
        // one with the most code, or without code the one with most files
        biggest_island: first_max(code_by_island).or_else(|| first_max(by_island.iter().copied())),
        outside_island: first_max(outside),
        doc_languages: doc_languages(result),
    }
}

/// Two-letter language codes (ISO 639-1), as documentation folders are
/// named: `docs/en`, `docs/pt`.
const LANGUAGE_CODES: &[&str] = &[
    "aa", "ab", "af", "ak", "am", "an", "ar", "as", "av", "ay", "az", "ba", "be", "bg", "bi", "bm",
    "bn", "bo", "br", "bs", "ca", "ce", "ch", "co", "cr", "cs", "cu", "cv", "cy", "da", "de", "dv",
    "dz", "ee", "el", "en", "eo", "es", "et", "eu", "fa", "ff", "fi", "fj", "fo", "fr", "fy", "ga",
    "gd", "gl", "gn", "gu", "gv", "ha", "he", "hi", "ho", "hr", "ht", "hu", "hy", "hz", "ia", "id",
    "ie", "ig", "ii", "ik", "io", "is", "it", "iu", "ja", "jv", "ka", "kg", "ki", "kj", "kk", "kl",
    "km", "kn", "ko", "kr", "ks", "ku", "kv", "kw", "ky", "la", "lb", "lg", "li", "ln", "lo", "lt",
    "lu", "lv", "mg", "mh", "mi", "mk", "ml", "mn", "mr", "ms", "mt", "my", "na", "nb", "nd", "ne",
    "ng", "nl", "nn", "no", "nr", "nv", "ny", "oc", "oj", "om", "or", "os", "pa", "pi", "pl", "ps",
    "pt", "qu", "rm", "rn", "ro", "ru", "rw", "sa", "sc", "sd", "se", "sg", "si", "sk", "sl", "sm",
    "sn", "so", "sq", "sr", "ss", "st", "su", "sv", "sw", "ta", "te", "tg", "th", "ti", "tk", "tl",
    "tn", "to", "tr", "ts", "tt", "tw", "ty", "ug", "uk", "ur", "uz", "ve", "vi", "vo", "wa", "wo",
    "xh", "yi", "yo", "za", "zh", "zu",
];

/// The scripts documentation folders are named by, after a language code:
/// `zh-hant`, `sr-latn`. A list, not any four letters: `ts-node` is a
/// folder of code.
const SCRIPTS: &[&str] = &["arab", "cyrl", "deva", "hans", "hant", "latn"];

/// Whether a folder name is a language code, with a region (two letters
/// or three digits) or a script after it: `en`, `pt-BR`, `es-419`,
/// `zh_CN`, `zh-hant`. Folder names in other scripts are no codes.
fn is_language(name: &str) -> bool {
    if !name.is_ascii() || name.len() < 2 {
        return false;
    }
    let lower = name.to_ascii_lowercase();
    let (code, rest) = lower.split_at(2);
    let suffix_ok = rest.is_empty()
        || rest.strip_prefix(['-', '_']).is_some_and(|suffix| {
            let letters = suffix.chars().all(|c| c.is_ascii_alphabetic());
            let digits = suffix.chars().all(|c| c.is_ascii_digit());
            (suffix.len() == 2 && letters)
                || (suffix.len() == 3 && digits)
                || SCRIPTS.contains(&suffix)
        });
    suffix_ok && LANGUAGE_CODES.binary_search(&code).is_ok()
}

/// The most subfolders named by a language code under one folder, each
/// holding documentation and neither code nor tests (`src/io`,
/// `bindings/cs` are code); 0 below two: a lone `docs/en` says nothing.
fn doc_languages(result: &AnalysisResult) -> u32 {
    let (dirs, files) = (&result.dirs, &result.files);
    let mut docs = vec![false; dirs.parent.len()];
    let mut code = vec![false; dirs.parent.len()];
    for file in 0..files.dir.len() {
        let dir = files.dir[file] as usize;
        match files.scope[file] {
            Scope::Docs => docs[dir] = true,
            Scope::Source | Scope::Test => code[dir] = true,
            _ => {}
        }
    }
    // Children come after their parent: going backwards marks each subtree
    for dir in (1..docs.len()).rev() {
        if let Some(parent) = dirs.parent[dir] {
            docs[parent as usize] |= docs[dir];
            code[parent as usize] |= code[dir];
        }
    }
    let mut languages = vec![0u32; dirs.parent.len()];
    for (dir, (&parent, name)) in dirs.parent.iter().zip(&dirs.name).enumerate() {
        if let Some(parent) = parent
            && docs[dir]
            && !code[dir]
            && is_language(name)
        {
            languages[parent as usize] += 1;
        }
    }
    languages
        .into_iter()
        .max()
        .filter(|&most| most >= 2)
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::tour::fixture::Fixture;
    use model::Scope;

    #[test]
    fn counts_files_lines_and_the_main_language_of_the_code() {
        let mut repo = Fixture::layered();
        repo.result.languages.push("CSS".to_owned());
        let css = repo.file("ui/theme.css", Scope::Source);
        repo.result.files.language[css] = 1;
        repo.result.files.lines[css] = 55;
        let schema = repo.file("core/schema.ts", Scope::Source);
        repo.result.files.generated[schema] = true;
        repo.result.files.lines[schema] = 900;
        // Tests are not code the project ships
        let test = repo.test("ui/view.test.ts");
        repo.result.files.lines[test] = 400;
        let TourStep::Overview {
            files,
            generated,
            lines,
            language,
            language_lines,
            language_read,
            biggest_island,
            outside_island,
            ..
        } = step(&repo.result)
        else {
            unreachable!()
        };
        assert_eq!((files, generated), (11, 1));
        // Six TypeScript files of 10 lines, a little more than the stylesheet
        assert_eq!((lines, language_lines), (115, 60));
        assert_eq!(language, Some(0));
        assert!(language_read);
        // `ui` has four files, but three of code, as many as `core`: the
        // first island wins
        assert_eq!(biggest_island, Some(repo.island("core")));
        assert_eq!(outside_island, Some(repo.island("test")));
        // More docs than code: the biggest island is still one of code
        for row in 0..5 {
            repo.file(&format!("docs/page{row}.md"), Scope::Docs);
        }
        let TourStep::Overview {
            biggest_island,
            outside_island,
            ..
        } = step(&repo.result)
        else {
            unreachable!()
        };
        assert_eq!(biggest_island, Some(repo.island("core")));
        assert_eq!(outside_island, Some(repo.island("docs")));
    }

    #[test]
    fn an_island_of_code_without_a_layer_is_not_outside_the_code() {
        // `ui` (two files) outside a monorepo's packages: no layer
        let mut repo = Fixture::layered();
        let ui = repo.island("ui");
        repo.result.islands.layer[ui as usize] = None;
        let TourStep::Overview { outside_island, .. } = step(&repo.result) else {
            unreachable!()
        };
        assert_eq!(outside_island, Some(repo.island("test")));
    }

    #[test]
    fn without_code_there_is_no_language_and_the_root_is_never_outside() {
        let mut repo = Fixture::new();
        repo.file("README.md", Scope::Docs);
        repo.file("LICENSE", Scope::Docs);
        let step = step(&repo.result);
        assert_eq!(
            step,
            TourStep::Overview {
                files: 2,
                generated: 0,
                lines: 0,
                language: None,
                language_lines: 0,
                language_read: false,
                biggest_island: Some(0),
                outside_island: None,
                doc_languages: 0,
            }
        );
    }

    #[test]
    fn the_languages_of_the_docs_are_its_folders_named_by_a_language_code() {
        let mut repo = Fixture::layered();
        let languages = |repo: &Fixture| {
            let TourStep::Overview { doc_languages, .. } = step(&repo.result) else {
                unreachable!()
            };
            doc_languages
        };
        repo.file("docs/en/index.md", Scope::Docs);
        assert_eq!(languages(&repo), 0);
        for folder in ["pt-BR", "zh-hant", "de/docs", "es"] {
            repo.file(&format!("docs/{folder}/index.md"), Scope::Docs);
        }
        // `api` is no language, `fr` holds no documentation, and `中文` is
        // no code
        repo.file("docs/api/index.md", Scope::Docs);
        repo.file("docs/fr/build.ts", Scope::Source);
        repo.file("docs/中文/index.md", Scope::Docs);
        assert_eq!(languages(&repo), 5);
        // Code folders with a readme are no documentation
        for folder in ["src/io", "src/os"] {
            repo.file(&format!("{folder}/README.md"), Scope::Docs);
            repo.file(&format!("{folder}/mod.ts"), Scope::Source);
        }
        assert_eq!(languages(&repo), 5);
    }

    #[test]
    fn language_codes_are_sorted_for_their_search() {
        assert!(LANGUAGE_CODES.windows(2).all(|pair| pair[0] < pair[1]));
        assert!(is_language("zh_CN") && is_language("EN") && !is_language("english"));
        assert!(!is_language("js") && !is_language("de-") && !is_language("pt-BRAZIL"));
        assert!(is_language("es-419") && is_language("zh-hant"));
        // Other scripts, and suffixes that are no region nor script
        assert!(!is_language("中文") && !is_language("aé") && !is_language("ts-node"));
        assert!(!is_language("my-app") && !is_language("de-12"));
    }

    #[test]
    fn an_unknown_extension_is_never_the_main_language_and_rust_is_not_read() {
        let mut repo = Fixture::layered();
        repo.result
            .languages
            .extend(["Other".to_owned(), "Rust".to_owned()]);
        let catalog = repo.file("ui/fr.po", Scope::Source);
        repo.result.files.language[catalog] = 1;
        repo.result.files.lines[catalog] = 5_000;
        let TourStep::Overview {
            language,
            language_read,
            ..
        } = step(&repo.result)
        else {
            unreachable!()
        };
        assert_eq!((language, language_read), (Some(0), true));
        let crate_file = repo.file("core/lib.rs", Scope::Source);
        repo.result.files.language[crate_file] = 2;
        repo.result.files.lines[crate_file] = 900;
        let TourStep::Overview {
            language,
            language_read,
            ..
        } = step(&repo.result)
        else {
            unreachable!()
        };
        assert_eq!((language, language_read), (Some(2), false));
    }
}
