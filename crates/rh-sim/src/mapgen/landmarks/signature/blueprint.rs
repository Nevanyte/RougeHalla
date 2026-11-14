//! P-MAPGEN-SIG-BLUEPRINT-1: one reader and one placement rule for every landmark drawing (architecture review
//! 2026-11-13, finding 2). A drawing is a rectangular grid of characters, front (toward the coliseum) at the bottom;
//! its `Legend` says, per character, what the generator writes on the tile, which feature owns it, which `Site`
//! predicate the tile must pass, and whether the character is a named mark. A `Landing` places the drawing on the map
//! under one of eight orientations (front direction times mirror) by one of two rules (`Placement`).
//!
//! Conventions (the cave's `land` before this packet, so no generated map moves): grid tile `g = (gx, gy)`; `gy` grows
//! toward the front. An orientation with front direction `u` (a unit axis vector) sends the grid direction `(0, 1)` to
//! `u` and `(1, 0)` to `r = (u.1, -u.0)` unmirrored, `-r` mirrored; `Orientation::turn` is that linear map, applied to
//! tiles and to directions alike (so a heading drawn on the grid turns and mirrors with the tiles).
//!
//! Pure reading and geometry: no draw, no map. The reader judges the text's shape and characters, never the drawing's
//! content (where its marks lie, whether a mouth is one run): the approved drawings are pinned byte for byte and by
//! their orientation oracles. What a landing writes, and whether the site can hold it, is the stamp's
//! (`super::stamp`), which reads the per-landmark table (`super::spec`).
use crate::mapdata::{FeatureKind, TileRect};

/// A grid tile `(gx, gy)` or a map tile `(x, y)`, or a direction in either.
pub type Cell = (i32, i32);

/// What a character writes on its map tile.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Write {
    /// Nothing: the tile stays the floor it is (plain floor and the marks: `.`, `E`, `D`, `:`, `*`).
    Nothing,
    /// A wall tile, terrain 0.
    Wall,
    /// A LOW tile carrying this terrain code.
    Low(u8),
    /// A floor tile carrying this terrain code.
    Floor(u8),
}

/// The `Site` predicate a character's map tile must pass for the drawing to land.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Legality {
    /// `Site::wall`: free floor of the zone, inside the site's inner rect where the `Site` has one (a drawing's always
    /// does; the volcano's has none), off every camp halo.
    Wall,
    /// `Site::wall` and `Site::ground` (also off the legacy landmark protection and every apron marked before): the
    /// bog tree's walls and marsh.
    WallGround,
    /// `Site::floor`: free floor of the zone, inside the site's inner rect where the `Site` has one.
    Floor,
}

/// One legend entry: the character, what it writes, the feature that owns the written tile (`None` for a character
/// that writes nothing), its legality class, and whether it is a named mark (the mark's name is the character).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Glyph {
    pub ch: u8,
    pub write: Write,
    pub feature: Option<FeatureKind>,
    pub legality: Legality,
    pub mark: bool,
}

/// A drawing's legend: one `Glyph` per character the drawing may hold.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Legend(pub Vec<Glyph>);

impl Legend {
    /// The entry for `ch`, if the legend has one.
    pub fn glyph(&self, ch: u8) -> Option<&Glyph> {
        self.0.iter().find(|g| g.ch == ch)
    }
}

/// Why a drawing's text did not parse.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ParseError {
    /// No grid line: every line is empty or a legend line (starting with `;`).
    Empty,
    /// Grid line `row` (0-based among grid lines) has `len` characters where the first has `expected`.
    Ragged {
        row: usize,
        len: usize,
        expected: usize,
    },
    /// The character at grid tile `at` has no legend entry.
    Unknown { ch: u8, at: Cell },
}

/// A parsed drawing: the grid lines of the text (lines neither empty nor starting with `;`), row-major, with its
/// legend.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Blueprint {
    /// Columns (`gx` range) and rows (`gy` range).
    w: i32,
    h: i32,
    /// Row-major characters, `w * h`.
    cells: Vec<u8>,
    legend: Legend,
}

/// An orientation: the map direction the drawing's front row faces (a unit axis vector) and the mirror flag.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub struct Orientation {
    pub front: Cell,
    pub mirrored: bool,
}

impl Orientation {
    /// The eight orientations: fronts `(1, 0)`, `(-1, 0)`, `(0, 1)`, `(0, -1)` in that order, each unmirrored then
    /// mirrored.
    pub fn all() -> [Orientation; 8] {
        let mut out = [Orientation {
            front: (0, 0),
            mirrored: false,
        }; 8];
        for (k, u) in [(1, 0), (-1, 0), (0, 1), (0, -1)].into_iter().enumerate() {
            out[2 * k] = Orientation {
                front: u,
                mirrored: false,
            };
            out[2 * k + 1] = Orientation {
                front: u,
                mirrored: true,
            };
        }
        out
    }

    /// The map direction of grid direction `d`: its front component (`d.1`) along `front`, its side component (`d.0`)
    /// along `r = (front.1, -front.0)`, negated when mirrored.
    pub fn turn(&self, d: Cell) -> Cell {
        let u = self.front;
        let s = if self.mirrored { -1 } else { 1 };
        let r = (s * u.1, -s * u.0);
        (d.1 * u.0 + d.0 * r.0, d.1 * u.1 + d.0 * r.1)
    }
}

/// How a drawing is placed in its zone's reserved site.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Placement {
    /// The named mark (exactly one tile) lands on the site's camp tile (the cave's and the church's `E`).
    Pin(u8),
    /// The drawing's box, turned, is centred in the site's inner rect; an odd spare tile on an axis goes before the box
    /// (lower x or y). The bog tree (29 in 30), the volcano (30 in 30) and the hall (37 in 37).
    Centre,
}

/// Which of the drawing's tiles are the anchor's `entrance`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum EntranceRule {
    /// The tiles of this mark (the cave's mouth `D`).
    Mark(u8),
    /// The run of open tiles (a glyph writing `Nothing` or `Floor`) of the front row through the column of this
    /// mark's tiles (the church's main gate through `E`'s column; the hall's nave through its two `E`s' column); empty
    /// when the mark's tiles do not share one column or the front row's tile in it is not open.
    FrontRun(u8),
    /// The tiles of this character on the drawing's outer rows and columns (the bog tree's causeways `:`).
    Edge(u8),
    /// No entrance.
    None,
}

/// What a landing needs from the site: its inner rect (the reserved site less its apron) and its camp tile, if any.
/// The site's centre tile is the inner rect's: `(inner.x + inner.w / 2, inner.y + inner.h / 2)`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Target {
    pub inner: TileRect,
    pub camp: Option<Cell>,
}

/// A drawing placed on the map: its orientation, the map tile grid `(0, 0)` lands on, and the box (the map rect every
/// grid tile lands in, one to one).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Landing {
    pub orientation: Orientation,
    pub origin: Cell,
    pub footprint: TileRect,
}

impl Landing {
    /// The map tile grid tile `g` lands on: `origin + orientation.turn(g)`.
    pub fn tile(&self, g: Cell) -> Cell {
        let d = self.orientation.turn(g);
        (self.origin.0 + d.0, self.origin.1 + d.1)
    }
}

/// A glyph that leaves its tile walkable: it writes nothing or floor.
fn open(g: &Glyph) -> bool {
    matches!(g.write, Write::Nothing | Write::Floor(_))
}

impl Blueprint {
    /// The drawing in `text` read with `legend`: the grid lines (neither empty nor starting with `;`), every one as
    /// long as the first, every character in the legend. The first fault found, in reading order, is the error.
    pub fn parse(text: &str, legend: &Legend) -> Result<Self, ParseError> {
        let rows: Vec<&[u8]> = text
            .lines()
            .filter(|l| !l.is_empty() && !l.starts_with(';'))
            .map(str::as_bytes)
            .collect();
        let expected = rows.first().ok_or(ParseError::Empty)?.len();
        for (row, line) in rows.iter().enumerate() {
            if line.len() != expected {
                return Err(ParseError::Ragged {
                    row,
                    len: line.len(),
                    expected,
                });
            }
            if let Some(gx) = line.iter().position(|&ch| legend.glyph(ch).is_none()) {
                return Err(ParseError::Unknown {
                    ch: line[gx],
                    at: (gx as i32, row as i32),
                });
            }
        }
        Ok(Self {
            w: expected as i32,
            h: rows.len() as i32,
            cells: rows.concat(),
            legend: legend.clone(),
        })
    }

    /// `(w, h)`: the columns and rows of the grid.
    pub fn size(&self) -> Cell {
        (self.w, self.h)
    }

    /// The character at grid tile `g`, `None` off the grid.
    pub fn char_at(&self, g: Cell) -> Option<u8> {
        let on = (0..self.w).contains(&g.0) && (0..self.h).contains(&g.1);
        on.then(|| self.cells[(g.1 * self.w + g.0) as usize])
    }

    pub fn legend(&self) -> &Legend {
        &self.legend
    }

    /// Every grid tile with its glyph, row-major. `parse` gave every character a glyph, so every tile is here.
    pub fn glyphs(&self) -> impl Iterator<Item = (Cell, &Glyph)> + '_ {
        self.cells.iter().enumerate().filter_map(|(k, &ch)| {
            let g = (k as i32 % self.w, k as i32 / self.w);
            self.legend.glyph(ch).map(|glyph| (g, glyph))
        })
    }

    /// The grid tiles of character `ch`, row-major (`gy`, then `gx`).
    pub fn tiles_of(&self, ch: u8) -> Vec<Cell> {
        self.cells
            .iter()
            .enumerate()
            .filter(|&(_, &c)| c == ch)
            .map(|(k, _)| (k as i32 % self.w, k as i32 / self.w))
            .collect()
    }

    /// Every mark of the legend (glyphs with `mark`), ascending by character, with its grid tiles row-major.
    pub fn marks(&self) -> Vec<(u8, Vec<Cell>)> {
        let mut chars: Vec<u8> = self
            .legend
            .0
            .iter()
            .filter(|g| g.mark)
            .map(|g| g.ch)
            .collect();
        chars.sort_unstable();
        chars.dedup();
        chars
            .into_iter()
            .map(|ch| (ch, self.tiles_of(ch)))
            .collect()
    }

    /// The entrance's grid tiles under `rule`, row-major.
    pub fn entrance(&self, rule: EntranceRule) -> Vec<Cell> {
        match rule {
            EntranceRule::Mark(ch) => self.tiles_of(ch),
            EntranceRule::Edge(ch) => self
                .tiles_of(ch)
                .into_iter()
                .filter(|&(gx, gy)| gx == 0 || gy == 0 || gx == self.w - 1 || gy == self.h - 1)
                .collect(),
            EntranceRule::FrontRun(ch) => self.front_run(ch),
            EntranceRule::None => Vec::new(),
        }
    }

    /// `EntranceRule::FrontRun(ch)`: the run of open tiles of the front row through the one column of `ch`'s tiles.
    fn front_run(&self, ch: u8) -> Vec<Cell> {
        let marks = self.tiles_of(ch);
        let Some(&(col, _)) = marks.first() else {
            return Vec::new();
        };
        let y = self.h - 1;
        let open_at = |gx: i32| {
            self.char_at((gx, y))
                .and_then(|c| self.legend.glyph(c))
                .is_some_and(open)
        };
        if marks.iter().any(|&(gx, _)| gx != col) || !open_at(col) {
            return Vec::new();
        }
        let (mut lo, mut hi) = (col, col);
        while open_at(lo - 1) {
            lo -= 1;
        }
        while open_at(hi + 1) {
            hi += 1;
        }
        (lo..=hi).map(|gx| (gx, y)).collect()
    }

    /// Where the drawing lands under orientation `o` by rule `rule` in `target`; `None` when the rule cannot place it:
    /// `Pin` with no camp tile or a mark that is not exactly one tile, `Centre` with the turned box wider or taller than
    /// the inner rect. Pure geometry: the tiles' legality is the stamp's.
    pub fn land(&self, rule: Placement, o: Orientation, target: &Target) -> Option<Landing> {
        // The box of the drawing turned about grid (0, 0): its corner nearest the map origin, and its size.
        let far = (self.w - 1, self.h - 1);
        let corners = [(0, 0), (far.0, 0), (0, far.1), far].map(|g| o.turn(g));
        let lo = corners
            .iter()
            .fold(corners[0], |m, c| (m.0.min(c.0), m.1.min(c.1)));
        let hi = corners
            .iter()
            .fold(corners[0], |m, c| (m.0.max(c.0), m.1.max(c.1)));
        let size = (hi.0 - lo.0 + 1, hi.1 - lo.1 + 1);
        let origin = match rule {
            Placement::Pin(ch) => {
                let t = target.camp?;
                let [g] = self.tiles_of(ch)[..] else {
                    return None;
                };
                let d = o.turn(g);
                (t.0 - d.0, t.1 - d.1)
            }
            Placement::Centre => {
                let inner = target.inner;
                let spare = (inner.w as i32 - size.0, inner.h as i32 - size.1);
                if spare.0 < 0 || spare.1 < 0 {
                    return None;
                }
                // An odd spare tile goes before the box.
                let corner = (inner.x + (spare.0 + 1) / 2, inner.y + (spare.1 + 1) / 2);
                (corner.0 - lo.0, corner.1 - lo.1)
            }
        };
        Some(Landing {
            orientation: o,
            origin,
            footprint: TileRect {
                x: origin.0 + lo.0,
                y: origin.1 + lo.1,
                w: size.0 as u32,
                h: size.1 as u32,
            },
        })
    }
}
