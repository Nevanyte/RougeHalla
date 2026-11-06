//! The authoritative state hash, derived from the serialized state instead of listed by hand.
//!
//! [`Sim::state_hash`] feeds the [`crate::state::World`] through serde into a `HashSer`, a `serde::Serializer` that turns
//! every value into one or more 64-bit words and mixes them. What a checkpoint restores and what the hash sees are
//! therefore the same set by construction: a new component is covered the moment it is a serde field of the world, and the
//! only way to leave something out is a visible `#[serde(skip)]` (tick scratch, derived tables) with a stated reason. The
//! leaf-perturbation test (`tests/hash_coverage.rs`) proves it on real matches: every serialized leaf changes the hash.
//!
//! The statics (configuration, map layer, spawns) are folded once at construction into the `digest` of
//! [`crate::statics::MatchStatic`], which seeds the hash. The statics secrets are deliberately NOT part of the digest, but
//! the hash is not secret-free: `World.spawn_rng` is `Mulberry32::new(spawn_seed)` (its state is the seed), is hashed on
//! purpose as simulation state, and makes the state hash a function of the 32-bit spawn seed. The hash is therefore a
//! server-private determinism check: never sent to clients, never in public exports or logs (C-RNG).
//!
//! Layout rules the serializer relies on (checked by [`Sim::check_layout`]): field names are not hashed, only their values
//! and their order; enum variants hash their index; sequences, maps and strings hash their length first (8-byte chunks for
//! text), so no two layouts can run into each other; an `Option` hashes its tag. That is why the world may not use
//! `skip_serializing_if` or `flatten` (a missing or map-shaped field would be ambiguous), and may not hold a non-finite
//! float (JSON would write it as `null`, so a checkpoint could not restore it): represent a sentinel as an `Option`.
//!
//! Mixer: one `(h ^ word) * K` and a rotate per word (a bijection of the running state for every word, so a single changed
//! word always changes the result), then a splitmix64 finalizer.

use crate::sim::Sim;
use serde::ser::{self, Serialize};
use std::fmt;

const K: u64 = 0x9e37_79b9_7f4a_7c15;

/// A serializer that hashes. `CHECK` adds the layout validation of [`Sim::check_layout`]; the hashing build has none of it.
pub(crate) struct HashSer<const CHECK: bool> {
    h: u64,
    /// CHECK only: the first violation found, and the field being written.
    bad: Option<String>,
    at: &'static str,
}

#[derive(Debug)]
pub(crate) struct HashError(String);

impl fmt::Display for HashError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}
impl std::error::Error for HashError {}
impl ser::Error for HashError {
    fn custom<T: fmt::Display>(msg: T) -> Self {
        Self(msg.to_string())
    }
}

type R = Result<(), HashError>;

impl<const CHECK: bool> HashSer<CHECK> {
    fn seeded(seed: u64) -> Self {
        Self {
            h: seed,
            bad: None,
            at: "",
        }
    }

    #[inline(always)]
    fn word(&mut self, v: u64) {
        self.h = (self.h ^ v).wrapping_mul(K).rotate_left(29);
    }

    fn finish(&self) -> u64 {
        let mut z = self.h.wrapping_add(K);
        z = (z ^ (z >> 30)).wrapping_mul(0xbf58_476d_1ce4_e5b9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94d0_49bb_1331_11eb);
        z ^ (z >> 31)
    }

    /// Length, then the bytes in little-endian 8-byte chunks (the last one zero-padded: the length disambiguates).
    fn bytes(&mut self, b: &[u8]) {
        self.word(b.len() as u64);
        let mut chunks = b.chunks_exact(8);
        for c in &mut chunks {
            self.word(u64::from_le_bytes([
                c[0], c[1], c[2], c[3], c[4], c[5], c[6], c[7],
            ]));
        }
        let rest = chunks.remainder();
        if !rest.is_empty() {
            let mut a = [0u8; 8];
            a[..rest.len()].copy_from_slice(rest);
            self.word(u64::from_le_bytes(a));
        }
    }

    #[cold]
    fn violation(&mut self, what: &str) {
        if self.bad.is_none() {
            self.bad = Some(format!("{what} (at field `{}`)", self.at));
        }
    }
}

macro_rules! widen {
    ($($f:ident $t:ty),*) => {$(
        #[inline(always)]
        fn $f(self, v: $t) -> R {
            self.word(v as u64);
            Ok(())
        }
    )*};
}

impl<const CHECK: bool> ser::Serializer for &mut HashSer<CHECK> {
    type Ok = ();
    type Error = HashError;
    type SerializeSeq = Self;
    type SerializeTuple = Self;
    type SerializeTupleStruct = Self;
    type SerializeTupleVariant = Self;
    type SerializeMap = Self;
    type SerializeStruct = Self;
    type SerializeStructVariant = Self;

    widen!(serialize_u8 u8, serialize_u16 u16, serialize_u32 u32, serialize_u64 u64,
           serialize_i8 i8, serialize_i16 i16, serialize_i32 i32, serialize_i64 i64);

    fn is_human_readable(&self) -> bool {
        false
    }
    #[inline(always)]
    fn serialize_bool(self, v: bool) -> R {
        self.word(v as u64);
        Ok(())
    }
    fn serialize_i128(self, v: i128) -> R {
        self.word(v as u64);
        self.word((v >> 64) as u64);
        Ok(())
    }
    fn serialize_u128(self, v: u128) -> R {
        self.word(v as u64);
        self.word((v >> 64) as u64);
        Ok(())
    }
    #[inline(always)]
    fn serialize_f32(self, v: f32) -> R {
        if CHECK && !v.is_finite() {
            self.violation("non-finite f32");
        }
        self.word(v.to_bits() as u64);
        Ok(())
    }
    #[inline(always)]
    fn serialize_f64(self, v: f64) -> R {
        if CHECK && !v.is_finite() {
            self.violation("non-finite f64");
        }
        self.word(v.to_bits());
        Ok(())
    }
    fn serialize_char(self, v: char) -> R {
        self.word(v as u64);
        Ok(())
    }
    #[inline]
    fn serialize_str(self, v: &str) -> R {
        self.bytes(v.as_bytes());
        Ok(())
    }
    fn serialize_bytes(self, v: &[u8]) -> R {
        self.bytes(v);
        Ok(())
    }
    #[inline(always)]
    fn serialize_none(self) -> R {
        self.word(0);
        Ok(())
    }
    #[inline(always)]
    fn serialize_some<T: ?Sized + Serialize>(self, v: &T) -> R {
        self.word(1);
        v.serialize(self)
    }
    fn serialize_unit(self) -> R {
        Ok(())
    }
    fn serialize_unit_struct(self, _: &'static str) -> R {
        Ok(())
    }
    #[inline(always)]
    fn serialize_unit_variant(self, _: &'static str, idx: u32, _: &'static str) -> R {
        self.word(idx as u64);
        Ok(())
    }
    #[inline(always)]
    fn serialize_newtype_struct<T: ?Sized + Serialize>(self, _: &'static str, v: &T) -> R {
        v.serialize(self)
    }
    fn serialize_newtype_variant<T: ?Sized + Serialize>(
        self,
        _: &'static str,
        idx: u32,
        _: &'static str,
        v: &T,
    ) -> R {
        self.word(idx as u64);
        v.serialize(self)
    }
    #[inline(always)]
    fn serialize_seq(self, len: Option<usize>) -> Result<Self, HashError> {
        match len {
            Some(n) => self.word(n as u64),
            None if CHECK => self.violation("sequence of unknown length"),
            None => self.word(u64::MAX),
        }
        Ok(self)
    }
    #[inline(always)]
    fn serialize_tuple(self, _: usize) -> Result<Self, HashError> {
        Ok(self)
    }
    fn serialize_tuple_struct(self, _: &'static str, _: usize) -> Result<Self, HashError> {
        Ok(self)
    }
    fn serialize_tuple_variant(
        self,
        _: &'static str,
        idx: u32,
        _: &'static str,
        _: usize,
    ) -> Result<Self, HashError> {
        self.word(idx as u64);
        Ok(self)
    }
    fn serialize_map(self, len: Option<usize>) -> Result<Self, HashError> {
        match len {
            Some(n) => self.word(n as u64),
            // `#[serde(flatten)]` writes its struct as a map of unknown length.
            None if CHECK => self.violation("map of unknown length (serde flatten?)"),
            None => self.word(u64::MAX),
        }
        Ok(self)
    }
    #[inline(always)]
    fn serialize_struct(self, _: &'static str, _: usize) -> Result<Self, HashError> {
        Ok(self)
    }
    fn serialize_struct_variant(
        self,
        _: &'static str,
        idx: u32,
        _: &'static str,
        _: usize,
    ) -> Result<Self, HashError> {
        self.word(idx as u64);
        Ok(self)
    }
}

macro_rules! element {
    ($($tr:ident $m:ident),*) => {$(
        impl<const CHECK: bool> ser::$tr for &mut HashSer<CHECK> {
            type Ok = ();
            type Error = HashError;
            #[inline(always)]
            fn $m<T: ?Sized + Serialize>(&mut self, v: &T) -> R {
                v.serialize(&mut **self)
            }
            fn end(self) -> R {
                Ok(())
            }
        }
    )*};
}
element!(SerializeSeq serialize_element, SerializeTuple serialize_element,
         SerializeTupleStruct serialize_field, SerializeTupleVariant serialize_field);

impl<const CHECK: bool> ser::SerializeMap for &mut HashSer<CHECK> {
    type Ok = ();
    type Error = HashError;
    fn serialize_key<T: ?Sized + Serialize>(&mut self, k: &T) -> R {
        k.serialize(&mut **self)
    }
    fn serialize_value<T: ?Sized + Serialize>(&mut self, v: &T) -> R {
        v.serialize(&mut **self)
    }
    fn end(self) -> R {
        Ok(())
    }
}

impl<const CHECK: bool> ser::SerializeStruct for &mut HashSer<CHECK> {
    type Ok = ();
    type Error = HashError;
    #[inline(always)]
    fn serialize_field<T: ?Sized + Serialize>(&mut self, key: &'static str, v: &T) -> R {
        if CHECK {
            self.at = key;
        }
        v.serialize(&mut **self)
    }
    fn skip_field(&mut self, key: &'static str) -> R {
        if CHECK {
            self.at = key;
            self.violation("skipped field (skip_serializing_if)");
        }
        Ok(())
    }
    fn end(self) -> R {
        Ok(())
    }
}

impl<const CHECK: bool> ser::SerializeStructVariant for &mut HashSer<CHECK> {
    type Ok = ();
    type Error = HashError;
    fn serialize_field<T: ?Sized + Serialize>(&mut self, key: &'static str, v: &T) -> R {
        if CHECK {
            self.at = key;
        }
        v.serialize(&mut **self)
    }
    fn skip_field(&mut self, key: &'static str) -> R {
        if CHECK {
            self.at = key;
            self.violation("skipped field (skip_serializing_if)");
        }
        Ok(())
    }
    fn end(self) -> R {
        Ok(())
    }
}

/// The hash of `v`'s serialized form, starting from `seed`.
pub(crate) fn hash_of<T: Serialize + ?Sized>(seed: u64, v: &T) -> u64 {
    let mut h = HashSer::<false>::seeded(seed);
    // The hashing serializer cannot fail: every method returns Ok.
    let _ = v.serialize(&mut h);
    h.finish()
}

/// The layout check over any serializable value (the engine of [`Sim::check_layout`]).
fn check_of<T: Serialize + ?Sized>(v: &T) -> Result<(), String> {
    let mut h = HashSer::<true>::seeded(0);
    v.serialize(&mut h).map_err(|e| e.to_string())?;
    h.bad.map_or(Ok(()), Err)
}

impl Sim {
    /// A 64-bit hash of the authoritative state, for determinism and live/headless equivalence checks: the whole serialized
    /// [`crate::state::World`] seeded with the digest of the statics (configuration, map layer, spawns; never the secrets).
    /// Not a security hash and server-private. It sees exactly what a checkpoint restores (module docs), and tick scratch is
    /// empty between steps, so call it between steps only.
    pub fn state_hash(&self) -> u64 {
        debug_assert!(
            self.s.is_settled() && !self.w.pay.collecting && self.w.pay.items.is_empty(),
            "state_hash between steps only"
        );
        hash_of(self.k.digest, &self.w)
    }

    /// Validates that the serialized checkpoint is hashable without ambiguity and checkpoint-safe: no non-finite float (a
    /// sentinel is an `Option`), no `skip_serializing_if` or `flatten` anywhere, no sequence of unknown length. `Err` names
    /// the first violation and the field it was found at. A permanent test runs this over real matches.
    pub fn check_layout(&self) -> Result<(), String> {
        check_of(self)
    }
}

#[cfg(test)]
mod tests {
    use super::{check_of, hash_of};
    use crate::arenas::practice_arena;
    use crate::content::FactionId;
    use crate::input::{cmd, RawCommand};
    use crate::math::Vec2;
    use crate::sim::{Placement, PlayerId, Secrets, Sim, SimConfig};

    fn sim() -> Sim {
        let ps = [
            Placement {
                profile: "a".into(),
                faction: FactionId::Holy,
                bot: false,
                at: Vec2::new(200.0, 200.0),
                hp: None,
                weapon0: None,
                weapon1: None,
            },
            Placement {
                profile: "b".into(),
                faction: FactionId::Fire,
                bot: false,
                at: Vec2::new(600.0, 600.0),
                hp: None,
                weapon0: None,
                weapon1: None,
            },
            Placement {
                profile: "c".into(),
                faction: FactionId::Frost,
                bot: false,
                at: Vec2::new(900.0, 300.0),
                hp: None,
                weapon0: None,
                weapon1: None,
            },
        ];
        Sim::reset_active(
            SimConfig::default(),
            practice_arena(),
            Secrets::from_seed(5),
            &ps,
        )
    }

    /// Hand-built mutations of fields the previous hand list was written for. The coverage over EVERY serialized leaf is
    /// `tests/hash_coverage.rs`; this keeps a readable spot check next to the hasher.
    #[test]
    fn the_state_hash_sees_every_outcome_field() {
        let base = sim();
        let h0 = base.state_hash();
        type Mutation = (&'static str, Box<dyn Fn(&mut Sim)>);
        let mutations: Vec<Mutation> = vec![
            (
                "gv parts",
                Box::new(|s| s.w.players[0].credit.gv_parts.bounty = 7),
            ),
            (
                "killed by",
                Box::new(|s| s.w.players[0].fate.killed_by = Some(PlayerId(2))),
            ),
            (
                "damaged humans",
                Box::new(|s| s.w.players[0].credit.damaged_humans.push(PlayerId(2))),
            ),
            (
                "last hit",
                Box::new(|s| s.w.players[0].credit.last_hit = Some((PlayerId(2), 50.0))),
            ),
            (
                "dropped at",
                Box::new(|s| s.w.players[0].seat.dropped_at = Some(50.0)),
            ),
            (
                "bot kills",
                Box::new(|s| s.w.players[0].credit.bot_kills = 1),
            ),
            (
                "budget",
                Box::new(|s| {
                    let _ = s.w.players[0]
                        .seat
                        .budget
                        .allow(&cmd(RawCommand::Stop { seq: None }), 50.0);
                }),
            ),
            ("started humans", Box::new(|s| s.w.rt.started_humans = 1)),
            ("winner", Box::new(|s| s.w.winner = Some(PlayerId(1)))),
            (
                "roster name",
                Box::new(|s| s.w.roster.push(PlayerId(99), "late")),
            ),
            (
                "deferred hit",
                Box::new(|s| {
                    s.w.deferred.defer_hit(crate::systems::ledger::Entry {
                        dot: false,
                        ability: None,
                        arena: false,
                        source: None,
                        critical: false,
                        critical_mult: None,
                        sig: None,
                        execute: false,
                        victim: PlayerId(1),
                        by: Some(PlayerId(2)),
                        packet: crate::state::Packet {
                            raw: 1.0,
                            phys: 1.0,
                            magic: 0.0,
                            true_: 0.0,
                        },
                        weapon: Some(crate::content::WeaponId::Fists),
                        stagger: false,
                        projectile: None,
                        scale: 1.0,
                        derived: false,
                        passive: false,
                    })
                }),
            ),
        ];
        for (name, m) in mutations {
            let mut s = base.clone();
            m(&mut s);
            assert_ne!(s.state_hash(), h0, "{name} must change the state hash");
        }
    }

    #[test]
    fn the_statics_secrets_are_not_mixed_into_the_digest() {
        // Only the statics secrets are tested here: `World.spawn_rng` derives from the spawn seed and is hashed on purpose,
        // so the state hash itself must stay server-private (see the module doc).
        let a = sim();
        let mut b = a.clone();
        b.k.secrets = Secrets::from_seed(77);
        assert_eq!(
            a.state_hash(),
            b.state_hash(),
            "the statics secrets never reach the digest"
        );
    }

    #[test]
    fn the_statics_digest_sees_config_map_and_spawns() {
        let a = sim();
        let h0 = a.state_hash();
        let mut cfg = a.clone();
        cfg.k = crate::statics::MatchStatic::new(
            SimConfig {
                pvp_rules: false,
                ..a.k.config.clone()
            },
            a.k.arena.clone(),
            a.k.secrets,
        );
        assert_ne!(cfg.state_hash(), h0, "config");
        let mut arena = (*a.k.arena).clone();
        arena.spawns.push(Vec2::new(1.0, 2.0));
        let mut sp = a.clone();
        sp.k = crate::statics::MatchStatic::new(a.k.config.clone(), arena, a.k.secrets);
        assert_ne!(sp.state_hash(), h0, "spawns");
        let mut arena = (*a.k.arena).clone();
        let (w, h, mut tiles) = (arena.map.w, arena.map.h, arena.map.tiles.clone());
        tiles[0] ^= 1;
        arena.map = crate::map::TileMap::new(w, h, tiles).unwrap();
        let mut m = a.clone();
        m.k = crate::statics::MatchStatic::new(a.k.config.clone(), arena, a.k.secrets);
        assert_ne!(m.state_hash(), h0, "map layer");
    }

    #[test]
    fn lengths_are_prefixed_so_layouts_cannot_run_into_each_other() {
        let h = |v: &dyn erased::Ser| v.hash();
        assert_ne!(
            h(&(vec![1u64, 2], vec![3u64])),
            h(&(vec![1u64], vec![2u64, 3]))
        );
        assert_ne!(h(&("ab", "c")), h(&("a", "bc")));
        assert_ne!(h(&"abcdefgh"), h(&"abcdefg"));
        assert_ne!(h(&Some(0u64)), h(&None::<u64>));
    }

    mod erased {
        pub trait Ser {
            fn hash(&self) -> u64;
        }
        impl<T: serde::Serialize> Ser for T {
            fn hash(&self) -> u64 {
                super::hash_of(0, self)
            }
        }
    }

    #[test]
    fn the_layout_check_accepts_the_real_state() {
        assert_eq!(sim().check_layout(), Ok(()));
    }

    #[test]
    fn the_layout_check_refuses_non_finite_skipped_and_flattened_fields() {
        #[derive(serde::Serialize)]
        struct Nan {
            hp: f64,
        }
        let e = check_of(&Nan {
            hp: f64::NEG_INFINITY,
        })
        .unwrap_err();
        assert!(e.contains("non-finite f64") && e.contains("hp"), "{e}");
        #[derive(serde::Serialize)]
        struct Skips {
            #[serde(skip_serializing_if = "Option::is_none")]
            maybe: Option<u8>,
        }
        let e = check_of(&Skips { maybe: None }).unwrap_err();
        assert!(e.contains("skipped field") && e.contains("maybe"), "{e}");
        assert!(check_of(&Skips { maybe: Some(1) }).is_ok());
        #[derive(serde::Serialize)]
        struct Inner {
            a: u8,
        }
        #[derive(serde::Serialize)]
        struct Flat {
            #[serde(flatten)]
            inner: Inner,
        }
        let e = check_of(&Flat {
            inner: Inner { a: 1 },
        })
        .unwrap_err();
        assert!(e.contains("unknown length"), "{e}");
        // The sentinel form: an Option is fine.
        assert!(check_of(&Some(1.0f64)).is_ok());
    }
}
