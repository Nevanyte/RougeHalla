//! Folding of the status, progression and mirror-timing content into the rules identity, and the visitors that
//! enumerate their words.

use super::*;

pub(super) fn fold_mob_catalog(h: &mut Fnv, definition: &crate::mob_catalog::Definition) {
    use crate::mob_catalog::{visit_definition, Metadata};
    h.str("mob-catalog/1");
    h.u64(definition.roles.len() as u64);
    h.u64(definition.types.len() as u64);
    h.u64(definition.regions.len() as u64);
    visit_definition(definition, |entry| match entry {
        Metadata::Role(row) => {
            h.str("role");
            h.str(row.id.as_str());
            h.str(row.label);
            h.f64(row.hp_mult);
            h.f64(row.dmg_mult);
            h.f64(row.move_mult);
            h.u64(row.tags.len() as u64);
            for tag in row.tags {
                h.str(tag.as_str());
            }
            h.str(row.blurb);
        }
        Metadata::Type(row) => {
            h.str("type");
            h.str(row.id.as_str());
            h.str(row.zone.as_str());
            h.u64(u64::from(row.elite));
            h.str(row.name);
            h.str(row.role.as_str());
            h.str(row.weapon.as_str());
        }
        Metadata::Region(row) => {
            h.str("region");
            h.str(row.zone.as_str());
            h.u64(row.names.len() as u64);
            for name in row.names {
                h.str(name);
            }
            h.str(row.weapon.as_str());
        }
        Metadata::Rules(row) => {
            h.str("rules");
            h.u64(row.bag_copies as u64);
            h.f64(row.melee_damage);
            h.f64(row.ranged_damage);
            h.f64(row.elite_damage);
        }
    });
}

/// Perturbs the words emitted by the actual status visitors through the real aggregate path.
pub fn content_hash_of_status_words(
    registry: &[Entry],
    stagger_weapons: &[WeaponId],
    rule_words: &[u64],
    extra_words: &[u64],
) -> u64 {
    let signatures = crate::factions::SignatureKind::ALL.map(|kind| (kind, kind.is_dot()));
    content_hash_of_definitions(
        registry,
        stagger_weapons,
        MapDefinitions::default(),
        &signatures,
        &crate::stat_fold::default_definition(),
        &crate::mob_catalog::DEFINITION,
        RuntimeWords {
            status: Some((rule_words, extra_words)),
            ..Default::default()
        },
    )
}

// Only output words are injected; no status rules or gameplay operations are mutated.
// The default streams the real visitors twice (length, then words), without collecting.
pub(super) fn fold_status_stream(
    h: &mut Fnv,
    label: &str,
    supplied: Option<&[u64]>,
    visit: fn(&mut dyn FnMut(u64)),
) {
    h.str(label);
    if let Some(words) = supplied {
        h.u64(words.len() as u64);
        for &word in words {
            h.u64(word);
        }
    } else {
        let mut count = 0u64;
        visit(&mut |_| count += 1);
        h.u64(count);
        visit(&mut |word| h.u64(word));
    }
}
pub(super) fn fold_status_content(h: &mut Fnv, supplied: Option<(&[u64], &[u64])>) {
    fold_status_stream(h, "status-rules/1", supplied.map(|words| words.0), |word| {
        crate::status_runtime::visit_content(word)
    });
    fold_status_stream(h, "status-extra/1", supplied.map(|words| words.1), |word| {
        crate::status_runtime::visit_extra_content(word)
    });
}

#[derive(Default)]
pub(super) struct RuntimeWords<'a> {
    pub(super) status: Option<(&'a [u64], &'a [u64])>,
    pub(super) progression: Option<&'a [u64]>,
    pub(super) timings: Option<&'a [u64]>,
}

/// Ordered words from the actual selected-card, modifier, farm, reward and private-stream definitions, and the
/// realized card tables of both rules ([`card_table_snapshots`]).
/// Component names/lengths and actual public key mappings prevent membership/order ambiguity.
pub fn visit_progression_content(word: impl FnMut(u64)) {
    visit_progression_content_with(&card_table_snapshots(), word);
}

/// [`visit_progression_content`] with the card tables given by the caller: the one code path that the
/// [`content_hash_of_card_tables`] seam and `content_hash` share.
fn visit_progression_content_with(tables: &[CardTableSnapshot<'_>], mut word: impl FnMut(u64)) {
    type Visit = fn(&mut dyn FnMut(u64));
    let visitors: [(&str, Visit); 10] = [
        ("cards/1", |f| {
            crate::cards::visit_content(&crate::cards::DEFINITION, f)
        }),
        ("modifiers/1", |f| {
            crate::modifiers::visit_content(&crate::modifiers::DEFINITION, f)
        }),
        ("farm/1", |f| {
            crate::modifiers::farm::visit_content(&crate::modifiers::farm::DEFINITION, f)
        }),
        ("reward-chests/1", |f| {
            crate::reward_chests::visit_content(&crate::reward_chests::DEFINITION, f)
        }),
        ("private-sfc32/1", |f| crate::private_rng::visit_content(f)),
        ("small-potions/1", |f| crate::potions::visit_content(f)),
        ("kill-augments/1", |f| {
            crate::kill_augments::visit_content(&crate::kill_augments::DEFINITION, f)
        }),
        ("quests/1", |f| crate::quests::catalog::visit_content(f)),
        ("traders/1", |f| crate::traders::visit_content(f)),
        ("hitbox-archetypes/1", |f| {
            crate::archetype::visit_content(f)
        }),
    ];
    for (tag, visit) in visitors {
        word(tag.len() as u64);
        for b in tag.bytes() {
            word(u64::from(b));
        }
        let mut n = 0;
        visit(&mut |_| n += 1);
        word(n);
        visit(&mut word);
    }
    word(FactionId::ALL.len() as u64);
    for faction in FactionId::ALL {
        word(u64::from(faction.code()));
        word(u64::from(crate::systems::mobs::basic_faction(faction)));
    }
    word(crate::cards::CardId::ALL.len() as u64);
    for id in crate::cards::CardId::ALL {
        word(id.index() as u64);
        word(id.as_str().len() as u64);
        for b in id.as_str().bytes() {
            word(u64::from(b));
        }
    }
    // P-AUG-NATIVE-1a: the native ids the same way, then their definitions and caps.
    crate::cards::native::visit_content(&mut word);
    visit_card_tables(tables, &mut word);
    word(crate::reward_chests::BoostId::ALL.len() as u64);
    for id in crate::reward_chests::BoostId::ALL {
        word(id.index() as u64);
        word(id.as_str().len() as u64);
        for b in id.as_str().bytes() {
            word(u64::from(b));
        }
    }
}

/// Ordered probes of the real mirrored timing calculation, including both fighter profiles.
/// The schema/key tables identify every input/output word; all rows use actual paced faction
/// content and mirror_timings. Probe inputs describe identity coverage, not gameplay tuning.
/// The visitor uses only fixed stack arrays and streams directly to its caller.
pub fn visit_mirror_timing_content(mut word: impl FnMut(u64)) {
    fn text(word: &mut impl FnMut(u64), value: &str) {
        word(value.len() as u64);
        for byte in value.bytes() {
            word(u64::from(byte));
        }
    }
    let profiles = [("player", false), ("npc", true)];
    let inputs: [(f64, f64); 4] = [(1., 1.), (1.5, 0.5), (0.5, 1.5), (1., 1.5)];
    text(&mut word, "mirror-timing-probes/1");
    text(&mut word, "factions");
    word(FactionId::ALL.len() as u64);
    for faction in FactionId::ALL {
        word(u64::from(faction.code()));
        text(&mut word, faction.as_str());
    }
    text(&mut word, "weapons");
    word(WeaponId::ALL.len() as u64);
    for weapon in WeaponId::ALL {
        word(u64::from(weapon.code()));
        text(&mut word, weapon.as_str());
    }
    text(&mut word, "profiles");
    word(profiles.len() as u64);
    for (name, npc) in profiles {
        word(u64::from(npc));
        text(&mut word, name);
    }
    text(&mut word, "inputs");
    word(inputs.len() as u64);
    for (as_mult, windup_mult) in inputs {
        word(as_mult.to_bits());
        word(windup_mult.to_bits());
    }
    let fields = [
        "profile",
        "faction",
        "weapon",
        "asMult",
        "windupMult",
        "interval",
        "windup",
        "root",
        "ranged",
    ];
    text(&mut word, "row-keys");
    word(fields.len() as u64);
    for field in fields {
        text(&mut word, field);
    }
    text(&mut word, "rows");
    word((FactionId::ALL.len() * WeaponId::ALL.len() * profiles.len() * inputs.len()) as u64);
    for faction in FactionId::ALL {
        let spec = paced(faction);
        for weapon in WeaponId::ALL {
            for (_, npc) in profiles {
                for (as_mult, windup_mult) in inputs {
                    let timing = mirror_timings(&spec, weapon, as_mult, windup_mult, npc);
                    for value in [
                        u64::from(npc),
                        u64::from(faction.code()),
                        u64::from(weapon.code()),
                        as_mult.to_bits(),
                        windup_mult.to_bits(),
                        timing.interval.to_bits(),
                        timing.windup.to_bits(),
                        timing.root.to_bits(),
                        u64::from(timing.ranged),
                    ] {
                        word(value);
                    }
                }
            }
        }
    }
}

/// Sensitivity seam for the actual aggregate identity; supplied timing words replace only
/// this visitor's output stream, never the gameplay function, registry or other components.
pub fn content_hash_of_mirror_timing_words(
    registry: &[Entry],
    stagger_weapons: &[WeaponId],
    words: &[u64],
) -> u64 {
    let signatures = crate::factions::SignatureKind::ALL.map(|kind| (kind, kind.is_dot()));
    content_hash_of_definitions(
        registry,
        stagger_weapons,
        MapDefinitions::default(),
        &signatures,
        &crate::stat_fold::default_definition(),
        &crate::mob_catalog::DEFINITION,
        RuntimeWords {
            timings: Some(words),
            ..Default::default()
        },
    )
}

/// Sensitivity seam for the real aggregate fold; only output words are supplied, no gameplay state changes.
pub fn content_hash_of_progression_words(
    registry: &[Entry],
    stagger_weapons: &[WeaponId],
    words: &[u64],
) -> u64 {
    let signatures = crate::factions::SignatureKind::ALL.map(|kind| (kind, kind.is_dot()));
    content_hash_of_definitions(
        registry,
        stagger_weapons,
        MapDefinitions::default(),
        &signatures,
        &crate::stat_fold::default_definition(),
        &crate::mob_catalog::DEFINITION,
        RuntimeWords {
            progression: Some(words),
            ..Default::default()
        },
    )
}

/// P-AUG-POOL-1-fix: one card table as a world with its rule plays it, as the rules identity folds it: the named card
/// numbers (each `CardNumbers` field), the override rows (each row's numbers by `cards::map_numbers`), and the chest
/// inputs (the pool ids, the faction-only pairs, the Eye for an Eye weighting flag).
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct CardTableSnapshot<'a> {
    pub rule: crate::AugmentRule,
    pub numbers: crate::cards::CardNumbers,
    pub overrides: &'a [crate::cards::CardDef],
    pub pool: &'a [crate::cards::CardId],
    pub faction_only: &'a [(crate::cards::CardId, FactionId)],
    pub weight_eye_for_an_eye: bool,
}

impl CardTableSnapshot<'static> {
    /// The snapshot of a real card table.
    pub fn of(t: &'static crate::cards::Tuning) -> Self {
        CardTableSnapshot {
            rule: t.rule(),
            numbers: *t.numbers(),
            overrides: t.overrides(),
            pool: t.pool(),
            faction_only: t.faction_only(),
            weight_eye_for_an_eye: t.weights_eye_for_an_eye(),
        }
    }
}

/// P-AUG-POOL-1-fix: both real card tables, `[Legacy, Rework]`, read from the `Tuning` statics. `content_hash` folds
/// exactly these.
pub fn card_table_snapshots() -> [CardTableSnapshot<'static>; 2] {
    use crate::cards::Tuning;
    use crate::AugmentRule;
    [
        CardTableSnapshot::of(Tuning::of_rule(AugmentRule::Legacy)),
        CardTableSnapshot::of(Tuning::of_rule(AugmentRule::Rework)),
    ]
}

/// P-AUG-POOL-1-fix sensitivity seam: [`content_hash`] with the card tables given by the caller in place of
/// [`card_table_snapshots`] (everything else is the build's own). Equals `content_hash()` for the real tables.
pub fn content_hash_of_card_tables(
    registry: &[Entry],
    stagger_weapons: &[WeaponId],
    tables: &[CardTableSnapshot<'_>],
) -> u64 {
    let mut words = Vec::new();
    visit_progression_content_with(tables, |w| words.push(w));
    content_hash_of_progression_words(registry, stagger_weapons, &words)
}

/// The words of the realized card tables, inside the `mvp-progression/1` stream. Per table: a tag, the rule, the named
/// numbers in field order, the override rows (count; per row its id, its rows, then its selections as faction code and
/// rows; each row as its number count and the bits `cards::map_numbers` walks), the pool (length, ids), the
/// faction-only pairs (count, pairs) and the Eye for an Eye weighting flag. Card text, titles, tags and row shape are
/// not folded: they are display, or forced equal to the catalog row by `check_override`.
fn visit_card_tables(tables: &[CardTableSnapshot<'_>], word: &mut impl FnMut(u64)) {
    fn text(word: &mut impl FnMut(u64), value: &str) {
        word(value.len() as u64);
        for b in value.bytes() {
            word(u64::from(b));
        }
    }
    fn rows(word: &mut impl FnMut(u64), rows: &[crate::cards::CardRow]) {
        word(rows.len() as u64);
        for row in rows {
            let mut count = 0u64;
            crate::cards::map_numbers(row, &mut |x| {
                count += 1;
                x
            });
            word(count);
            crate::cards::map_numbers(row, &mut |x| {
                word(x.to_bits());
                x
            });
        }
    }
    text(word, "card-tables/1");
    word(tables.len() as u64);
    for table in tables {
        let CardTableSnapshot {
            rule,
            numbers,
            overrides,
            pool,
            faction_only,
            weight_eye_for_an_eye,
        } = *table;
        text(word, "card-table");
        word(match rule {
            crate::AugmentRule::Legacy => 0,
            crate::AugmentRule::Rework => 1,
        });
        // No `..`: a new `CardNumbers` field fails to compile here until it is folded.
        let crate::cards::CardNumbers {
            plant_feet_bonus,
            gambler_up_chance,
            gambler_down_chance,
            gambler_up,
            gambler_down,
            wishful_budget_ms,
            wishful_window_ms,
            wishful_floor_share,
            wishful_hit_share,
            wishful_budget_share,
            outgoing_row_cap,
            hp_race_cap,
            third_time_every,
            third_time_extra,
        } = numbers;
        let fields = [
            plant_feet_bonus.to_bits(),
            gambler_up_chance.to_bits(),
            gambler_down_chance.to_bits(),
            gambler_up.to_bits(),
            gambler_down.to_bits(),
            wishful_budget_ms.to_bits(),
            wishful_window_ms.to_bits(),
            wishful_floor_share.to_bits(),
            wishful_hit_share.to_bits(),
            wishful_budget_share.to_bits(),
            outgoing_row_cap.to_bits(),
            hp_race_cap.to_bits(),
            u64::from(third_time_every),
            third_time_extra.to_bits(),
        ];
        word(fields.len() as u64);
        for field in fields {
            word(field);
        }
        word(overrides.len() as u64);
        for def in overrides {
            word(def.id.index() as u64);
            rows(word, def.rows);
            word(def.selections.len() as u64);
            for selection in def.selections {
                word(u64::from(selection.faction.code()));
                rows(word, selection.rows);
            }
        }
        word(pool.len() as u64);
        for id in pool {
            word(id.index() as u64);
        }
        word(faction_only.len() as u64);
        for (id, faction) in faction_only {
            word(id.index() as u64);
            word(u64::from(faction.code()));
        }
        word(u64::from(weight_eye_for_an_eye));
    }
}
