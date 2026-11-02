//! The layout of the city: plateaux, parcels and lots, on repositories
//! held in memory. `validate` checks that nothing overlaps and that every
//! file has a lot of its own on its folder's grid; these tests check the
//! rest.

#![allow(clippy::unwrap_used)]

use analyzer::analyze;
use analyzer::files::{Language, SourceFile, count_lines};
use model::{AnalysisResult, Ignored, ParcelNature, Repo};

fn source(path: String) -> SourceFile {
    let content = if path.ends_with(".ts") {
        "export const value = 1\n"
    } else {
        "x\n"
    };
    SourceFile {
        language: Language::of(&path),
        lines: count_lines(content.as_bytes()),
        generated: false,
        content: Some(content.as_bytes().to_vec()),
        path,
    }
}

fn analyzed(paths: impl IntoIterator<Item = String>) -> AnalysisResult {
    let files = paths.into_iter().map(source).collect();
    let repo = Repo {
        owner: "acme".to_owned(),
        name: "harbor".to_owned(),
    };
    let result = analyze(repo, "0".repeat(40), files, Ignored::default());
    assert_eq!(result.validate(), Ok(()));
    result
}

/// Islands of very different sizes, nested folders, tests, configs and a
/// folder of a language the analyzer does not read.
fn harbor() -> Vec<String> {
    let mut paths = vec![
        "package.json".to_owned(),
        "tsconfig.json".to_owned(),
        "README.md".to_owned(),
    ];
    for (module, files) in [("core", 60), ("ui", 45), ("api", 30), ("cli", 3)] {
        for file in 0..files {
            let folder = ["", "model/", "view/", "view/widgets/"][file % 4];
            paths.push(format!("src/{module}/{folder}f{file}.ts"));
        }
    }
    paths.extend((0..30).map(|file| format!("test/t{file}.test.ts")));
    paths.extend((0..8).map(|file| format!("docs/d{file}.md")));
    paths.push("tools/one.ts".to_owned());
    paths
}

fn dir_path(result: &AnalysisResult, dir: u32) -> String {
    let mut parts = Vec::new();
    let mut current = Some(dir);
    while let Some(row) = current {
        if row != 0 {
            parts.push(result.dirs.name[row as usize].as_str());
        }
        current = result.dirs.parent[row as usize];
    }
    parts.reverse();
    parts.join("/")
}

/// The plateau of each island: x, y, width, height.
fn plateaux(result: &AnalysisResult) -> Vec<(i64, i64, i64, i64)> {
    let islands = &result.layout.islands;
    (0..islands.x.len())
        .map(|row| {
            (
                i64::from(islands.x[row]),
                i64::from(islands.y[row]),
                i64::from(islands.width[row]),
                i64::from(islands.height[row]),
            )
        })
        .collect()
}

/// Space between two rectangles along x, and along y; negative where
/// their spans overlap.
fn spacing(a: (i64, i64, i64, i64), b: (i64, i64, i64, i64)) -> (i64, i64) {
    let along = |start: i64, length: i64, other: i64, other_length: i64| {
        (other - (start + length)).max(start - (other + other_length))
    };
    (along(a.0, a.2, b.0, b.2), along(a.1, a.3, b.1, b.3))
}

#[test]
fn islands_keep_a_channel_between_them() {
    let result = analyzed(harbor());
    let plateaux = plateaux(&result);
    assert!(plateaux.len() >= 5, "{plateaux:?}");
    for (index, &a) in plateaux.iter().enumerate() {
        for &b in &plateaux[index + 1..] {
            let (x, y) = spacing(a, b);
            // Facing along x when their spans overlap along y, and the other
            // way round; 9 u at least, more for long facing sides
            let rule = |facing: i64| (facing * 22 / 100).clamp(90, 240);
            if y < 0 {
                assert!(x >= rule(a.3.min(b.3)), "{a:?} and {b:?}: {x}");
            } else if x < 0 {
                assert!(y >= rule(a.2.min(b.2)), "{a:?} and {b:?}: {y}");
            } else {
                assert!(x.max(y) >= 90, "{a:?} and {b:?}");
            }
        }
    }
}

#[test]
fn a_small_island_still_has_room() {
    let result = analyzed(harbor());
    let plateaux = plateaux(&result);
    let largest = plateaux.iter().map(|p| p.2 * p.3).max().unwrap();
    for plateau in &plateaux {
        let (long, short) = (plateau.2.max(plateau.3), plateau.2.min(plateau.3));
        assert!(long >= 100 && short >= 66, "{plateau:?}");
        assert!(plateau.2 * plateau.3 * 100 >= largest, "{plateau:?}");
    }
}

#[test]
fn neighbouring_parcels_keep_their_street() {
    let result = analyzed(harbor());
    let parcels = &result.layout.parcels;
    let rect = |row: usize| {
        (
            i64::from(parcels.x[row]),
            i64::from(parcels.y[row]),
            i64::from(parcels.width[row]),
            i64::from(parcels.height[row]),
        )
    };
    let depth = |dir: u32| dir_path(&result, dir).matches('/').count();
    let mut checked = 0;
    for a in 0..parcels.dir.len() {
        for b in a + 1..parcels.dir.len() {
            let parent = |row: usize| result.dirs.parent[parcels.dir[row] as usize];
            if parent(a) != parent(b) {
                continue;
            }
            let (x, y) = spacing(rect(a), rect(b));
            // `src/core/model` is two levels below the `core` island
            let expected = if depth(parcels.dir[a]) <= 2 { 18 } else { 9 };
            assert!(x.max(y) >= expected, "{} and {}", a, b);
            checked += 1;
        }
    }
    assert!(checked > 0);
}

#[test]
fn parcels_take_the_nature_of_most_of_their_files() {
    let mut paths = harbor();
    paths.extend((0..5).map(|file| format!("src/core/view/v{file}.test.ts")));
    let result = analyzed(paths);
    let parcels = &result.layout.parcels;
    let nature = |path: &str| {
        let row = parcels
            .dir
            .iter()
            .position(|&dir| dir_path(&result, dir) == path)
            .unwrap_or_else(|| panic!("no parcel for {path}"));
        parcels.nature[row]
    };
    assert_eq!(nature("src/core/model"), ParcelNature::Normal);
    // 30 sources and 5 tests below it
    assert_eq!(nature("src/core/view"), ParcelNature::Normal);
    // `test` and `docs` are islands of their own: they have no parcel
    assert!(
        parcels
            .dir
            .iter()
            .all(|&dir| !["test", "docs"].contains(&dir_path(&result, dir).as_str()))
    );

    let mut paths: Vec<String> = (0..6)
        .map(|file| format!("lib/a/t{file}.test.ts"))
        .collect();
    paths.extend((0..5).map(|file| format!("lib/a/s{file}.ts")));
    paths.extend((0..3).map(|file| format!("lib/b/d{file}.md")));
    paths.extend((0..3).map(|file| format!("lib/b/s{file}.ts")));
    paths.extend((0..4).map(|file| format!("lib/c/d{file}.md")));
    paths.extend((0..3).map(|file| format!("lib/c/s{file}.ts")));
    // More code elsewhere, so that `lib` stays one island
    paths.extend((0..30).map(|file| format!("app/s{file}.ts")));
    let result = analyzed(paths);
    let natures: Vec<(String, ParcelNature)> = (0..result.layout.parcels.dir.len())
        .map(|row| {
            (
                dir_path(&result, result.layout.parcels.dir[row]),
                result.layout.parcels.nature[row],
            )
        })
        .collect();
    assert_eq!(
        natures,
        [
            ("lib/a".to_owned(), ParcelNature::Tests),
            // Half is not more than half
            ("lib/b".to_owned(), ParcelNature::Normal),
            ("lib/c".to_owned(), ParcelNature::Unanalyzed),
        ]
    );
}

#[test]
fn config_files_stand_on_the_north_row() {
    let result = analyzed(harbor());
    let grids = &result.layout.grids;
    let root = grids.dir.iter().position(|&dir| dir == 0).unwrap();
    let north = grids.y[root] + (grids.rows[root] - 1) * 20 + 10;
    let west = grids.x[root] + 10;
    let lot = |name: &str| {
        let file = result.files.name.iter().position(|n| n == name).unwrap();
        (result.layout.lots.x[file], result.layout.lots.y[file])
    };
    assert_eq!(lot("package.json"), (west, north));
    assert_eq!(lot("tsconfig.json"), (west + 20, north));
}

#[test]
fn a_grid_leaves_some_lots_empty_for_trees() {
    let result = analyzed(harbor());
    let grids = &result.layout.grids;
    let lots: u32 = (0..grids.dir.len())
        .map(|row| grids.columns[row] * grids.rows[row])
        .sum();
    let files = u32::try_from(result.files.dir.len()).unwrap();
    assert!(lots > files);
    // Most of the place is still taken
    assert!(files * 100 / lots >= 50, "{files} files on {lots} lots");
}

#[test]
fn the_order_of_the_files_does_not_change_the_layout() {
    let paths = harbor();
    let mut shuffled = paths.clone();
    shuffled.reverse();
    shuffled.swap(3, 40);
    assert_eq!(analyzed(paths).layout, analyzed(shuffled).layout);
}

#[test]
fn a_result_lays_out_again_the_same() {
    let result = analyzed(harbor());
    assert_eq!(analyzer::layout::of_result(&result), result.layout);
}

#[test]
fn a_single_file_makes_a_small_island() {
    let result = analyzed(["main.ts".to_owned()]);
    assert_eq!(result.layout.islands.width, [100]);
    assert_eq!(result.layout.islands.height, [66]);
    assert_eq!((result.layout.width, result.layout.height), (100, 66));
}

#[test]
fn deep_folders_nest_without_trouble() {
    let deep: String = (0..300).map(|level| format!("d{level}/")).collect();
    let result = analyzed([format!("{deep}leaf.ts"), "main.ts".to_owned()]);
    assert_eq!(result.layout.parcels.dir.len(), 299);
}

#[test]
fn folders_thousands_deep_neither_overflow_nor_grow_the_city() {
    let deep: String = (0..3_000).map(|level| format!("d{level}/")).collect();
    let result = analyzed([format!("{deep}leaf.ts"), "main.ts".to_owned()]);
    assert_eq!(result.layout.parcels.dir.len(), 2_999);
    // Past a few levels, parcels nest without padding: the city stays small
    assert!(result.layout.width < 1_000 && result.layout.height < 1_000);
}

#[test]
fn a_folder_of_one_subfolder_takes_any_shape() {
    // `src/a` holds no file of its own, only `b`: a frame around a frame
    let paths = (0..40)
        .map(|file| format!("src/a/b/f{file}.ts"))
        .chain((0..40).map(|file| format!("src/c/g{file}.ts")));
    let result = analyzed(paths);
    let parcels = &result.layout.parcels;
    for row in 0..parcels.dir.len() {
        let (width, height) = (parcels.width[row], parcels.height[row]);
        let ratio = f64::from(width.max(height)) / f64::from(width.min(height));
        let path = dir_path(&result, parcels.dir[row]);
        assert!(ratio < 4.0, "{path} is {width} × {height}");
    }
}
