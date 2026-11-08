//! Native publication leaves against immutable source witness70a6790c. This is not full perceive,
//! schema change-tree, continuous-bar rendering, NPC-kind, or source-admission proof.
use rh_sim::{observe::Observation, FactionId, Placement, PlayerId, Secrets, Sim, SimConfig, Vec2};
use serde::de::{self, IntoDeserializer, Visitor};
use serde::Deserializer;
use serde_json::Value;

fn corpus(name: &str) -> Value {
    let text = match name {
        "owner" => include_str!("../../../parity/barrier-view/owner-fighter.json"),
        "ring" => include_str!("../../../parity/barrier-view/human-ring.json"),
        "schema" => include_str!("../../../parity/barrier-view/schema-f32.json"),
        "visibility" => include_str!("../../../parity/barrier-view/visibility.json"),
        "npc" => include_str!("../../../parity/barrier-view/npc-forms.json"),
        "continuous" => include_str!("../../../parity/barrier-view/continuous-bars.json"),
        _ => panic!("unknown corpus"),
    };
    let result: Value = serde_json::from_str(text).unwrap();
    assert_eq!(result["format"], "rh-barrier-view-witness/1");
    assert_eq!(tagged(&result["profile"]["constants"]["HP_QUANT"]), 0.05);
    result
}
fn tagged(value: &Value) -> f64 {
    if let Some(bits) = value["f64"].as_str() {
        f64::from_bits(u64::from_str_radix(bits, 16).unwrap())
    } else {
        match value["tag"].as_str().unwrap() {
            "NaN" => f64::NAN,
            "+Inf" => f64::INFINITY,
            "-Inf" => f64::NEG_INFINITY,
            _ => panic!("missing captured finite bits: {value}"),
        }
    }
}
fn same_bits(actual: f64, expected: &Value, context: &str) {
    assert_eq!(actual.to_bits(), tagged(expected).to_bits(), "{context}");
}
fn input(row: &Value) -> [f64; 3] {
    [
        tagged(&row["hp"]),
        tagged(&row["maxHp"]),
        tagged(&row["barrier"]),
    ]
}

// A test-only serde adapter injects captured IEEE nonfinite values through the REAL restore API.
// JSON cannot represent them. These strings exist only in this declared input, never in an
// Observation or production serializer. No private mutation/test API is added.
struct SceneValue(Value);
impl<'de> IntoDeserializer<'de, serde_json::Error> for SceneValue {
    type Deserializer = Self;
    fn into_deserializer(self) -> Self {
        self
    }
}
impl<'de> Deserializer<'de> for SceneValue {
    type Error = serde_json::Error;
    fn deserialize_any<V: Visitor<'de>>(self, visitor: V) -> Result<V::Value, Self::Error> {
        match self.0 {
            Value::Array(rows) => visitor.visit_seq(de::value::SeqDeserializer::new(
                rows.into_iter().map(SceneValue),
            )),
            Value::Object(rows) => visitor.visit_map(de::value::MapDeserializer::new(
                rows.into_iter().map(|(k, v)| (k, SceneValue(v))),
            )),
            scalar => scalar.into_deserializer().deserialize_any(visitor),
        }
    }
    fn deserialize_f64<V: Visitor<'de>>(self, visitor: V) -> Result<V::Value, Self::Error> {
        if let Some(bits) = self
            .0
            .as_str()
            .and_then(|s| s.strip_prefix("captured-ieee:"))
        {
            let bits = u64::from_str_radix(bits, 16).map_err(de::Error::custom)?;
            visitor.visit_f64(f64::from_bits(bits))
        } else {
            self.deserialize_any(visitor)
        }
    }
    fn deserialize_f32<V: Visitor<'de>>(self, visitor: V) -> Result<V::Value, Self::Error> {
        self.deserialize_f64(visitor)
    }
    fn deserialize_option<V: Visitor<'de>>(self, visitor: V) -> Result<V::Value, Self::Error> {
        if self.0.is_null() {
            visitor.visit_none()
        } else {
            visitor.visit_some(self)
        }
    }
    fn deserialize_newtype_struct<V: Visitor<'de>>(
        self,
        _: &'static str,
        visitor: V,
    ) -> Result<V::Value, Self::Error> {
        visitor.visit_newtype_struct(self)
    }
    fn deserialize_enum<V: Visitor<'de>>(
        self,
        name: &'static str,
        variants: &'static [&'static str],
        visitor: V,
    ) -> Result<V::Value, Self::Error> {
        // Injected values occur only in Vitals numeric fields, never an enum payload.
        self.0
            .into_deserializer()
            .deserialize_enum(name, variants, visitor)
    }
    serde::forward_to_deserialize_any! {
        bool i8 i16 i32 i64 i128 u8 u16 u32 u64 u128 char str string bytes byte_buf unit unit_struct
        seq tuple tuple_struct map struct identifier ignored_any
    }
}
fn scalar(value: f64) -> Value {
    serde_json::Number::from_f64(value)
        .map(Value::Number)
        .unwrap_or_else(|| Value::String(format!("captured-ieee:{:016x}", value.to_bits())))
}
fn scene(owner: [f64; 3], actor: [f64; 3], hidden: bool) -> Result<Sim, String> {
    let mut arena = rh_sim::arenas::practice_arena();
    arena.spawns = vec![Vec2::new(100., 176.)];
    let placements = [
        ("owner", 100.),
        ("fighter", if hidden { 300. } else { 150. }),
    ]
    .into_iter()
    .map(|(profile, x)| Placement {
        profile: profile.into(),
        faction: FactionId::Holy,
        bot: false,
        at: Vec2::new(x, 176.),
        hp: None,
        weapon0: None,
        weapon1: None,
    })
    .collect::<Vec<_>>();
    let sim = Sim::reset_active(
        SimConfig {
            consumables: false,
            ..Default::default()
        },
        arena,
        Secrets::from_seed(5),
        &placements,
    );
    let mut checkpoint = serde_json::to_value(&sim).unwrap();
    for (row, values) in checkpoint["world"]["players"]
        .as_array_mut()
        .unwrap()
        .iter_mut()
        .zip([owner, actor])
    {
        for (key, value) in ["hp", "max_hp", "barrier"].into_iter().zip(values) {
            row["core"]["vitals"][key] = scalar(value);
        }
    }
    let sim = Sim::restore(SceneValue(checkpoint)).map_err(|e| e.to_string())?;
    for (p, values) in sim.players().iter().zip([owner, actor]) {
        for (actual, expected) in [p.vitals.hp, p.vitals.max_hp, p.vitals.barrier]
            .into_iter()
            .zip(values)
        {
            if expected.is_nan() {
                assert!(actual.is_nan());
            } else {
                assert_eq!(
                    actual.to_bits(),
                    expected.to_bits(),
                    "declared checkpoint input is actually applied"
                );
            }
        }
    }
    Ok(sim)
}
fn observed(values: [f64; 3]) -> Result<Observation, String> {
    let sim = scene(values, values, false)?;
    rh_sim::try_observe(&sim, PlayerId(1), &[]).map_err(|e| format!("{e:?}"))
}

#[test]
fn actual_perceive_owner_and_fighter_leaves_match_in_the_native_publication_domain() {
    let source = corpus("owner");
    let mut accepted = 0;
    let mut refused = 0;
    for row in source["cases"].as_array().unwrap() {
        let name = row["name"].as_str().unwrap();
        let native = observed(input(&row["declared"]["owner"]));
        if matches!(
            name,
            "above-f32-max" | "negative-minus-one" | "negative-minus-half" | "negative-underflow"
        ) {
            assert!(
                native.is_err(),
                "deliberately narrower native domain: {name}"
            );
            refused += 1;
        } else {
            let native = native.unwrap_or_else(|e| panic!("{name}: {e}"));
            let me = native.me.unwrap();
            same_bits(me.barrier, &row["actual"]["selfBarrier"], name);
            same_bits(me.hp, &row["f32Inputs"]["hp"], name);
            same_bits(me.max_hp, &row["f32Inputs"]["maxHp"], name);
            let actor = native.visible.iter().find(|a| a.id == PlayerId(2)).unwrap();
            same_bits(actor.hp_frac, &row["actual"]["fighter"]["hpFrac"], name);
            same_bits(
                actor.barrier_frac,
                &row["actual"]["fighter"]["barrierFrac"],
                name,
            );
            accepted += 1;
        }
    }
    assert_eq!((accepted, refused), (17, 4));
}

#[test]
fn actual_schema_decoded_barrier_bits_match_without_copying_change_tree_semantics() {
    let source = corpus("schema");
    let mut accepted = 0;
    let mut refused = 0;
    for row in source["cases"].as_array().unwrap() {
        let name = row["name"].as_str().unwrap();
        // The host's ACTUAL post-assignment field is the input, not the last requested assignment.
        // Fresh -0 assignment stays +0; nonzero -> -0 and later +0 preserve the source host -0.
        let native = observed([100., 100., tagged(&row["host"]["afterAssignments"])]);
        if matches!(
            name,
            "above-f32-max" | "nan" | "plus-infinity" | "minus-infinity"
        ) {
            assert!(native.is_err(), "non-admitted source diagnostic: {name}");
            refused += 1;
        } else {
            same_bits(
                native.unwrap().me.unwrap().barrier,
                &row["wire"]["decoded"],
                name,
            );
            accepted += 1;
        }
    }
    assert_eq!((accepted, refused), (12, 4));
}

#[test]
fn actual_human_ring_normalized_and_original_f64_maximum_probes_match() {
    let source = corpus("ring");
    let mut count = 0;
    for table in ["normalized", "schemaF32BarrierF64MaxHp"] {
        for row in source[table]["probes"].as_array().unwrap() {
            let max = if table == "normalized" {
                &row["maxHp"]
            } else {
                &row["maxHpF64"]
            };
            let obs = observed([100., tagged(max), tagged(&row["declaredBarrier"])]).unwrap();
            let expected = row["stepAfter"].as_u64().unwrap() as u8;
            assert_eq!(
                obs.me.unwrap().barrier_ring_step,
                expected,
                "{}",
                row["label"]
            );
            assert_eq!(
                obs.visible[0].barrier_ring_step, expected,
                "{}",
                row["label"]
            );
            count += 1;
        }
    }
    assert_eq!(count, 20);
    // Arbitrary direct strengths/cache/draw-call traces are renderer evidence, not native facts.
    assert_eq!(source["mapping"]["probes"].as_array().unwrap().len(), 36);
    assert_eq!(
        source["schemaF32BarrierF64MaxHp"]["probes"][0]["stepAfter"],
        2
    );
    assert_eq!(
        source["schemaF32BarrierF64MaxHp"]["probes"][0]["diagnosticIfMaxHpFrounded"]["step"],
        3
    );
}

#[test]
fn actual_distinct_bar_and_ring_leaves_match_without_claiming_continuous_rendering() {
    let source = corpus("visibility");
    let rows = source["distinctness"]["cases"].as_array().unwrap();
    assert_eq!(rows.len(), 6);
    for row in rows {
        let obs = observed(input(&row["declared"])).unwrap();
        same_bits(
            obs.visible[0].hp_frac,
            &row["botTwentieths"]["hpFrac"],
            row["name"].as_str().unwrap(),
        );
        same_bits(
            obs.visible[0].barrier_frac,
            &row["botTwentieths"]["barrierFrac"],
            row["name"].as_str().unwrap(),
        );
        assert_eq!(
            f64::from(obs.visible[0].barrier_ring_step),
            tagged(&row["ring"]["step"])
        );
    }
    let continuous = corpus("continuous");
    assert_eq!(continuous["cases"].as_array().unwrap().len(), 20);
    assert_eq!(
        continuous["diagnostics"]["cases"].as_array().unwrap().len(),
        13
    );
    assert_eq!(continuous["diagnostics"]["finiteShorthandApplied"], false);
    // There is no native continuous-bar/text leaf. Those values are deliberately not relabelled
    // as native quantized output, nor are their diagnostics new restore/admission rules.
}

#[test]
fn source_npc_absence_and_hidden_invalid_barriers_remain_explicitly_narrow() {
    let npc = corpus("npc");
    assert_eq!(npc["supported"]["frameMobCount"], 5);
    assert_eq!(npc["unsupported"]["mobStateHasBarrierField"], false);
    for row in npc["supported"]["frameMobs"].as_array().unwrap() {
        assert_eq!(row["hasBarrierLeaf"], false);
        assert_eq!(row["hasBarrierFracLeaf"], false);
    }
    assert_eq!(npc["strayBarrierControls"]["identicalWithHugeAndNaN"], true);
    let mut arena = rh_sim::arenas::practice_arena();
    arena.spawns = vec![Vec2::new(400., 320.)];
    let native = Sim::reset_active(
        SimConfig {
            training: true,
            dummies: true,
            consumables: false,
            ..Default::default()
        },
        arena,
        Secrets::from_seed(3),
        &[Placement {
            profile: "owner".into(),
            faction: FactionId::Holy,
            bot: false,
            at: Vec2::new(400., 320.),
            hp: None,
            weapon0: None,
            weapon1: None,
        }],
    );
    let seen = rh_sim::try_observe(&native, PlayerId(1), &[]).unwrap();
    let dummy = seen
        .visible
        .iter()
        .find(|v| v.kind == 3)
        .expect("actual training NPC is visible");
    let expected = npc["supported"]["frameMobs"]
        .as_array()
        .unwrap()
        .iter()
        .find(|r| r["kind"] == "dummy")
        .unwrap();
    same_bits(
        dummy.hp_frac,
        &expected["hpFrac"],
        "actual training dummy HP leaf",
    );
    assert_eq!((dummy.barrier_frac, dummy.barrier_ring_step), (0., 0));
    // This does not pretend the native roster implements every source NPC kind (e.g. quest).
    let source = corpus("visibility");
    assert_eq!(
        source["controls"]["hidden"]["sameFrameWhenHiddenBarrierIs1e39"],
        true
    );
    assert_eq!(
        source["controls"]["outOfFrame"]["sameFrameWhenFarBarrierIs1e39"],
        true
    );
    // Explicit mapping: source hidden/out-of-frame withholding -> existing native pillar occlusion.
    // No source window/effect/identity equivalence is claimed by this numeric-leaf consumer.
    let normal = scene([100., 100., 75.], [100., 100., 75.], true).unwrap();
    let bad = scene([100., 100., 75.], [100., 100., 1e39], true).unwrap();
    let normal = rh_sim::try_observe(&normal, PlayerId(1), &[]).unwrap();
    let bad = rh_sim::try_observe(&bad, PlayerId(1), &[]).unwrap();
    assert_eq!(normal, bad);
    same_bits(
        normal.me.unwrap().barrier,
        &source["controls"]["visible"]["selfBarrier"],
        "owner still delivered",
    );
}
