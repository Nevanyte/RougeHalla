//! P-BOTS-7 remainder: the delay line against the pinned actual-source corpus (`parity/policy/bot-runtime.json`, captured
//! in the linux/amd64 Node 22.23.4 container from the unchanged BotManager's delivery entry point). Arrivals are compared
//! bit for bit (the source is float64 and the stream is the shared mulberry32).
use super::*;

fn corpus() -> serde_json::Value {
    let path = concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../parity/policy/bot-runtime.json"
    );
    serde_json::from_str(&std::fs::read_to_string(path).expect("bot-runtime corpus")).expect("json")
}

#[test]
fn the_delay_line_arrivals_are_the_actual_source_ones() {
    let doc = corpus();
    assert_eq!(doc["format"], "rh-bot-runtime-source/1");
    let cases = doc["delay"].as_array().unwrap();
    assert!(cases.len() >= 4);
    for case in cases {
        let name = case["name"].as_str().unwrap();
        let seed = case["seed"].as_u64().unwrap() as u32;
        let latency = case["latencyMs"].as_f64().unwrap();
        let jitter = case["jitterMs"].as_f64().unwrap();
        let mut line: DelayLine<u32> = DelayLine::new();
        let mut rng = DelayLine::<u32>::rng(seed);
        for (i, at) in case["ats"].as_array().unwrap().iter().enumerate() {
            let at = at.as_f64().unwrap();
            let arrival = line
                .enqueue(&mut rng, at, latency, jitter, i as u32)
                .expect("a command under the cap is accepted");
            let want = case["arrivals"][i]["arrival"].as_f64().unwrap();
            assert_eq!(arrival.to_bits(), want.to_bits(), "{name}: arrival {i}");
        }
        // The queue cap is the source's 256/4 split.
        let mut capped: DelayLine<u32> = DelayLine::new();
        let mut rng = DelayLine::<u32>::rng(seed);
        let mut accepted = 0;
        for i in 0..260 {
            if capped
                .enqueue(&mut rng, 1_000., latency, jitter, i)
                .is_some()
            {
                accepted += 1;
            }
        }
        assert_eq!(
            accepted,
            case["cap"]["accepted"].as_u64().unwrap() as usize,
            "{name}"
        );
        assert_eq!(
            260 - accepted,
            case["cap"]["refused"].as_u64().unwrap() as usize,
            "{name}"
        );
    }
}

#[test]
fn due_commands_leave_in_order_and_only_when_their_arrival_has_come() {
    let mut line: DelayLine<&'static str> = DelayLine::new();
    let mut rng = DelayLine::<&'static str>::rng(7);
    let a = line.enqueue(&mut rng, 0., 30., 8., "a").unwrap();
    let b = line.enqueue(&mut rng, 10., 30., 8., "b").unwrap();
    let mut out = Vec::new();
    line.pop_due((a - 1.).min(b - 1.), &mut out);
    assert!(out.is_empty(), "nothing is due before the first arrival");
    line.pop_due(a, &mut out);
    assert_eq!(out, ["a"], "the first command is due at its arrival");
    let c = line.enqueue(&mut rng, 200., 30., 8., "c").unwrap();
    line.pop_due(b, &mut out);
    assert_eq!(out, ["a", "b"], "in order, b not before its arrival");
    line.pop_due(c, &mut out);
    assert_eq!(out, ["a", "b", "c"]);
    assert!(line.is_empty());
}

#[test]
fn the_stream_is_the_manager_seed_mixed_with_the_line_tag() {
    // The manager uses mix(seed, 0) for fill decisions and mix(seed, 1) for the line; distinct tags give distinct streams.
    assert_ne!(
        super::super::random::mix(7, 0),
        super::super::random::mix(7, 1)
    );
    let mut a = DelayLine::<u32>::rng(7);
    let mut b = DelayLine::<u32>::rng(8);
    assert_ne!(a.next_u32(), b.next_u32());
}
