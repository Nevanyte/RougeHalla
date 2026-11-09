//! Source-based live reset stream control: the source brain constructor uses independent mulberry32 streams
//! derive(cfg.seed, 0/1/2) for decide/motor/lapse and derive(cfg.seed, 3) for Knowledge. The expected seed values come
//! from the existing immutable source vector file; expected draws use the already source-proved native Rng, not a new
//! reset formula.
use super::*;
use rh_sim::constants::TICK_MS;
use serde_json::Value as V;

fn source_vectors() -> V {
    serde_json::from_str(include_str!(
        "../../../../../parity/policy/bot-knowledge-repair.json"
    ))
    .unwrap()
}

fn start(seed: u64) -> MatchStart {
    MatchStart {
        me: PlayerId(1),
        seed,
        arena: std::sync::Arc::new(rh_sim::arenas::practice_arena()),
        content_hash: rh_sim::content::content_hash(),
        observation_version: rh_sim::OBSERVATION_VERSION,
        tick_ms: TICK_MS,
    }
}

fn source_seed(vectors: &V, seed: u32, tag: u32) -> u32 {
    vectors["tagVectors"]
        .as_array()
        .unwrap()
        .iter()
        .find(|v| v["seed"] == seed && v["tag"] == tag)
        .unwrap_or_else(|| panic!("source tag vector missing for seed {seed} tag {tag}"))
        ["expected"]
        .as_u64()
        .unwrap() as u32
}

fn reset_bot(seed: u64) -> HumanBot {
    let mut bot = HumanBot::new(TierId::Normal, PersonaId::Farmer);
    bot.reset(&start(seed));
    bot
}

fn stream(bot: &HumanBot, tag: u32) -> &Rng {
    match tag {
        0 => &bot.decide,
        1 => &bot.motor,
        2 => &bot.lapse,
        other => panic!("not a decision/motor/lapse tag {other}"),
    }
}

fn stream_mut(bot: &mut HumanBot, tag: u32) -> &mut Rng {
    match tag {
        0 => &mut bot.decide,
        1 => &mut bot.motor,
        2 => &mut bot.lapse,
        other => panic!("not a decision/motor/lapse tag {other}"),
    }
}

#[test]
fn source_vectors_cover_the_four_stream_tags() {
    let vectors = source_vectors();
    assert_eq!(vectors["tagVectors"].as_array().unwrap().len(), 16);
    for row in vectors["tagVectors"].as_array().unwrap() {
        let seed = row["seed"].as_u64().unwrap() as u32;
        let tag = row["tag"].as_u64().unwrap() as u32;
        let expected = row["expected"].as_u64().unwrap() as u32;
        assert_eq!(
            derive(seed, tag),
            expected,
            "source derive seed {seed} tag {tag}"
        );
    }
}

#[test]
fn live_reset_installs_the_source_tag_streams_and_first_draws() {
    let vectors = source_vectors();
    for seed in [0u32, 1, 7, 42] {
        for tag in 0..3 {
            let mut bot = reset_bot(u64::from(seed));
            let expected = source_seed(&vectors, seed, tag);
            assert_eq!(
                stream(&bot, tag),
                &Rng::new(expected),
                "seed {seed} tag {tag}: live reset stream seed"
            );
            let mut expected_rng = Rng::new(expected);
            assert_eq!(
                stream_mut(&mut bot, tag).next_f64().to_bits(),
                expected_rng.next_f64().to_bits(),
                "seed {seed} tag {tag}: first draw"
            );
            for _ in 0..4 {
                assert_eq!(
                    stream_mut(&mut bot, tag).next_f64().to_bits(),
                    expected_rng.next_f64().to_bits(),
                    "seed {seed} tag {tag}: later draw"
                );
            }
        }
    }
}

#[test]
fn live_reset_keeps_knowledge_on_independent_tag3_and_does_not_consume_streams() {
    let vectors = source_vectors();
    for seed in [0u32, 1, 7, 42] {
        let mut bot = reset_bot(u64::from(seed));
        let expected_knowledge = Knowledge::create(
            TierParams::by_id(TierId::Normal),
            &mut Rng::new(source_seed(&vectors, seed, 3)),
        );
        assert_eq!(bot.knowledge(), Some(&expected_knowledge));
        // Reset must not draw from the decision/motor/lapse streams: their first draw is the source stream's first.
        for tag in 0..3 {
            let mut direct = Rng::new(source_seed(&vectors, seed, tag));
            assert_eq!(
                stream_mut(&mut bot, tag).next_f64().to_bits(),
                direct.next_f64().to_bits()
            );
        }
    }
}

#[test]
fn live_reset_is_cross_seat_deterministic_and_uses_low32_seed_domain() {
    let low = 0u64;
    let high = 0x1_0000_0000u64;
    let mut a = reset_bot(low);
    let b = reset_bot(high);
    let c = reset_bot(low);
    for tag in 0..3 {
        assert_eq!(stream(&a, tag), stream(&b, tag), "low32 domain tag {tag}");
        assert_eq!(stream(&a, tag), stream(&c, tag), "cross-seat tag {tag}");
        let mut expected = Rng::new(source_seed(&source_vectors(), 0, tag));
        assert_eq!(
            stream_mut(&mut a, tag).next_f64().to_bits(),
            expected.next_f64().to_bits(),
            "source first draw for tag {tag}"
        );
    }
    assert_eq!(a.knowledge(), b.knowledge(), "low32 Knowledge domain");
    assert_eq!(a.knowledge(), c.knowledge(), "cross-seat Knowledge");
    // Resetting an already-used bot restores the same source streams; it does not carry prior draws.
    for tag in 0..3 {
        let _ = stream_mut(&mut a, tag).next_f64();
        let _ = stream_mut(&mut a, tag).next_f64();
    }
    a.reset(&start(low));
    for tag in 0..3 {
        assert_eq!(stream(&a, tag), stream(&c, tag), "reset restores tag {tag}");
    }
}
