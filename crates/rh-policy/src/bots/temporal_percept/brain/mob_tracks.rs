//! P-BOT-BRAIN-CONTINUITY-1: a live Brain seat follows the mobs it can see from one accepted frame to the next.
//!
//! The sim renews a viewer's NPC references whenever the visible set changes (`rh-sim/src/actor_refs.rs`), so a
//! reference is not an identity. Legacy keys a mob by the server's fighter id for the whole run
//! (`packages/server/src/bots/brain/memory.ts:561-605`); a seat that may only use what a player's eyes use gets the same
//! continuity, while the mob stays in view, from where it is, what it is and how far it could have moved.
//!
//! What the tracker reads: each delivered NPC row's position and class (wire kind, mob type code, faction), and whether
//! the row is dying in this sample. Never the per-sample reference's value, never the rows' order (R-ML-4: the sim
//! renews both). Rules:
//! - Step bound: a mob moves at most [`STEP_SPEED`] u/s (PLAYER_SPEED 170 x the fastest role, skirmisher 1.15, x the
//!   G10 move-speed cap 1.3 = 254; `packages/shared/src/mobs.ts:107-111`, `constants.ts:67`, `:251`), plus
//!   [`STEP_SLACK`] for the 1/8-unit wire quantization and displacement; a row farther than that from every track of its
//!   class starts a new track.
//! - Assignment is global nearest first: every (track, row) pair of one class within the bound, by distance, ties by the
//!   older track, then by the row's position (x, then y). Two same-class mobs that pass each other are kept apart as long
//!   as each stays nearer its own track than the other's; at the instant they coincide the keys follow the nearer pair.
//! - No identity across a gap in sight: a track not matched in a sample ends; a sample later than [`MAX_GAP_MS`] after
//!   the previous one (a refused or missing frame) ends every track; a self teleport ([`MobTracks::cut`]) ends every
//!   track. A dying row keeps its track's key in its death sample, then the track ends.
//! - A new track's key is a fresh serial ([`track_key`]), never reused in the seat's life; new tracks of one sample take
//!   serials in class, then position order, so the keys do not depend on the rows' order.
//! - Velocity is the displacement since the track's previous sample over that interval (u/s); 0 on a new track (the
//!   source's "no earlier sample", `frames.ts:280-287`).
use rh_sim::Vec2;

/// The fastest a mob can move, u/s (see the module docs).
pub(crate) const STEP_SPEED: f64 = 255.;
/// Quantization and small displacements on top of the step, u.
pub(crate) const STEP_SLACK: f64 = 8.;
/// A sample further than this after the previous one is a gap in sight: every track ends.
pub(crate) const MAX_GAP_MS: f64 = 250.;

/// What a mob is, as the row shows it: two rows of different classes never share a track.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub(crate) struct MobClass {
    /// Wire actor kind (1 regional, 2 zombie, 3 dummy, 4 quest giver).
    pub(crate) kind: u8,
    pub(crate) type_code: u8,
    pub(crate) faction: u8,
}

/// One delivered NPC row, as far as the tracker may read it.
#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) struct MobRow {
    pub(crate) at: Vec2,
    pub(crate) class: MobClass,
    /// The row dies in this sample: it keeps its key now, and its track ends.
    pub(crate) dying: bool,
}

/// The tracker's answer for one row.
#[derive(Clone, Debug, PartialEq)]
pub(crate) struct Tracked {
    pub(crate) key: String,
    /// u/s; zero on a new track.
    pub(crate) vel: Vec2,
}

#[derive(Clone, Debug)]
struct Track {
    serial: u64,
    at: Vec2,
    class: MobClass,
}

/// The seat's mob tracks.
#[derive(Clone, Debug, Default)]
pub(crate) struct MobTracks {
    tracks: Vec<Track>,
    next: u64,
    time: Option<f64>,
}

/// The percept key of a track (`m<serial>`; players are `p<id>`, untracked NPCs `n<ref>`).
pub(crate) fn track_key(serial: u64) -> String {
    format!("m{serial}")
}

impl MobTracks {
    /// End every track (a self teleport, a new match). Serials keep counting: a key never names two tracks.
    pub(crate) fn cut(&mut self) {
        self.tracks.clear();
        self.time = None;
    }

    /// Live tracks.
    pub(crate) fn len(&self) -> usize {
        self.tracks.len()
    }

    /// Match one sample's rows to the tracks; the answer is in the rows' order.
    pub(crate) fn update(&mut self, time: f64, rows: &[MobRow]) -> Vec<Tracked> {
        let dt = self.time.map_or(f64::INFINITY, |t| time - t);
        if !(dt > 0. && dt <= MAX_GAP_MS) {
            self.tracks.clear();
        }
        self.time = Some(time);
        let bound = STEP_SPEED * dt / 1000. + STEP_SLACK;

        let mut pairs: Vec<(f64, usize, usize)> = Vec::new();
        for (ti, track) in self.tracks.iter().enumerate() {
            for (ri, row) in rows.iter().enumerate() {
                if row.class != track.class {
                    continue;
                }
                let d = dist(track.at, row.at);
                if d <= bound {
                    pairs.push((d, ti, ri));
                }
            }
        }
        let tracks = &self.tracks;
        pairs.sort_by(|a, b| {
            a.0.total_cmp(&b.0)
                .then(tracks[a.1].serial.cmp(&tracks[b.1].serial))
                .then(rows[a.2].at.x.total_cmp(&rows[b.2].at.x))
                .then(rows[a.2].at.y.total_cmp(&rows[b.2].at.y))
        });
        let mut row_track: Vec<Option<usize>> = vec![None; rows.len()];
        let mut taken = vec![false; self.tracks.len()];
        for (_, ti, ri) in pairs {
            if taken[ti] || row_track[ri].is_some() {
                continue;
            }
            taken[ti] = true;
            row_track[ri] = Some(ti);
        }

        // New tracks take serials in class, then position order (never row order).
        let mut fresh: Vec<usize> = (0..rows.len())
            .filter(|&ri| row_track[ri].is_none())
            .collect();
        fresh.sort_by(|&a, &b| {
            rows[a]
                .class
                .cmp(&rows[b].class)
                .then(rows[a].at.x.total_cmp(&rows[b].at.x))
                .then(rows[a].at.y.total_cmp(&rows[b].at.y))
        });
        let mut serial_of: Vec<u64> = vec![0; rows.len()];
        for ri in fresh {
            serial_of[ri] = self.next;
            self.next += 1;
        }

        let mut out = Vec::with_capacity(rows.len());
        let mut next_tracks = Vec::with_capacity(rows.len());
        for (ri, row) in rows.iter().enumerate() {
            let (serial, vel) = match row_track[ri] {
                Some(ti) => {
                    let prev = self.tracks[ti].at;
                    let k = 1000. / dt;
                    (
                        self.tracks[ti].serial,
                        Vec2::new((row.at.x - prev.x) * k, (row.at.y - prev.y) * k),
                    )
                }
                None => (serial_of[ri], Vec2::new(0., 0.)),
            };
            if !row.dying {
                next_tracks.push(Track {
                    serial,
                    at: row.at,
                    class: row.class,
                });
            }
            out.push(Tracked {
                key: track_key(serial),
                vel,
            });
        }
        next_tracks.sort_by_key(|t| t.serial);
        self.tracks = next_tracks;
        out
    }
}

fn dist(a: Vec2, b: Vec2) -> f64 {
    rh_sim::mapgen::certify::source_hypot(a.x - b.x, a.y - b.y)
}

#[cfg(test)]
mod tests;
