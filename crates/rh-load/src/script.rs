//! The scripted player's "brain": which input commands to send, given what the last snapshot showed. It only decides
//! click targets, aim angles and whether to hold the trigger; the server's simulation validates and applies everything (and
//! owns every rule). No learning, no model.

use rh_protocol::WireCommand;

/// xorshift64*: small, seedable, good enough for jittering a load script.
#[derive(Clone, Debug)]
pub struct Rng(u64);

impl Rng {
    pub fn new(seed: u64) -> Self {
        // splitmix64 scramble so that nearby seeds (player 1, 2, 3, ...) give unrelated streams.
        let mut z = seed.wrapping_add(0x9E37_79B9_7F4A_7C15);
        z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
        Self((z ^ (z >> 31)) | 1)
    }
    pub fn next_u64(&mut self) -> u64 {
        let mut x = self.0;
        x ^= x >> 12;
        x ^= x << 25;
        x ^= x >> 27;
        self.0 = x;
        x.wrapping_mul(0x2545_F491_4F6C_DD1D)
    }
    /// Uniform in [0, 1).
    pub fn f64(&mut self) -> f64 {
        (self.next_u64() >> 11) as f64 / (1u64 << 53) as f64
    }
    pub fn range_f64(&mut self, lo: f64, hi: f64) -> f64 {
        lo + (hi - lo) * self.f64()
    }
    pub fn range_u64(&mut self, lo: u64, hi: u64) -> u64 {
        if hi <= lo {
            lo
        } else {
            lo + self.next_u64() % (hi - lo + 1)
        }
    }
    pub fn chance(&mut self, p: f64) -> bool {
        self.f64() < p
    }
}

/// The walkable tiles of the Welcome map (shared by every client of one map).
#[derive(Debug)]
pub struct Floors {
    pub w: usize,
    pub tiles: Vec<u32>,
}

impl Floors {
    /// Tile class 0 is floor (docs: `MapBlob.tiles`: 0 floor, 1 wall, 2 low).
    pub fn from_map(w: u16, tiles: &[u8]) -> Self {
        Self {
            w: w as usize,
            tiles: tiles
                .iter()
                .enumerate()
                .filter(|(_, &t)| t == 0)
                .map(|(i, _)| i as u32)
                .collect(),
        }
    }
    /// The world-space centre of a random floor tile; None for a map with no floor.
    pub fn random_point(&self, rng: &mut Rng) -> Option<(f32, f32)> {
        if self.tiles.is_empty() {
            return None;
        }
        let t = self.tiles[(rng.next_u64() % self.tiles.len() as u64) as usize] as usize;
        let tile = rh_sim::constants::TILE as f32;
        Some((
            (t % self.w) as f32 * tile + tile / 2.0,
            (t / self.w) as f32 * tile + tile / 2.0,
        ))
    }
}

/// What the last snapshot showed, reduced to what the script needs.
#[derive(Clone, Copy, Debug, Default)]
pub struct View {
    pub me: Option<(f32, f32)>,
    /// The nearest other living actor: (x, y, distance).
    pub nearest: Option<(f32, f32, f32)>,
    /// Match phase code of the snapshot; 1 is active (inputs are discarded in the lobby, so none are sent there).
    pub phase: u8,
}

/// Reduces a snapshot to a [`View`]. Status 1 is alive (protocol `DEFAULT_STATUS`).
pub fn view_of(
    me: Option<&rh_protocol::WireSelf>,
    actors: &[rh_protocol::WireActor],
    phase: u8,
) -> View {
    let mut v = View {
        phase,
        ..Default::default()
    };
    let Some(me) = me else { return v };
    v.me = Some((me.x, me.y));
    for a in actors
        .iter()
        .filter(|a| a.id != me.id && a.status == 1 && a.kind == 0)
    {
        let d = ((a.x - me.x).powi(2) + (a.y - me.y).powi(2)).sqrt();
        if v.nearest.is_none_or(|n| d < n.2) {
            v.nearest = Some((a.x, a.y, d));
        }
    }
    v
}

/// Distance (world units) at which a scripted player considers an enemy worth attacking.
pub const ENGAGE_RANGE: f32 = 200.0;
/// A click target this close counts as reached.
pub const ARRIVED: f32 = 48.0;
/// A command list never exceeds this: the protocol allows 16 per Input.
pub const MAX_CMDS: usize = 4;

#[derive(Debug)]
pub struct Brain {
    pub aggression: f64,
    waypoint: Option<(f32, f32)>,
    repick_at_ms: u64,
    move_seq: u8,
    attacking: bool,
    swapped_at_ms: u64,
}

impl Brain {
    pub fn new(aggression: f64) -> Self {
        Self {
            aggression,
            waypoint: None,
            repick_at_ms: 0,
            move_seq: 0,
            attacking: false,
            swapped_at_ms: 0,
        }
    }

    pub fn is_attacking(&self) -> bool {
        self.attacking
    }

    /// The commands for one input frame at `now_ms` (any monotonic millisecond clock). Empty in the lobby.
    pub fn act(
        &mut self,
        now_ms: u64,
        v: &View,
        floors: &Floors,
        rng: &mut Rng,
    ) -> Vec<WireCommand> {
        let mut out = Vec::new();
        if v.phase != 1 {
            self.attacking = false;
            return out;
        }
        let Some((mx, my)) = v.me else { return out };
        let hunt = v.nearest.is_some() && rng.chance(self.aggression);
        let arrived = self
            .waypoint
            .is_some_and(|(x, y)| ((x - mx).powi(2) + (y - my).powi(2)).sqrt() < ARRIVED);
        if self.waypoint.is_none()
            || arrived
            || now_ms >= self.repick_at_ms
            || (hunt && rng.chance(0.25))
        {
            let target = match (hunt, v.nearest) {
                (true, Some((x, y, _))) => Some((x, y)),
                _ => floors.random_point(rng),
            };
            if let Some((x, y)) = target {
                self.waypoint = Some((x, y));
                self.repick_at_ms = now_ms + rng.range_u64(3_000, 9_000);
                self.move_seq = self.move_seq.wrapping_add(1);
                out.push(WireCommand::Move {
                    x,
                    y,
                    seq: Some(self.move_seq),
                });
            }
        }
        let engage = v.nearest.filter(|n| n.2 <= ENGAGE_RANGE);
        match engage {
            Some((x, y, _)) if rng.chance(self.aggression) => {
                let a = (y - my).atan2(x - mx);
                out.push(WireCommand::Aim { a });
                out.push(WireCommand::Attack { a, t: None });
                self.attacking = true;
            }
            _ => {
                if self.attacking {
                    out.push(WireCommand::Release { a: 0.0, t: None });
                    self.attacking = false;
                } else if let Some((wx, wy)) = self.waypoint {
                    // Face the direction of travel, as a client renders it.
                    out.push(WireCommand::Aim {
                        a: (wy - my).atan2(wx - mx),
                    });
                }
            }
        }
        if self.aggression > 0.0 && now_ms >= self.swapped_at_ms + 20_000 && rng.chance(0.02) {
            self.swapped_at_ms = now_ms;
            out.push(WireCommand::Swap { slot: None });
        }
        out.truncate(MAX_CMDS);
        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn floors() -> Floors {
        // 4x3 map, walls on the border, a floor in the middle row.
        Floors::from_map(4, &[1, 1, 1, 1, 1, 0, 0, 1, 1, 1, 1, 1])
    }

    fn view(enemy: Option<f32>) -> View {
        View {
            me: Some((48.0, 48.0)),
            nearest: enemy.map(|d| (48.0 + d, 48.0, d)),
            phase: 1,
        }
    }

    #[test]
    fn rng_is_deterministic_and_in_range() {
        let (mut a, mut b) = (Rng::new(7), Rng::new(7));
        for _ in 0..100 {
            assert_eq!(a.next_u64(), b.next_u64());
        }
        let mut r = Rng::new(1);
        for _ in 0..10_000 {
            let x = r.f64();
            assert!((0.0..1.0).contains(&x));
            let n = r.range_u64(5, 9);
            assert!((5..=9).contains(&n));
        }
        assert_ne!(Rng::new(1).next_u64(), Rng::new(2).next_u64());
        assert_eq!(Rng::new(3).range_u64(4, 4), 4);
    }

    #[test]
    fn floors_only_yield_floor_tile_centres() {
        let f = floors();
        let mut r = Rng::new(3);
        for _ in 0..50 {
            let (x, y) = f.random_point(&mut r).unwrap();
            assert_eq!(y, 48.0, "row 1");
            assert!(x == 48.0 || x == 80.0, "{x}");
        }
        assert!(Floors::from_map(2, &[1, 1]).random_point(&mut r).is_none());
    }

    #[test]
    fn no_inputs_in_the_lobby() {
        let mut b = Brain::new(1.0);
        let v = View {
            phase: 0,
            ..view(Some(50.0))
        };
        assert!(b.act(0, &v, &floors(), &mut Rng::new(1)).is_empty());
    }

    #[test]
    fn zero_aggression_never_attacks_but_moves() {
        let (mut b, mut r, f) = (Brain::new(0.0), Rng::new(4), floors());
        let mut moved = false;
        for i in 0..500 {
            for c in b.act(i * 150, &view(Some(30.0)), &f, &mut r) {
                match c {
                    WireCommand::Attack { .. }
                    | WireCommand::Release { .. }
                    | WireCommand::Swap { .. } => panic!("{c:?}"),
                    WireCommand::Move { .. } => moved = true,
                    _ => {}
                }
            }
        }
        assert!(moved);
        assert!(!b.is_attacking());
    }

    #[test]
    fn full_aggression_attacks_an_enemy_in_range_and_releases_when_it_leaves() {
        let (mut b, mut r, f) = (Brain::new(1.0), Rng::new(5), floors());
        let cmds = b.act(0, &view(Some(60.0)), &f, &mut r);
        assert!(
            cmds.iter()
                .any(|c| matches!(c, WireCommand::Attack { a, .. } if a.abs() < 1e-6)),
            "{cmds:?}"
        );
        assert!(b.is_attacking());
        let cmds = b.act(150, &view(None), &f, &mut r);
        assert!(
            cmds.iter()
                .any(|c| matches!(c, WireCommand::Release { .. })),
            "{cmds:?}"
        );
        assert!(!b.is_attacking());
        // Out of range: no attack.
        let cmds = b.act(300, &view(Some(ENGAGE_RANGE + 50.0)), &f, &mut r);
        assert!(!cmds.iter().any(|c| matches!(c, WireCommand::Attack { .. })));
    }

    #[test]
    fn every_command_is_finite_and_a_frame_is_small() {
        let (mut b, mut r, f) = (Brain::new(0.7), Rng::new(6), floors());
        for i in 0..2000 {
            let cmds = b.act(i * 100, &view(Some((i % 400) as f32)), &f, &mut r);
            assert!(cmds.len() <= MAX_CMDS);
            let frame = rh_protocol::ClientMsg::Input {
                seq: i as u32,
                commands: cmds,
            }
            .encode();
            rh_protocol::ClientMsg::decode(&frame)
                .expect("a scripted frame is a valid client frame");
        }
    }

    #[test]
    fn view_picks_the_nearest_living_other_player() {
        let me = rh_protocol::WireSelf {
            sig: 0,
            effects: 0,
            displace_seq: 0,
            id: 1,
            faction: 0,
            x: 0.0,
            y: 0.0,
            facing: 0.0,
            hp: 1.0,
            max_hp: 1.0,
            barrier: 0.0,
            barrier_ring_step: 0,
            wish: None,
            status: 1,
            weapon: 0,
            ready_in_ms: 0,
            kills: 0,
            bounty: 0,
            gv: 0,
            move_seq: 0,
            hunt_target: None,
            hunt_stacks: 0,
        };
        let actor = |id, x, status| rh_protocol::WireActor {
            sig: 0,
            mob_type_code: 0,
            effects: 0,
            displace_seq: 0,
            id,
            faction: 0,
            x,
            y: 0.0,
            facing: 0.0,
            hp_pct: 100,
            barrier_pct: 0,
            barrier_ring_step: 0,
            status,
            weapon: 0,
            bounty: 0,
            kind: 0,
            windup: None,
        };
        let v = view_of(
            Some(&me),
            &[
                actor(1, 1.0, 1),
                actor(2, 90.0, 1),
                actor(3, 40.0, 0),
                actor(4, 60.0, 1),
            ],
            1,
        );
        assert_eq!(v.nearest.map(|n| n.0), Some(60.0));
        assert!(view_of(None, &[], 1).me.is_none());
    }
}
