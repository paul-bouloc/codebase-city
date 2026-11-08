//! The first step: the size of the city and what it is made of.

use model::{AnalysisResult, TourStep};

use super::{count, first_max, is_production, island_of_file};

pub(super) fn step(result: &AnalysisResult) -> TourStep {
    let files = &result.files;
    let mut shown = 0u64;
    let mut lines = 0u64;
    let mut by_language = vec![0u64; result.languages.len()];
    let mut by_island = vec![0u64; result.islands.dir.len()];
    let mut code_by_island = vec![0u64; result.islands.dir.len()];
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
            }
        }
    }
    let language = first_max(by_language.iter().copied());
    // Outside the code, not its entrance: the root island is left out
    let outside = by_island.iter().enumerate().map(|(island, &files)| {
        let root = result.islands.dir[island] == 0;
        if root || result.islands.layer[island].is_some() {
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
                biggest_island: Some(0),
                outside_island: None,
            }
        );
    }
}
