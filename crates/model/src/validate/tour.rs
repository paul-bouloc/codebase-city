//! Checks on the tour of a result: the order of its steps and what they
//! point at.

use super::{InvalidResult, in_bounds};
use crate::result::{AnalysisResult, TourStep};

/// The most rows a list of a step holds.
const MAX_ROWS: usize = 3;

/// The place of a kind of step in the tour.
fn rank(step: &TourStep) -> u8 {
    match step {
        TourStep::Overview { .. } => 0,
        TourStep::EntryPoints { .. } => 1,
        TourStep::Conductors { .. } => 2,
        TourStep::Foundations { .. } => 3,
        TourStep::Layers { .. } => 4,
        TourStep::Cycles { .. } => 5,
        TourStep::ComplexAreas { .. } => 6,
        TourStep::Rest { .. } => 7,
    }
}

pub(super) fn tour(result: &AnalysisResult) -> Result<(), InvalidResult> {
    let steps = &result.tour.steps;
    if !matches!(steps.first(), Some(TourStep::Overview { .. })) {
        return Err(InvalidResult::TourStart);
    }
    if let Some(row) = steps
        .windows(2)
        .position(|pair| rank(&pair[0]) >= rank(&pair[1]))
    {
        return Err(InvalidResult::TourOrder { row: row + 1 });
    }
    let file_count = result.files.dir.len();
    let dir_count = result.dirs.parent.len();
    let island_count = result.islands.dir.len();
    for (row, step) in steps.iter().enumerate() {
        let list = |column, rows: &[u32], len| {
            listed(row, rows, 1)?;
            in_bounds(column, rows, len)
        };
        let optional = |column, index: Option<u32>, len| in_bounds(column, index.as_slice(), len);
        match step {
            TourStep::Overview {
                lines,
                language,
                language_lines,
                biggest_island,
                outside_island,
                ..
            } => {
                optional("tour.language", *language, result.languages.len())?;
                optional("tour.biggestIsland", *biggest_island, island_count)?;
                optional("tour.outsideIsland", *outside_island, island_count)?;
                if language_lines > lines || language.is_none() && *language_lines > 0 {
                    return Err(InvalidResult::TourCount { row });
                }
            }
            TourStep::EntryPoints { entries } => {
                list("tour.entries", entries, result.roles.entries.file.len())?;
            }
            TourStep::Conductors { conductors } => {
                list(
                    "tour.conductors",
                    conductors,
                    result.roles.conductors.file.len(),
                )?;
            }
            TourStep::Foundations {
                foundations,
                island,
            } => {
                list(
                    "tour.foundations",
                    foundations,
                    result.roles.foundations.file.len(),
                )?;
                optional("tour.island", *island, island_count)?;
            }
            TourStep::Layers { worst_link, .. } => {
                optional("tour.worstLink", *worst_link, result.links.from.len())?;
            }
            TourStep::Cycles { cycle, dir } => {
                optional("tour.cycle", Some(*cycle), result.cycles.members.len())?;
                optional("tour.dir", Some(*dir), dir_count)?;
            }
            TourStep::ComplexAreas { files, .. } => {
                list("tour.files", files, file_count)?;
            }
            TourStep::Rest {
                park_count, parks, ..
            } => {
                listed(row, parks, 0)?;
                in_bounds("tour.parks", parks, dir_count)?;
                if parks.len() > *park_count as usize {
                    return Err(InvalidResult::TourCount { row });
                }
            }
        }
    }
    Ok(())
}

/// A list of `min` to [`MAX_ROWS`] rows, each once.
fn listed(row: usize, rows: &[u32], min: usize) -> Result<(), InvalidResult> {
    // The length first: checking each row against the others is quadratic
    let distinct = || {
        rows.iter()
            .enumerate()
            .all(|(at, index)| !rows[..at].contains(index))
    };
    if (min..=MAX_ROWS).contains(&rows.len()) && distinct() {
        Ok(())
    } else {
        Err(InvalidResult::TourList { row })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::validate::tests::{invalid, result};

    fn step(r: &mut AnalysisResult, kind: u8) -> &mut TourStep {
        r.tour
            .steps
            .iter_mut()
            .find(|step| rank(step) == kind)
            .unwrap()
    }

    #[test]
    fn the_tour_starts_with_the_overview() {
        assert_eq!(
            invalid(|r| {
                r.tour.steps.remove(0);
            }),
            InvalidResult::TourStart
        );
        assert_eq!(invalid(|r| r.tour.steps.clear()), InvalidResult::TourStart);
    }

    #[test]
    fn steps_come_once_each_in_order() {
        assert_eq!(
            invalid(|r| r.tour.steps.swap(1, 2)),
            InvalidResult::TourOrder { row: 2 }
        );
        assert_eq!(
            invalid(|r| {
                let again = r.tour.steps[1].clone();
                r.tour.steps.insert(1, again);
            }),
            InvalidResult::TourOrder { row: 2 }
        );
    }

    #[test]
    fn lists_hold_one_to_three_rows_each_once() {
        assert_eq!(
            invalid(|r| {
                if let TourStep::EntryPoints { entries } = step(r, 1) {
                    entries.clear();
                }
            }),
            InvalidResult::TourList { row: 1 }
        );
        assert_eq!(
            invalid(|r| {
                if let TourStep::ComplexAreas { files, .. } = step(r, 6) {
                    *files = vec![0, 1, 0];
                }
            }),
            InvalidResult::TourList { row: 6 }
        );
        assert_eq!(
            invalid(|r| {
                if let TourStep::Rest { parks, .. } = step(r, 7) {
                    *parks = vec![0, 1, 0, 1];
                }
            }),
            InvalidResult::TourList { row: 7 }
        );
    }

    #[test]
    fn steps_point_inside_their_tables() {
        assert_eq!(
            invalid(|r| {
                if let TourStep::Conductors { conductors } = step(r, 2) {
                    conductors[0] = 1;
                }
            }),
            InvalidResult::IndexOutOfBounds {
                column: "tour.conductors",
                row: 0,
                index: 1,
                len: 1,
            }
        );
        assert_eq!(
            invalid(|r| {
                if let TourStep::Overview { outside_island, .. } = step(r, 0) {
                    *outside_island = Some(2);
                }
            }),
            InvalidResult::IndexOutOfBounds {
                column: "tour.outsideIsland",
                row: 0,
                index: 2,
                len: 2,
            }
        );
        assert_eq!(
            invalid(|r| {
                if let TourStep::Layers { worst_link, .. } = step(r, 4) {
                    *worst_link = Some(1);
                }
            }),
            InvalidResult::IndexOutOfBounds {
                column: "tour.worstLink",
                row: 0,
                index: 1,
                len: 1,
            }
        );
        assert_eq!(
            invalid(|r| {
                if let TourStep::Cycles { dir, .. } = step(r, 5) {
                    *dir = 2;
                }
            }),
            InvalidResult::IndexOutOfBounds {
                column: "tour.dir",
                row: 0,
                index: 2,
                len: 2,
            }
        );
    }

    #[test]
    fn counts_hold_together() {
        assert_eq!(
            invalid(|r| {
                if let TourStep::Overview { language_lines, .. } = step(r, 0) {
                    *language_lines = 53;
                }
            }),
            InvalidResult::TourCount { row: 0 }
        );
        assert_eq!(
            invalid(|r| {
                if let TourStep::Rest { park_count, .. } = step(r, 7) {
                    *park_count = 0;
                }
            }),
            InvalidResult::TourCount { row: 7 }
        );
    }

    #[test]
    fn a_tour_of_the_overview_alone_is_valid() {
        let mut r = result();
        r.tour.steps.truncate(1);
        assert_eq!(r.validate(), Ok(()));
    }
}
