//! Code-only identity follow-up. The coordinator runs these through the final combined
//! aggregate; source associations reuse the immutable18 NPC timing kernel observations.
use rh_sim::content::{
    attack_interval, content_hash, content_hash_of_mirror_timing_words, mirror_timings,
    npc_timings, paced, visit_mirror_timing_content, FactionId, Timings, WeaponId, REGISTRY,
    STAGGER_WEAPONS,
};
use serde_json::Value;
use std::collections::BTreeSet;

fn actual() -> Vec<u64> {
    let mut words = Vec::new();
    visit_mirror_timing_content(|word| words.push(word));
    words
}
fn hash(words: &[u64]) -> u64 {
    content_hash_of_mirror_timing_words(REGISTRY, STAGGER_WEAPONS, words)
}
struct Cursor<'a> {
    words: &'a [u64],
    at: usize,
}
impl Cursor<'_> {
    fn word(&mut self) -> u64 {
        let value = self.words[self.at];
        self.at += 1;
        value
    }
    fn text(&mut self) -> String {
        let len = usize::try_from(self.word()).unwrap();
        let value = self.words[self.at..self.at + len]
            .iter()
            .map(|&word| u8::try_from(word).unwrap())
            .collect();
        self.at += len;
        String::from_utf8(value).unwrap()
    }
    fn tag(&mut self, expected: &str) {
        assert_eq!(self.text(), expected);
    }
}
#[derive(Clone, Copy, Debug)]
struct Row {
    start: usize,
    words: [u64; 9],
}
impl Row {
    fn npc(self) -> bool {
        assert!(self.words[0] <= 1);
        self.words[0] != 0
    }
    fn faction(self) -> FactionId {
        FactionId::from_code(u8::try_from(self.words[1]).unwrap()).unwrap()
    }
    fn weapon(self) -> WeaponId {
        WeaponId::from_code(u8::try_from(self.words[2]).unwrap()).unwrap()
    }
    fn as_mult(self) -> f64 {
        f64::from_bits(self.words[3])
    }
    fn windup_mult(self) -> f64 {
        f64::from_bits(self.words[4])
    }
    fn timing(self) -> Timings {
        assert!(self.words[8] <= 1);
        Timings {
            interval: f64::from_bits(self.words[5]),
            windup: f64::from_bits(self.words[6]),
            root: f64::from_bits(self.words[7]),
            ranged: self.words[8] != 0,
        }
    }
}
fn rows(words: &[u64]) -> Vec<Row> {
    let mut c = Cursor { words, at: 0 };
    c.tag("mirror-timing-probes/1");
    c.tag("factions");
    assert_eq!(c.word(), 5);
    for faction in FactionId::ALL {
        assert_eq!(c.word(), u64::from(faction.code()));
        c.tag(faction.as_str());
    }
    c.tag("weapons");
    assert_eq!(c.word(), 6);
    for weapon in WeaponId::ALL {
        assert_eq!(c.word(), u64::from(weapon.code()));
        c.tag(weapon.as_str());
    }
    c.tag("profiles");
    assert_eq!(c.word(), 2);
    assert_eq!(c.word(), 0);
    c.tag("player");
    assert_eq!(c.word(), 1);
    c.tag("npc");
    c.tag("inputs");
    assert_eq!(c.word(), 4);
    let inputs: [(f64, f64); 4] = [(1., 1.), (1.5, 0.5), (0.5, 1.5), (1., 1.5)];
    for (as_mult, windup_mult) in inputs {
        assert_eq!(c.word(), as_mult.to_bits());
        assert_eq!(c.word(), windup_mult.to_bits());
    }
    c.tag("row-keys");
    assert_eq!(c.word(), 9);
    for key in [
        "profile",
        "faction",
        "weapon",
        "asMult",
        "windupMult",
        "interval",
        "windup",
        "root",
        "ranged",
    ] {
        c.tag(key);
    }
    c.tag("rows");
    assert_eq!(c.word(), 240);
    let mut out = Vec::new();
    for faction in FactionId::ALL {
        for weapon in WeaponId::ALL {
            for npc in [false, true] {
                for (as_mult, windup_mult) in inputs {
                    let row = Row {
                        start: c.at,
                        words: c.words[c.at..c.at + 9].try_into().unwrap(),
                    };
                    c.at += 9;
                    assert_eq!(
                        (row.npc(), row.faction(), row.weapon()),
                        (npc, faction, weapon)
                    );
                    assert_eq!(
                        (row.as_mult().to_bits(), row.windup_mult().to_bits()),
                        (as_mult.to_bits(), windup_mult.to_bits())
                    );
                    out.push(row);
                }
            }
        }
    }
    assert_eq!(c.at, words.len(), "no unexamined trailing words");
    out
}
fn select(
    rows: &[Row],
    npc: bool,
    faction: FactionId,
    weapon: WeaponId,
    as_mult: f64,
    windup_mult: f64,
) -> Row {
    *rows
        .iter()
        .find(|row| {
            (row.npc(), row.faction(), row.weapon()) == (npc, faction, weapon)
                && row.as_mult().to_bits() == as_mult.to_bits()
                && row.windup_mult().to_bits() == windup_mult.to_bits()
        })
        .unwrap()
}

#[test]
fn actual_keys_all_240_rows_and_default_aggregate_are_connected() {
    let words = actual();
    let rows = rows(&words);
    assert_eq!(rows.len(), 240);
    let mut keys = BTreeSet::new();
    for row in rows {
        assert!(keys.insert((
            row.npc(),
            row.faction(),
            row.weapon(),
            row.as_mult().to_bits(),
            row.windup_mult().to_bits()
        )));
        let expected = mirror_timings(
            &paced(row.faction()),
            row.weapon(),
            row.as_mult(),
            row.windup_mult(),
            row.npc(),
        );
        let actual = row.timing();
        assert_eq!(
            (
                actual.interval.to_bits(),
                actual.windup.to_bits(),
                actual.root.to_bits(),
                actual.ranged
            ),
            (
                expected.interval.to_bits(),
                expected.windup.to_bits(),
                expected.root.to_bits(),
                expected.ranged
            )
        );
    }
    assert_eq!(
        hash(&words),
        content_hash(),
        "supplied actual words use the same real aggregate path"
    );
}

#[test]
fn every_emitted_word_changes_the_real_aggregate_identity() {
    let words = actual();
    let base = content_hash();
    assert_eq!(hash(&words), base);
    let mut candidate = words.clone();
    for (at, &word) in words.iter().enumerate() {
        candidate[at] = word ^ 1;
        assert_ne!(hash(&candidate), base, "unhashed actual timing word {at}");
        candidate[at] = word;
    }
}

#[test]
fn removal_order_and_profile_keys_change_identity_without_changing_gameplay() {
    let words = actual();
    let rows = rows(&words);
    let base = hash(&words);
    let mut removed = words.clone();
    drop(removed.drain(rows[0].start..rows[0].start + 9));
    assert_ne!(hash(&removed), base, "actual output row membership");
    let mut reordered = words.clone();
    for offset in 0..9 {
        reordered.swap(rows[0].start + offset, rows[1].start + offset);
    }
    assert_ne!(hash(&reordered), base, "complete row order");
    let npc = select(&rows, true, FactionId::Fire, WeaponId::Bow, 1., 1.);
    let mut relabelled = words.clone();
    relabelled[npc.start] = 0;
    assert_ne!(
        hash(&relabelled),
        base,
        "profile key participates independently of its unchanged numeric outputs"
    );
    assert_eq!(
        &relabelled[npc.start + 1..npc.start + 9],
        &words[npc.start + 1..npc.start + 9]
    );
}

#[test]
fn emitted_npc_rows_bind_all_eighteen_unchanged_source_observations() {
    let words = actual();
    let rows = rows(&words);
    let source: Value = serde_json::from_str(include_str!(
        "../../../parity/walk-hint/helpers/source.json"
    ))
    .unwrap();
    assert_eq!(source["format"], "rh-walk-hint-helpers/1");
    let mut count = 0;
    for case in source["cases"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|case| case["family"] == "mirrorTimings")
    {
        let input = &case["input"];
        assert_eq!(input["profile"], "npc");
        let row = select(
            &rows,
            true,
            FactionId::parse(input["faction"].as_str().unwrap()).unwrap(),
            WeaponId::parse(input["weapon"].as_str().unwrap()).unwrap(),
            input["asMult"].as_f64().unwrap(),
            input["windupMult"].as_f64().unwrap(),
        );
        let timing = row.timing();
        for (field, value) in [
            ("interval", timing.interval),
            ("windup", timing.windup),
            ("root", timing.root),
            ("intervalMs", timing.interval * 1000.),
            ("windupMs", timing.windup * 1000.),
        ] {
            assert_eq!(
                value.to_bits(),
                case["observed"][field].as_f64().unwrap().to_bits(),
                "{} {field}",
                case["id"]
            );
        }
        assert_eq!(timing.ranged, case["observed"]["ranged"].as_bool().unwrap());
        count += 1;
    }
    assert_eq!(count, 18);
}

#[test]
fn actual_probe_rows_discriminate_floor_reduction_increase_and_clamp() {
    let words = actual();
    let rows = rows(&words);
    let get = |npc, weapon, as_mult, windup_mult| {
        select(&rows, npc, FactionId::Fire, weapon, as_mult, windup_mult).timing()
    };
    let bow = get(true, WeaponId::Bow, 1., 1.);
    let fast = get(true, WeaponId::Bow, 1.5, 0.5);
    assert!(fast.interval < bow.interval);
    assert_eq!(
        fast.windup.to_bits(),
        bow.windup.to_bits(),
        "actual NPC ranged floor survives the reduced windup mirror"
    );
    let without_floor = npc_timings(
        WeaponId::Bow,
        attack_interval(&paced(FactionId::Fire), WeaponId::Bow, 1.5),
    );
    assert!(
        without_floor.windup < fast.windup,
        "selected row actually distinguishes the floor"
    );
    assert_eq!(
        bow.windup.to_bits(),
        npc_timings(WeaponId::Bow, bow.interval).windup.to_bits(),
        "unit mirror retains the real base"
    );
    let axe = get(true, WeaponId::Axe, 1., 1.);
    assert!(
        get(true, WeaponId::Axe, 1.5, 0.5).windup < axe.windup,
        "melee reduction is observed"
    );
    assert!(
        get(false, WeaponId::Bow, 1., 1.5).windup > get(false, WeaponId::Bow, 1., 1.).windup,
        "player windup increase is observed"
    );
    let clamped = get(true, WeaponId::Bow, 1., 1.5);
    assert_eq!(
        clamped.windup.to_bits(),
        clamped.interval.to_bits(),
        "the added finite pair reaches the interval clamp"
    );
    // The current catalog has no positive root. Preserve every actual zero root word,
    // without claiming that this grid reaches scaleWindup's positive-root branch.
    assert!(rows
        .iter()
        .all(|row| row.timing().root.to_bits() == 0.0f64.to_bits()));
}
