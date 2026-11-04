//! Checkpoints: `{format, statics, world}` as JSON (or any serde format). The format tag is written first and checked
//! first on restore, so a checkpoint of another layout (or none at all) fails with a typed [`CheckpointError`] instead of an
//! arbitrary serde error or a silently wrong state. Per-tick scratch is never part of a checkpoint: a restored [`Sim`] starts
//! with an empty [`TickScratch`] and behaves identically (docs/CONTRACTS.md C-DET).

use crate::pathfind::Pathfinder;
use crate::scratch::TickScratch;
use crate::sim::Sim;
use crate::state::World;
use crate::statics::MatchStatic;
use serde::de::{self, Deserializer, IgnoredAny, MapAccess, Visitor};
use serde::ser::{SerializeStruct, Serializer};
use std::fmt;
use std::sync::Arc;

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
    /// Restores the derived tables after deserializing a checkpoint. Deserializing a [`Sim`] already does this; the method
    /// stays for callers that still call it. Idempotent.
    pub fn after_restore(&mut self) {
        // A freshly deserialized arena is not shared, so this rebuilds in place (it clones only a shared one).
        Arc::make_mut(&mut self.k.arena).map.rebuild();
        self.s = TickScratch::default();
        self.pf = Pathfinder::default();
    }

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
        let (mut tagged, mut statics, mut world) = (false, None::<MatchStatic>, None::<World>);
        while let Some(key) = map.next_key::<Key>()? {
            match key {
                Key::Format => {
                    let found: String = map.next_value()?;
                    if found != CHECKPOINT_FORMAT {
                        return Err(self.refuse(CheckpointError::UnsupportedFormat { found }));
                    }
                    tagged = true;
                }
                Key::Statics => statics = Some(map.next_value()?),
                Key::World => world = Some(map.next_value()?),
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
        let mut sim = Sim {
            k,
            w,
            s: TickScratch::default(),
            pf: Pathfinder::default(),
        };
        sim.after_restore();
        Ok(sim)
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
        b.after_restore();
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
    fn a_checkpoint_is_tagged_and_restores_without_after_restore() {
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
}
