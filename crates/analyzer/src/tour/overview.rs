//! The first step: the size of the city and what it is made of.

use model::{AnalysisResult, TourStep};

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
    }
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
            }
        );
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
