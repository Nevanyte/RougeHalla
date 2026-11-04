//! Decision bench for ADR 0010: what a per-connection snapshot delta would save over the shipped v2 Snapshot, and what it
//! would cost. NOT a protocol implementation: `Q`, `full_into` and `delta_into` are a prototype of the cheapest sensible
//! delta record (base tick, per changed actor a LEB128 id gap + a field mask + the changed fields, a departed-id list),
//! enough to measure bytes and instructions honestly.
//!
//!   cargo build --release -p rh-server --features synthetic --bin deltabench
//!   target/release/deltabench real  [ticks=2400]       8 scripted bots on the seed-1 map (the real game)
//!   target/release/deltabench synth <N> [ticks=200]    N synthetic fighters (scalebench's disc and move orders)
//!
//! Bytes: `head` is the real v2 frame of the same observation with no actors (tag, tick, ack, head word, self block,
//! count), identical in both; `v2` adds the v2 actor records, `delta` replaces them with the prototype's records plus one
//! byte for the base tick. Frames over MAX_ACTORS are counted by the same model (the real codec refuses them: that is a
//! statement about the observation, not the codec). Instructions: run under
//! `valgrind --tool=callgrind --toggle-collect='*full_into*'` (and `*delta_into*`).
use rh_headless::{Agent, AgentSpec, Env, EnvConfig};
use rh_policy::scripted::Brawler;
use rh_protocol::quant::{quantize_facing, quantize_pos, round_half_away};
use rh_protocol::Writer;
use rh_sim::observe::ActorView;
use rh_sim::{
    arenas::practice_arena, observe_into, validate, Command, FactionId, Observation, Placement,
    PlayerId, RawCommand, Secrets, Sim, SimConfig, Vec2,
};

/// One remote actor as a connection would remember it: what the wire carries, 14 bytes (16 with padding).
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
struct Q {
    id: u32,
    x: u16,
    y: u16,
    f: u16,
    kit: u8,
    hp: u8,
    status: u8,
    bounty: u16,
}

fn quantize(a: &ActorView) -> Q {
    Q {
        id: a.id.0,
        x: quantize_pos(a.x as f32),
        y: quantize_pos(a.y as f32),
        f: quantize_facing(a.facing as f32),
        kit: a.faction.code() | (a.weapon.code() << 4),
        hp: round_half_away(a.hp_frac * 100.0).clamp(0, 100) as u8,
        status: a.status as u8,
        bounty: a.bounty.min(65535) as u16,
    }
}

const BX: u8 = 1;
const BY: u8 = 2;
const BF: u8 = 4;
const BK: u8 = 8;
const BH: u8 = 16;
const BB: u8 = 32;
// bits 6..7: status, inline.

/// The v2 actor records (what the room task writes today).
#[inline(never)]
fn full_into(cur: &[Q], out: &mut Writer) {
    let mut last = 0u32;
    for (i, q) in cur.iter().enumerate() {
        out.varint(if i == 0 { q.id } else { q.id - last });
        last = q.id;
        let mask = (q.kit != 0) as u8
            | ((q.hp != 100) as u8) << 1
            | (q.status << 2)
            | ((q.bounty != 0) as u8) << 4;
        out.u8(mask);
        out.u16(q.x);
        out.u16(q.y);
        out.u16(q.f);
        if q.kit != 0 {
            out.u8(q.kit);
        }
        if q.hp != 100 {
            out.u8(q.hp);
        }
        if q.bounty != 0 {
            out.varint(q.bounty as u32);
        }
    }
}

/// The prototype delta records: changed actors against `base` (both ascending by id), then the departed ids.
#[inline(never)]
fn delta_into(base: &[Q], cur: &[Q], out: &mut Writer, departed: &mut Vec<u32>) {
    departed.clear();
    let (mut i, mut j) = (0, 0);
    let mut last = 0u32;
    let mut first = true;
    while j < cur.len() {
        let c = &cur[j];
        while i < base.len() && base[i].id < c.id {
            departed.push(base[i].id);
            i += 1;
        }
        let b = if i < base.len() && base[i].id == c.id {
            i += 1;
            Some(&base[i - 1])
        } else {
            None
        };
        j += 1;
        let (mask, same_status) = match b {
            Some(b) => (
                (c.x != b.x) as u8
                    | ((c.y != b.y) as u8) << 1
                    | ((c.f != b.f) as u8) << 2
                    | ((c.kit != b.kit) as u8) << 3
                    | ((c.hp != b.hp) as u8) << 4
                    | ((c.bounty != b.bounty) as u8) << 5,
                b.status == c.status,
            ),
            None => (BX | BY | BF | BK | BH | BB, false),
        };
        if mask == 0 && same_status {
            continue;
        }
        out.varint(if first { c.id } else { c.id - last });
        first = false;
        last = c.id;
        out.u8(mask | (c.status << 6));
        if mask & BX != 0 {
            out.u16(c.x);
        }
        if mask & BY != 0 {
            out.u16(c.y);
        }
        if mask & BF != 0 {
            out.u16(c.f);
        }
        if mask & BK != 0 {
            out.u8(c.kit);
        }
        if mask & BH != 0 {
            out.u8(c.hp);
        }
        if mask & BB != 0 {
            out.varint(c.bounty as u32);
        }
    }
    while i < base.len() {
        departed.push(base[i].id);
        i += 1;
    }
    out.varint(departed.len() as u32);
    let mut last = 0;
    for &d in departed.iter() {
        out.varint(d - last);
        last = d;
    }
}

#[derive(Default)]
struct Totals {
    viewer_ticks: u64,
    head: u64,
    full: u64,
    delta: u64,
    actors: u64,
    max_actors: usize,
}

struct Viewer {
    base: Vec<Q>,
    cur: Vec<Q>,
    obs: Observation,
}

impl Viewer {
    fn new() -> Self {
        Viewer {
            base: Vec::new(),
            cur: Vec::new(),
            obs: Observation::default(),
        }
    }
}

fn account(t: &mut Totals, v: &mut Viewer, head: u64, dep: &mut Vec<u32>) {
    let mut w = Writer::with_capacity(64);
    full_into(&v.cur, &mut w);
    let full = w.finish().len() as u64;
    let mut w = Writer::with_capacity(64);
    delta_into(&v.base, &v.cur, &mut w, dep);
    // +1: the base tick (a varint distance, one byte while the base is under 128 ticks behind).
    let delta = w.finish().len() as u64 + 1;
    t.viewer_ticks += 1;
    t.head += head;
    t.full += full;
    t.delta += delta;
    t.actors += v.cur.len() as u64;
    t.max_actors = t.max_actors.max(v.cur.len());
    std::mem::swap(&mut v.base, &mut v.cur);
}

fn head_bytes(obs: &Observation, scratch: &mut Vec<u8>) -> u64 {
    let mut o = obs.clone();
    o.visible.clear();
    rh_server::wire::encode_snapshot(&o, 0, scratch)
        .expect("head encodes")
        .len() as u64
}

fn report(mode: &str, n: usize, secs: f64, viewers: usize, t: &Totals) {
    let per = |b: u64| b as f64 / viewers as f64 / secs;
    let (head, full, delta) = (per(t.head), per(t.full), per(t.delta));
    let (fb, db) = (head + full, head + delta);
    println!(
        "{{\"mode\":\"{mode}\",\"n\":{n},\"viewers\":{viewers},\"meanVisible\":{:.2},\"maxVisible\":{},\
\"v2SnapshotBytesPerPlayerPerSec\":{fb:.0},\"deltaSnapshotBytesPerPlayerPerSec\":{db:.0},\"savedPct\":{:.1},\
\"headBytesPerPlayerPerSec\":{head:.0},\"v2ActorBytesPerPlayerPerSec\":{full:.0},\"deltaActorBytesPerPlayerPerSec\":{delta:.0},\
\"perConnBaseBytesAtMaxVisible\":{}}}",
        t.actors as f64 / t.viewer_ticks.max(1) as f64,
        t.max_actors,
        (1.0 - db / fb) * 100.0,
        t.max_actors * std::mem::size_of::<Q>()
    );
}

fn real(ticks: u32) {
    let arena =
        rh_headless::load_arena("parity/maps/seed1.map.json").expect("run from the repo root");
    let agents = (0..8)
        .map(|i| AgentSpec {
            profile: format!("b{i}"),
            faction: FactionId::ALL[i % 5],
            bot: true,
            agent: Agent::Policy {
                policy: Box::new(Brawler::new(2)),
            },
        })
        .collect();
    let mut env = Env::new(
        EnvConfig {
            arena,
            sim: SimConfig::default(),
            max_ticks: ticks,
            record: false,
        },
        agents,
        1,
    );
    let ids: Vec<PlayerId> = env.sim.players().iter().map(|p| p.id).collect();
    let mut views: Vec<Viewer> = ids.iter().map(|_| Viewer::new()).collect();
    let (mut t, mut dep, mut scratch) = (Totals::default(), Vec::new(), Vec::new());
    let mut steps = 0u32;
    for _ in 0..ticks {
        let p = env.advance(&[]);
        steps += 1;
        let ev = env.last_events().to_vec();
        for (id, v) in ids.iter().zip(views.iter_mut()) {
            observe_into(&env.sim, *id, &ev, &mut v.obs);
            v.cur.clear();
            v.cur.extend(v.obs.visible.iter().map(quantize));
            let hb = head_bytes(&v.obs, &mut scratch);
            account(&mut t, v, hb, &mut dep);
        }
        if p.terminated {
            break;
        }
    }
    report("real", 8, steps as f64 * 0.05, ids.len(), &t);
}

fn xorshift(s: &mut u64) -> u64 {
    let mut x = *s;
    x ^= x << 13;
    x ^= x >> 7;
    x ^= x << 17;
    *s = x;
    x
}

fn unit(s: &mut u64) -> f64 {
    (xorshift(s) >> 11) as f64 / (1u64 << 53) as f64
}

fn synth(n: usize, ticks: u32) {
    let arena = practice_arena();
    let c = arena.centre();
    let mut ring = 0usize;
    let mut pl = Vec::new();
    while pl.len() < n {
        let r = ring as f64 * 22.0;
        let slots = if ring == 0 { 1 } else { ring * 6 };
        for k in 0..slots {
            if pl.len() == n {
                break;
            }
            let a = std::f64::consts::TAU * k as f64 / slots as f64;
            pl.push(Placement {
                profile: format!("s{}", pl.len()),
                faction: FactionId::ALL[pl.len() % 5],
                bot: true,
                at: Vec2::new(c.x + r * a.cos(), c.y + r * a.sin()),
                hp: Some(1.0e12),
            });
        }
        ring += 1;
    }
    let (w_, h_) = (arena.map.w as f64 * 32.0, arena.map.h as f64 * 32.0);
    let mut sim = Sim::synthetic(SimConfig::default(), arena, Secrets::from_seed(1), &pl);
    let ids: Vec<PlayerId> = sim.players().iter().map(|p| p.id).collect();
    let mut rngs: Vec<u64> = ids
        .iter()
        .map(|id| 0x9e37_79b9_7f4a_7c15 ^ (id.0 as u64).wrapping_mul(0xbf58_476d_1ce4_e5b9))
        .collect();
    // Eight sampled viewers spread over the crowd (the first is the centre fighter).
    let viewers: Vec<PlayerId> = (0..8).map(|k| ids[k * ids.len() / 8]).collect();
    let mut views: Vec<Viewer> = viewers.iter().map(|_| Viewer::new()).collect();
    let (mut t, mut dep, mut scratch) = (Totals::default(), Vec::new(), Vec::new());
    let mut ev = Vec::new();
    let warm = 8u32;
    for tick in 0..ticks + warm {
        for (i, id) in ids.iter().enumerate() {
            let rng = &mut rngs[i];
            if (tick as usize + i) % 16 == 0 {
                let (gx, gy) = (w_ * (0.35 + 0.3 * unit(rng)), h_ * (0.35 + 0.3 * unit(rng)));
                if let Ok(c @ Command::Move { .. }) = validate(RawCommand::Move {
                    x: gx,
                    y: gy,
                    seq: None,
                }) {
                    let _ = sim.submit_unbudgeted(*id, c);
                }
            }
        }
        ev.clear();
        sim.step_into(&mut ev);
        for (id, v) in viewers.iter().zip(views.iter_mut()) {
            observe_into(&sim, *id, &ev, &mut v.obs);
            v.cur.clear();
            v.cur.extend(v.obs.visible.iter().map(quantize));
            if tick >= warm {
                let hb = head_bytes(&v.obs, &mut scratch);
                account(&mut t, v, hb, &mut dep);
            } else {
                std::mem::swap(&mut v.base, &mut v.cur);
            }
        }
    }
    report("synth", n, ticks as f64 * 0.05, viewers.len(), &t);
}

fn main() {
    let a: Vec<String> = std::env::args().skip(1).collect();
    let num = |i: usize, d: u32| a.get(i).and_then(|v| v.parse().ok()).unwrap_or(d);
    match a.first().map(String::as_str) {
        Some("real") => real(num(1, 2400)),
        Some("synth") => synth(num(1, 204) as usize, num(2, 200)),
        _ => {
            eprintln!("usage: deltabench real [ticks] | synth <N> [ticks]");
            std::process::exit(2);
        }
    }
}
