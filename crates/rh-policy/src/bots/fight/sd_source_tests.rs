//! Actual source Tactics/Retreat SD outcomes. Helpers share only input parsing/output comparison.
use super::*;

const SD_SOURCE: &str = include_str!("../../../../../parity/policy/bot-sd/source.json");
fn sd_fixture() -> Value {
    assert_eq!(SD_SOURCE.len(), 418550);
    let f: Value = serde_json::from_str(SD_SOURCE).unwrap();
    assert_eq!(f["format"], "rh-bot-sd-source/1");
    assert_eq!(f["profile"]["node"], "v22.23.4");
    f
}
#[test]
fn actual_source_sd_all_eight_sequences_and_46_frames() {
    let f = sd_fixture();
    let cases = f["cases"].as_array().unwrap();
    assert_eq!(cases.len(), 8);
    let mut count = 0;
    for case in cases {
        let r = &case["recipe"];
        let seed = r["seed"].as_u64().unwrap() as u32;
        let tier = tier(&r["tier"]);
        let persona = persona(&r["persona"]);
        let mut decide = Rng::new(derive(seed, 0));
        let motor = Rng::new(derive(seed, 1));
        let lapse = Rng::new(derive(seed, 2));
        let mut k = Rng::new(derive(seed, 3));
        let know = Knowledge::create(tier, &mut k);
        let mut paths = paths(&f, r["map"].as_str().unwrap());
        let mut tactics = NormalTactics::new(Epoch(1), player("p0"), tier.id);
        for row in case["rows"].as_array().unwrap() {
            count += 1;
            let p = &row["input"]["percept"];
            assert!(p["mobs"].as_array().unwrap().is_empty());
            assert_eq!(
                row["normalReflex"],
                json!({"result":null,"holdUntil":0,"draws":0})
            );
            let me = owner(p);
            let players = seen(p);
            begin(&mut paths, p);
            let goal = &row["input"]["goal"];
            let goal = if goal["kind"] == "idle" {
                Goal::Idle
            } else {
                assert_eq!(goal["kind"], "fight");
                Goal::Fight(player(goal["target"].as_str().unwrap()))
            };
            let got = tactics
                .act(
                    frame(p, &me, &players),
                    goal,
                    Context {
                        tier,
                        persona,
                        know: &know,
                        paths: &mut paths,
                        decide: &mut decide,
                    },
                )
                .unwrap();
            compare(
                &output_value(&got),
                &row["result"],
                case["name"].as_str().unwrap(),
            );
            assert_eq!(
                tactics.kite_cycles(),
                row["stats"]["kiteCycles"].as_u64().unwrap()
            );
            for name in ["dodges", "jukes", "retreats", "mobTargets"] {
                assert_eq!(
                    row["stats"][name], 0,
                    "source scope is normal player SD, not flee/reflex"
                );
            }
            assert_eq!(
                tactics.memory.own_motion().unwrap().still_since.to_bits(),
                num(&row["sourceMemory"]["stillSince"]).to_bits()
            );
            path_state(row, &paths);
            rng(row, "decide", &decide, seed, 0);
            rng(row, "motor", &motor, seed, 1);
            rng(row, "lapse", &lapse, seed, 2);
            rng(row, "knowledge", &k, seed, 3);
        }
    }
    assert_eq!(count, 46);
}

#[test]
fn reached_sd_cache_and_held_state_refuse_bad_health_atomically_and_reset_completely() {
    let f = sd_fixture();
    let case = &f["cases"][3];
    let tier = tier(&case["recipe"]["tier"]);
    let persona = persona(&case["recipe"]["persona"]);
    let know = Knowledge::create(tier, &mut Rng::new(derive(0, 3)));
    let mut decide = Rng::new(derive(0, 0));
    let mut paths = paths(&f, "open");
    let mut tactics = NormalTactics::new(Epoch(1), player("p0"), tier.id);
    for row in case["rows"].as_array().unwrap().iter().take(4) {
        let p = &row["input"]["percept"];
        let me = owner(p);
        let players = seen(p);
        begin(&mut paths, p);
        let got = tactics
            .act(
                frame(p, &me, &players),
                Goal::Fight(player("p1")),
                Context {
                    tier,
                    persona,
                    know: &know,
                    paths: &mut paths,
                    decide: &mut decide,
                },
            )
            .unwrap();
        compare(
            &output_value(&got),
            &row["result"],
            "actual SD component state before invalid facts/reset",
        );
    }
    assert!(tactics.fight.sd_hold && tactics.fight.held);
    assert_ne!(tactics.fight.retreat, retreat::Retreat::default());
    let original = (
        tactics.memory.clone(),
        tactics.fight.clone(),
        tactics.knows_sudden_death,
        decide.clone(),
    );
    let p = &case["rows"][4]["input"]["percept"];
    for bad in 0..3 {
        let mut me = owner(p);
        let players = seen(p);
        if bad == 0 {
            me.hp = f64::NAN;
        }
        if bad == 1 {
            me.max_hp = f64::NAN;
        }
        let mut input = frame(p, &me, &players);
        if bad == 2 {
            input.sudden_death_at = f64::NAN;
        }
        assert_eq!(
            tactics.act(
                input,
                Goal::Fight(player("p1")),
                Context {
                    tier,
                    persona,
                    know: &know,
                    paths: &mut paths,
                    decide: &mut decide
                }
            ),
            Err(Refusal::InvalidFacts)
        );
        assert_eq!(
            (
                tactics.memory.clone(),
                tactics.fight.clone(),
                tactics.knows_sudden_death,
                decide.clone()
            ),
            original
        );
    }
    tactics.reset(Epoch(2), player("p0"), tier.id);
    assert_eq!(tactics.fight, Fight::default());
    assert!(tactics.memory.records().is_empty());
    assert_eq!(tactics.knows_sudden_death, None);
    assert_eq!(decide, original.3);
}
