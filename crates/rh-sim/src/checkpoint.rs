//! Checkpoints: `{format, statics, world}` as JSON (or any serde format). The format tag is written first and refused
//! before the payload is interpreted, whatever order the keys arrive in, so a checkpoint of another layout (or none at all)
//! fails with a typed [`CheckpointError`] instead of an arbitrary serde error or a silently wrong state. Per-tick scratch is
//! never part of a checkpoint: a restored [`Sim`] starts with an empty [`TickScratch`] and behaves identically
//! (docs/CONTRACTS.md C-DET). A decoded [`Sim`] is complete (the map tables and the statics digest are built while
//! decoding); malformed or truncated input is an `Err`, never a panic.

use crate::content::WeaponId;
use crate::pathfind::Pathfinder;
use crate::scratch::TickScratch;
use crate::sim::Sim;
use crate::state::World;
use crate::statics::MatchStatic;
use serde::de::value::{MapAccessDeserializer, MapDeserializer, SeqDeserializer};
use serde::de::{
    self, Deserialize, Deserializer, IgnoredAny, IntoDeserializer, MapAccess, Visitor,
};
use serde::ser::{SerializeStruct, Serializer};
use std::fmt;

/// The tag every checkpoint carries. Bump it when the layout of `statics` or `world` changes incompatibly.
pub const CHECKPOINT_FORMAT: &str = "rh-checkpoint/3";

/// Why a checkpoint was refused.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum CheckpointError {
    /// No `format` key: not a checkpoint, or one written before checkpoints were tagged.
    MissingFormat,
    /// A `format` this build does not read.
    UnsupportedFormat { found: String },
    /// The tag matched but the payload did not parse (or lacks `statics` / `world`).
    Malformed(String),
}

impl fmt::Display for CheckpointError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::MissingFormat => write!(
                f,
                "checkpoint has no format tag (expected \"{CHECKPOINT_FORMAT}\")"
            ),
            Self::UnsupportedFormat { found } => write!(
                f,
                "unsupported checkpoint format \"{found}\" (expected \"{CHECKPOINT_FORMAT}\")"
            ),
            Self::Malformed(why) => write!(f, "malformed checkpoint: {why}"),
        }
    }
}

impl std::error::Error for CheckpointError {}

impl Sim {
    /// Restores a match from a checkpoint read through `d`, refusing any other format with a typed error.
    pub fn restore<'de, D: Deserializer<'de>>(d: D) -> Result<Sim, CheckpointError> {
        let mut why = None;
        match d.deserialize_struct("Checkpoint", FIELDS, CheckpointVisitor { why: &mut why }) {
            Ok(sim) => Ok(sim),
            Err(e) => Err(why.unwrap_or_else(|| CheckpointError::Malformed(e.to_string()))),
        }
    }
}

const FIELDS: &[&str] = &["format", "statics", "world"];

impl serde::Serialize for Sim {
    fn serialize<S: Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        let mut st = s.serialize_struct("Checkpoint", FIELDS.len())?;
        st.serialize_field("format", CHECKPOINT_FORMAT)?;
        st.serialize_field("statics", &self.k)?;
        st.serialize_field("world", &self.w)?;
        st.end()
    }
}

impl<'de> serde::Deserialize<'de> for Sim {
    fn deserialize<D: Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        d.deserialize_struct("Checkpoint", FIELDS, CheckpointVisitor { why: &mut None })
    }
}

#[derive(serde::Deserialize)]
#[serde(field_identifier, rename_all = "lowercase")]
enum Key {
    Format,
    Statics,
    World,
    #[serde(other)]
    Other,
}

/// A part of the checkpoint: parsed at once when the tag is already known good, or held as a [`Buf`] until it is.
enum Part<T> {
    Typed(T),
    Held(Buf),
}

impl<T: for<'a> Deserialize<'a>> Part<T> {
    fn typed(self) -> Result<T, de::value::Error> {
        match self {
            Part::Typed(t) => Ok(t),
            Part::Held(b) => T::deserialize(b),
        }
    }
}

struct CheckpointVisitor<'a> {
    why: &'a mut Option<CheckpointError>,
}

impl CheckpointVisitor<'_> {
    /// Records the typed reason and returns the serde error that carries its message.
    fn refuse<E: de::Error>(self, why: CheckpointError) -> E {
        let e = E::custom(&why);
        *self.why = Some(why);
        e
    }
}

impl<'de> Visitor<'de> for CheckpointVisitor<'_> {
    type Value = Sim;

    fn expecting(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "a {CHECKPOINT_FORMAT} checkpoint")
    }

    fn visit_map<A: MapAccess<'de>>(self, mut map: A) -> Result<Sim, A::Error> {
        let mut tagged = false;
        let (mut statics, mut world) = (None::<Part<MatchStatic>>, None::<Part<World>>);
        while let Some(key) = map.next_key::<Key>()? {
            match key {
                Key::Format => {
                    let found: String = map.next_value()?;
                    if found != CHECKPOINT_FORMAT {
                        return Err(self.refuse(CheckpointError::UnsupportedFormat { found }));
                    }
                    tagged = true;
                }
                // Before the tag has been read a payload is only held (a stale layout must be refused by its tag, not by
                // whatever its payload happens to fail on); after it, it is parsed straight into its type.
                Key::Statics => {
                    statics = Some(if tagged {
                        Part::Typed(map.next_value()?)
                    } else {
                        Part::Held(map.next_value()?)
                    })
                }
                Key::World => {
                    world = Some(if tagged {
                        Part::Typed(map.next_value()?)
                    } else {
                        Part::Held(map.next_value()?)
                    })
                }
                Key::Other => {
                    map.next_value::<IgnoredAny>()?;
                }
            }
        }
        if !tagged {
            return Err(self.refuse(CheckpointError::MissingFormat));
        }
        let (Some(k), Some(w)) = (statics, world) else {
            return Err(self.refuse(CheckpointError::Malformed(
                "missing `statics` or `world`".into(),
            )));
        };
        let (k, w) = match (k.typed(), w.typed()) {
            (Ok(k), Ok(w)) => (k, w),
            (Err(e), _) | (_, Err(e)) => {
                return Err(self.refuse(CheckpointError::Malformed(e.to_string())))
            }
        };
        if let Err(why) = check_world(&w) {
            return Err(self.refuse(CheckpointError::Malformed(why)));
        }
        Ok(Sim {
            k,
            w,
            s: TickScratch::default(),
            pf: Pathfinder::default(),
        })
    }
}

/// The invariants the tick relies on and the serde shape cannot express. A state that breaks one would panic (or silently
/// misbehave) a few steps later, so a checkpoint carrying it is refused here instead.
fn check_world(w: &World) -> Result<(), String> {
    // `next_id` hands out the next join: at or below a present or past id it would push out of order (a panic).
    let ceiling = w
        .players
        .last()
        .map(|p| p.id)
        .into_iter()
        .chain(w.roster.last_id())
        .max();
    if let Some(last) = ceiling {
        if w.next_id <= last.0 {
            return Err(format!(
                "next_id {} is not greater than the last player or roster id {}",
                w.next_id, last.0
            ));
        }
    }
    // Roster order is checked by its own decoder and player order by the store's.
    if !w.server_time.is_finite() {
        return Err(format!("server_time {} is not finite", w.server_time));
    }
    // The tick counter is incremented every step.
    if w.tick == u32::MAX {
        return Err("tick is at its maximum".into());
    }
    for p in w.players.iter() {
        // Samples are appended in time order and never dated after the clock: a future-dated one is never trimmed and
        // fills the ring.
        let h = p.body.history.as_slice();
        if h.windows(2).any(|s| !(s[0].t <= s[1].t)) {
            return Err(format!(
                "player {}: rewind history is not in time order",
                p.id.0
            ));
        }
        if let Some(l) = h.last() {
            if !(l.t <= w.server_time) {
                return Err(format!(
                    "player {}: rewind history ends at {}, after server_time {}",
                    p.id.0, l.t, w.server_time
                ));
            }
        }
        // The slice has no item flow, so nobody carries anything but fists; a bow or wand would reach the ranged attack
        // path, which is not in the slice (systems/weapons.rs `land`).
        for item in [p.weapon.weapon0, p.weapon.weapon1].into_iter().flatten() {
            if item != WeaponId::Fists {
                return Err(format!("player {}: carries {item:?}", p.id.0));
            }
        }
    }
    Ok(())
}

/// A self-describing value held while a checkpoint's tag is still unread (serde_json's `Value`, in miniature), which then
/// deserializes into the real type. Only used when a payload key precedes `format`; checkpoints this build writes never do.
enum Buf {
    Unit,
    Bool(bool),
    I64(i64),
    U64(u64),
    F64(f64),
    Str(String),
    Seq(Vec<Buf>),
    Map(Vec<(Buf, Buf)>),
}

impl<'de> Deserialize<'de> for Buf {
    fn deserialize<D: Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        d.deserialize_any(BufVisitor)
    }
}

struct BufVisitor;

impl<'de> Visitor<'de> for BufVisitor {
    type Value = Buf;
    fn expecting(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("any value")
    }
    fn visit_bool<E>(self, v: bool) -> Result<Buf, E> {
        Ok(Buf::Bool(v))
    }
    fn visit_i64<E>(self, v: i64) -> Result<Buf, E> {
        Ok(Buf::I64(v))
    }
    fn visit_u64<E>(self, v: u64) -> Result<Buf, E> {
        Ok(Buf::U64(v))
    }
    fn visit_f64<E>(self, v: f64) -> Result<Buf, E> {
        Ok(Buf::F64(v))
    }
    fn visit_str<E>(self, v: &str) -> Result<Buf, E> {
        Ok(Buf::Str(v.to_owned()))
    }
    fn visit_string<E>(self, v: String) -> Result<Buf, E> {
        Ok(Buf::Str(v))
    }
    fn visit_unit<E>(self) -> Result<Buf, E> {
        Ok(Buf::Unit)
    }
    fn visit_none<E>(self) -> Result<Buf, E> {
        Ok(Buf::Unit)
    }
    fn visit_some<D: Deserializer<'de>>(self, d: D) -> Result<Buf, D::Error> {
        Buf::deserialize(d)
    }
    fn visit_seq<A: de::SeqAccess<'de>>(self, mut a: A) -> Result<Buf, A::Error> {
        let mut v = Vec::with_capacity(a.size_hint().unwrap_or(0).min(4096));
        while let Some(x) = a.next_element()? {
            v.push(x);
        }
        Ok(Buf::Seq(v))
    }
    fn visit_map<A: MapAccess<'de>>(self, mut a: A) -> Result<Buf, A::Error> {
        let mut v = Vec::with_capacity(a.size_hint().unwrap_or(0).min(4096));
        while let Some(kv) = a.next_entry()? {
            v.push(kv);
        }
        Ok(Buf::Map(v))
    }
}

impl<'de> IntoDeserializer<'de, de::value::Error> for Buf {
    type Deserializer = Buf;
    fn into_deserializer(self) -> Buf {
        self
    }
}

impl<'de> Deserializer<'de> for Buf {
    type Error = de::value::Error;

    fn deserialize_any<V: Visitor<'de>>(self, v: V) -> Result<V::Value, Self::Error> {
        match self {
            Buf::Unit => v.visit_unit(),
            Buf::Bool(b) => v.visit_bool(b),
            Buf::I64(n) => v.visit_i64(n),
            Buf::U64(n) => v.visit_u64(n),
            Buf::F64(n) => v.visit_f64(n),
            Buf::Str(s) => v.visit_string(s),
            Buf::Seq(x) => SeqDeserializer::new(x.into_iter()).deserialize_any(v),
            Buf::Map(m) => MapDeserializer::new(m.into_iter()).deserialize_any(v),
        }
    }

    fn deserialize_option<V: Visitor<'de>>(self, v: V) -> Result<V::Value, Self::Error> {
        match self {
            Buf::Unit => v.visit_none(),
            other => v.visit_some(other),
        }
    }

    fn deserialize_newtype_struct<V: Visitor<'de>>(
        self,
        _: &'static str,
        v: V,
    ) -> Result<V::Value, Self::Error> {
        v.visit_newtype_struct(self)
    }

    fn deserialize_enum<V: Visitor<'de>>(
        self,
        _: &'static str,
        _: &'static [&'static str],
        v: V,
    ) -> Result<V::Value, Self::Error> {
        match self {
            Buf::Str(s) => v.visit_enum(s.into_deserializer()),
            Buf::Map(m) if m.len() == 1 => v.visit_enum(MapAccessDeserializer::new(
                MapDeserializer::new(m.into_iter()),
            )),
            _ => Err(de::Error::custom("expected an enum")),
        }
    }

    serde::forward_to_deserialize_any! {
        bool i8 i16 i32 i64 i128 u8 u16 u32 u64 u128 f32 f64 char str string bytes byte_buf unit unit_struct
        seq tuple tuple_struct map struct identifier ignored_any
    }
}

#[cfg(test)]
mod tests {
    use super::{CheckpointError, CHECKPOINT_FORMAT};
    use crate::arenas::practice_arena;
    use crate::content::FactionId;
    use crate::math::Vec2;
    use crate::sim::{Event, Placement, PlayerId, Secrets, Sim, SimConfig};

    fn sim() -> Sim {
        let ps = [
            Placement {
                profile: "a".into(),
                faction: FactionId::Holy,
                bot: false,
                at: Vec2::new(200.0, 200.0),
                hp: None,
            },
            Placement {
                profile: "b".into(),
                faction: FactionId::Fire,
                bot: false,
                at: Vec2::new(600.0, 600.0),
                hp: None,
            },
            Placement {
                profile: "c".into(),
                faction: FactionId::Frost,
                bot: false,
                at: Vec2::new(900.0, 300.0),
                hp: None,
            },
        ];
        Sim::reset_active(
            SimConfig::default(),
            practice_arena(),
            Secrets::from_seed(5),
            &ps,
        )
    }

    #[test]
    fn a_checkpoint_keeps_results_emitted_between_steps() {
        let mut a = sim();
        a.step();
        a.remove_player(PlayerId(3)); // a leave between steps: its MIA result waits for the next step
        let mut b: Sim = serde_json::from_str(&serde_json::to_string(&a).unwrap()).unwrap();
        assert_eq!(a.state_hash(), b.state_hash());
        let (ea, eb) = (a.step(), b.step());
        let resolved = |e: &Vec<Event>| {
            e.iter()
                .filter(|e| matches!(e, Event::Resolved { .. }))
                .count()
        };
        assert_eq!(resolved(&ea), 1);
        assert_eq!(
            resolved(&eb),
            1,
            "the restored sim still delivers the leave's result"
        );
        assert_eq!(a.state_hash(), b.state_hash());
    }

    #[test]
    fn a_checkpoint_is_tagged_and_restores_complete() {
        let mut a = sim();
        for _ in 0..30 {
            a.step();
        }
        let json = serde_json::to_value(&a).unwrap();
        assert_eq!(json["format"], CHECKPOINT_FORMAT);
        assert!(json["statics"].is_object() && json["world"].is_object());
        // The tag leads the document, so a stale layout is refused before its payload is parsed.
        assert!(serde_json::to_string(&a)
            .unwrap()
            .starts_with(&format!("{{\"format\":\"{CHECKPOINT_FORMAT}\"")));
        let mut b = Sim::restore(&json).expect("restores");
        assert_eq!(a.state_hash(), b.state_hash());
        for _ in 0..60 {
            a.step();
            b.step();
        }
        assert_eq!(a.state_hash(), b.state_hash());
    }

    #[test]
    fn a_mismatched_format_tag_is_refused_with_a_typed_error() {
        let mut json = serde_json::to_value(sim()).unwrap();
        json["format"] = "rh-checkpoint/0".into();
        assert_eq!(
            Sim::restore(&json).err(),
            Some(CheckpointError::UnsupportedFormat {
                found: "rh-checkpoint/0".into()
            })
        );
        // Through plain serde the same refusal arrives as the error message.
        let err = serde_json::from_value::<Sim>(json).unwrap_err().to_string();
        assert!(err.contains("unsupported checkpoint format"), "{err}");
        // The previous layout (no roster, String winners) is refused by its tag, not as a serde error.
        let mut old = serde_json::to_value(sim()).unwrap();
        old["format"] = "rh-checkpoint/1".into();
        assert_eq!(
            Sim::restore(&old).err(),
            Some(CheckpointError::UnsupportedFormat {
                found: "rh-checkpoint/1".into()
            })
        );
        // The layout before the fighter components (flat player records) is refused by its tag too, and a payload that
        // still carries the old nesting under the new tag is malformed, not a silently wrong state.
        let mut flat = serde_json::to_value(sim()).unwrap();
        flat["format"] = "rh-checkpoint/2".into();
        assert_eq!(
            Sim::restore(&flat).err(),
            Some(CheckpointError::UnsupportedFormat {
                found: "rh-checkpoint/2".into()
            })
        );
        let mut retagged = serde_json::to_value(sim()).unwrap();
        retagged["world"]["players"] = serde_json::json!([{"id": 1, "x": 0.0, "hp": 1.0}]);
        assert!(matches!(
            Sim::restore(&retagged),
            Err(CheckpointError::Malformed(_))
        ));
        // A payload of another layout is still refused by its tag, whatever it holds.
        let alien = serde_json::json!({"format": "rh-checkpoint/9", "statics": 1, "world": [2]});
        assert!(matches!(
            Sim::restore(&alien),
            Err(CheckpointError::UnsupportedFormat { .. })
        ));
    }

    #[test]
    fn a_missing_format_tag_is_refused_with_a_typed_error() {
        let mut json = serde_json::to_value(sim()).unwrap();
        json.as_object_mut().unwrap().remove("format");
        assert_eq!(
            Sim::restore(&json).err(),
            Some(CheckpointError::MissingFormat)
        );
        // The pre-tag layout (a flat Sim) has no tag either.
        let flat = serde_json::json!({"config": {}, "tick": 3});
        assert_eq!(
            Sim::restore(&flat).err(),
            Some(CheckpointError::MissingFormat)
        );
        let err = serde_json::from_value::<Sim>(flat).unwrap_err().to_string();
        assert!(err.contains("no format tag"), "{err}");
    }

    #[test]
    fn a_tagged_checkpoint_without_its_parts_is_malformed() {
        let json = serde_json::json!({"format": CHECKPOINT_FORMAT, "world": {}});
        assert!(matches!(
            Sim::restore(&json),
            Err(CheckpointError::Malformed(_))
        ));
        let mut json = serde_json::to_value(sim()).unwrap();
        json["world"] = serde_json::json!({"tick": "soon"});
        assert!(matches!(
            Sim::restore(&json),
            Err(CheckpointError::Malformed(_))
        ));
    }

    /// Restores `json` and returns why it was refused.
    fn refusal(json: &serde_json::Value) -> String {
        match Sim::restore(json) {
            Err(CheckpointError::Malformed(why)) => why,
            Err(e) => panic!("expected Malformed, got {e}"),
            Ok(_) => panic!("the checkpoint was accepted"),
        }
    }

    fn stepped(n: usize) -> serde_json::Value {
        let mut a = sim();
        for _ in 0..n {
            a.step();
        }
        serde_json::to_value(&a).unwrap()
    }

    #[test]
    fn a_stale_next_id_is_refused() {
        let mut json = stepped(5);
        json["world"]["next_id"] = 3.into(); // players 1..=3 are seated
        assert!(refusal(&json).contains("next_id"));
        // A leaver stays in the roster: its id is not free either.
        let mut json = stepped(5);
        json["world"]["players"].as_array_mut().unwrap().pop();
        json["world"]["next_id"] = 3.into();
        assert!(refusal(&json).contains("next_id"));
        json["world"]["next_id"] = 4.into();
        assert!(Sim::restore(&json).is_ok());
    }

    #[test]
    fn a_roster_out_of_order_is_refused() {
        let mut json = stepped(5);
        json["world"]["roster"]["names"]
            .as_array_mut()
            .unwrap()
            .swap(0, 1);
        assert!(refusal(&json).contains("ascending"));
        let mut json = stepped(5);
        let names = json["world"]["roster"]["names"].as_array_mut().unwrap();
        names[1] = names[0].clone();
        assert!(refusal(&json).contains("ascending"));
    }

    #[test]
    fn a_non_finite_clock_is_refused() {
        // JSON cannot carry NaN or infinity, but another serde format can: check the decoded state itself.
        for bad in [f64::NAN, f64::INFINITY, f64::NEG_INFINITY] {
            let mut a = sim();
            a.w.server_time = bad;
            assert!(super::check_world(&a.w).is_err(), "{bad}");
        }
        let mut a = sim();
        assert!(super::check_world(&a.w).is_ok());
        a.w.server_time = 1e300; // finite but absurd: the history rule below catches what it would leave behind
        assert!(super::check_world(&a.w).is_ok());
    }

    #[test]
    fn a_tick_counter_at_its_maximum_is_refused() {
        let mut json = stepped(5);
        json["world"]["tick"] = u32::MAX.into();
        assert!(refusal(&json).contains("tick"));
        json["world"]["tick"] = (u32::MAX - 1).into();
        assert!(Sim::restore(&json).is_ok());
    }

    #[test]
    fn a_rewind_history_out_of_time_order_is_refused() {
        let mut json = stepped(5);
        json["world"]["players"][0]["core"]["body"]["history"]
            .as_array_mut()
            .unwrap()
            .swap(0, 1);
        assert!(refusal(&json).contains("time order"));
    }

    #[test]
    fn a_rewind_history_dated_after_the_clock_is_refused() {
        let mut json = stepped(5);
        let h = json["world"]["players"][1]["core"]["body"]["history"]
            .as_array_mut()
            .unwrap();
        let last = h.len() - 1;
        h[last]["t"] = 1e12.into();
        assert!(refusal(&json).contains("server_time"));
        // And a whole history in the far future (the ring would fill and panic) is refused the same way.
        let mut json = stepped(5);
        for s in json["world"]["players"][0]["core"]["body"]["history"]
            .as_array_mut()
            .unwrap()
        {
            s["t"] = (1e12 + s["t"].as_f64().unwrap()).into();
        }
        assert!(refusal(&json).contains("server_time"));
    }

    #[test]
    fn a_carried_ranged_weapon_is_refused() {
        for item in ["Bow", "Wand", "Sword"] {
            let mut json = stepped(5);
            json["world"]["players"][2]["core"]["weapon"]["weapon1"] = item.into();
            assert!(refusal(&json).contains("carries"), "{item}");
        }
        let mut json = stepped(5);
        json["world"]["players"][2]["core"]["weapon"]["weapon0"] = "Fists".into();
        assert!(Sim::restore(&json).is_ok());
    }

    /// Every node of a JSON document, as a path of keys and indices.
    fn paths(v: &serde_json::Value, at: &mut Vec<String>, out: &mut Vec<Vec<String>>) {
        out.push(at.clone());
        match v {
            serde_json::Value::Array(a) => {
                for (i, x) in a.iter().enumerate() {
                    at.push(i.to_string());
                    paths(x, at, out);
                    at.pop();
                }
            }
            serde_json::Value::Object(o) => {
                for (k, x) in o {
                    at.push(k.clone());
                    paths(x, at, out);
                    at.pop();
                }
            }
            _ => {}
        }
    }

    fn node<'a>(v: &'a mut serde_json::Value, at: &[String]) -> &'a mut serde_json::Value {
        let mut cur = v;
        for k in at {
            cur = match cur {
                serde_json::Value::Array(a) => &mut a[k.parse::<usize>().unwrap()],
                serde_json::Value::Object(o) => o.get_mut(k).unwrap(),
                _ => unreachable!(),
            };
        }
        cur
    }

    /// Whatever a damaged checkpoint holds, restoring it either fails with an error or yields a match that steps: the
    /// tick's own asserts are never the first to notice.
    #[test]
    fn mutated_checkpoints_never_panic_on_restore_or_the_steps_after() {
        use crate::rng::Mulberry32;
        let base = stepped(40);
        let mut all = Vec::new();
        paths(&base["world"], &mut vec!["world".into()], &mut all);
        let pick: [serde_json::Value; 10] = [
            0.into(),
            1.into(),
            (-1).into(),
            3.into(),
            1e12.into(),
            1e300.into(),
            u32::MAX.into(),
            serde_json::Value::Null,
            "Bow".into(),
            true.into(),
        ];
        let mut rng = Mulberry32::new(0xC0FFEE);
        let (mut refused, mut stepped_ok) = (0, 0);
        for _ in 0..400 {
            let mut json = base.clone();
            for _ in 0..1 + rng.next_u32() % 3 {
                let at = &all[rng.next_u32() as usize % all.len()];
                // The path may point into a node an earlier mutation replaced; skip what no longer resolves.
                let ok = at.iter().try_fold(&json, |cur, k| match cur {
                    serde_json::Value::Array(a) => a.get(k.parse::<usize>().ok()?),
                    serde_json::Value::Object(o) => o.get(k),
                    _ => None,
                });
                if ok.is_none() {
                    continue;
                }
                let target = node(&mut json, at);
                match rng.next_u32() % 4 {
                    0 if target.is_array() => {
                        let a = target.as_array_mut().unwrap();
                        if a.len() >= 2 {
                            let n = a.len();
                            a.swap(0, n - 1);
                        }
                    }
                    1 if target.is_array() => {
                        target.as_array_mut().unwrap().pop();
                    }
                    _ => *target = pick[rng.next_u32() as usize % pick.len()].clone(),
                }
            }
            match Sim::restore(&json) {
                Err(_) => refused += 1,
                Ok(mut sim) => {
                    for _ in 0..20 {
                        sim.step();
                    }
                    stepped_ok += 1;
                }
            }
        }
        assert!(refused > 50 && stepped_ok > 5, "{refused} {stepped_ok}");
    }
}
