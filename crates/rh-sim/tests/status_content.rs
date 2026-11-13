//! Independent inventory of the actual status policy words and the shared aggregate hash path.
//! Requires only the coordinator seams described in status-content-proposal-v1/README.md.
use rh_sim::{
    content::{content_hash, content_hash_of_status_words, REGISTRY, STAGGER_WEAPONS},
    status_runtime::{
        self as rt, AbilityId, FieldKind, RankOneFieldPolicy, StatusKind, StatusRule,
    },
};

#[derive(Clone, Debug, PartialEq, Eq)]
struct Word {
    label: String,
    value: u64,
}
fn push(out: &mut Vec<Word>, label: impl Into<String>, value: u64) {
    out.push(Word {
        label: label.into(),
        value,
    });
}
fn optional(out: &mut Vec<Word>, label: &str, value: Option<f64>) {
    push(out, format!("{label}.present"), u64::from(value.is_some()));
    if let Some(value) = value {
        push(out, format!("{label}.value"), value.to_bits());
    }
}
fn text(out: &mut Vec<Word>, label: &str, value: &str) {
    push(out, format!("{label}.len"), value.len() as u64);
    for (i, byte) in value.bytes().enumerate() {
        push(out, format!("{label}[{i}]"), u64::from(byte));
    }
}
// Exhaustiveness guards: a new kind must receive an explicit content decision.
fn status_code(kind: StatusKind) -> u64 {
    match kind {
        StatusKind::Stun
        | StatusKind::Root
        | StatusKind::Silence
        | StatusKind::SlowMove
        | StatusKind::SlowAttack
        | StatusKind::AntiHeal
        | StatusKind::Dot
        | StatusKind::Invulnerable
        | StatusKind::Untargetable
        | StatusKind::Hidden
        | StatusKind::Zoned
        | StatusKind::DeathFloor
        | StatusKind::Haste
        | StatusKind::Shred => kind as u64,
    }
}
fn field_code(kind: FieldKind) -> u64 {
    match kind {
        FieldKind::Zone | FieldKind::Cloud | FieldKind::Trail => kind as u64,
        // Staged: the wall's code enters the content stream with the frostWall id (P-FROST-WALL-2).
        FieldKind::Wall => unreachable!("Wall is not in the content field list yet"),
    }
}
fn ability_code(id: AbilityId) -> u64 {
    match id {
        AbilityId::Freeze
        | AbilityId::Swarm
        | AbilityId::Trial
        | AbilityId::Blaze
        | AbilityId::LastStand => id as u64,
    }
}
fn combine_code(combine: rt::Combine) -> u64 {
    match combine {
        rt::Combine::Any | rt::Combine::Sum | rt::Combine::Max | rt::Combine::Product => {
            combine as u64
        }
    }
}
fn cleanse_code(cleanse: rt::CleanseClass) -> u64 {
    match cleanse {
        rt::CleanseClass::Soft | rt::CleanseClass::Hard | rt::CleanseClass::Never => cleanse as u64,
    }
}
fn rule_inventory(rows: &[(StatusKind, StatusRule)]) -> Vec<Word> {
    let mut out = Vec::new();
    for (i, &(kind, row)) in rows.iter().enumerate() {
        // No '..': adding a production field must fail this independent inventory at compile time.
        let StatusRule {
            max_ms,
            combine,
            cap,
            cleanse,
            bit,
            players_only,
        } = row;
        push(&mut out, format!("rule[{i}].kind"), status_code(kind));
        push(&mut out, format!("rule[{i}].max_ms"), max_ms.to_bits());
        push(
            &mut out,
            format!("rule[{i}].combine"),
            combine_code(combine),
        );
        optional(&mut out, &format!("rule[{i}].cap"), cap);
        push(
            &mut out,
            format!("rule[{i}].cleanse"),
            cleanse_code(cleanse),
        );
        push(&mut out, format!("rule[{i}].bit"), u64::from(bit));
        push(
            &mut out,
            format!("rule[{i}].players_only"),
            u64::from(players_only),
        );
    }
    push(&mut out, "hidden_reveal_ms", rt::HIDDEN_REVEAL_MS.to_bits());
    push(&mut out, "effect_casting", u64::from(rt::EFFECT_CASTING));
    out
}
fn extra_inventory(
    fields: &[FieldKind],
    policies: &[(AbilityId, RankOneFieldPolicy)],
) -> Vec<Word> {
    let mut out = Vec::new();
    for (i, &kind) in fields.iter().enumerate() {
        push(&mut out, format!("field[{i}]"), field_code(kind));
    }
    // References to the real production constants, not copied numeric expectations.
    for (label, value) in [
        ("haste_base_floor", rt::HASTE_BASE_FLOOR),
        ("death_floor_default_hp", rt::DEATH_FLOOR_DEFAULT_HP),
        ("lifesteal_max", rt::LIFESTEAL_MAX),
        ("holy_leech_row_mult", rt::HOLY_LEECH_ROW_MULT),
        ("crit_epsilon", rt::CRIT_EPSILON),
        ("crit_mult", rt::CRIT_MULT),
        ("crit_chance_max", rt::CRIT_CHANCE_MAX),
    ] {
        push(&mut out, label, value.to_bits());
    }
    for (i, &(id, policy)) in policies.iter().enumerate() {
        let RankOneFieldPolicy { exit_stun_ms, burn } = policy;
        push(&mut out, format!("ability[{i}].id"), ability_code(id));
        text(&mut out, &format!("ability[{i}].name"), id.as_str());
        optional(
            &mut out,
            &format!("ability[{i}].exit_stun_ms"),
            exit_stun_ms,
        );
        push(
            &mut out,
            format!("ability[{i}].burn.present"),
            u64::from(burn.is_some()),
        );
        if let Some((dps, ms)) = burn {
            push(&mut out, format!("ability[{i}].burn.dps"), dps.to_bits());
            push(&mut out, format!("ability[{i}].burn.ms"), ms.to_bits());
        }
    }
    text(&mut out, "axe_tag", rt::StatusTag::Axe.as_str());
    out
}
fn rows() -> Vec<(StatusKind, StatusRule)> {
    rt::STATUS_KINDS
        .into_iter()
        .map(|kind| (kind, *kind.rule()))
        .collect()
}
fn policies() -> Vec<(AbilityId, RankOneFieldPolicy)> {
    AbilityId::ALL
        .into_iter()
        .map(|id| (id, rt::rank_one_field_policy(id)))
        .collect()
}
const FIELDS: [FieldKind; 3] = [FieldKind::Zone, FieldKind::Cloud, FieldKind::Trail];
fn values(words: &[Word]) -> Vec<u64> {
    words.iter().map(|word| word.value).collect()
}
fn actual() -> (Vec<u64>, Vec<u64>) {
    let (mut rules, mut extra) = (Vec::new(), Vec::new());
    rt::visit_content(|word| rules.push(word));
    rt::visit_extra_content(|word| extra.push(word));
    (rules, extra)
}
fn hash(rules: &[u64], extra: &[u64]) -> u64 {
    content_hash_of_status_words(REGISTRY, STAGGER_WEAPONS, rules, extra)
}
fn differs(base: &(Vec<u64>, Vec<u64>), candidate: &(Vec<u64>, Vec<u64>), label: &str) {
    assert_ne!(candidate, base, "ineffective mutation: {label}");
    assert_ne!(
        hash(&candidate.0, &candidate.1),
        hash(&base.0, &base.1),
        "unhashed {label}"
    );
}

#[test]
fn actual_visitors_equal_complete_independent_inventory_and_default_aggregate() {
    let (rules, extra) = actual();
    assert_eq!(rules, values(&rule_inventory(&rows())));
    assert_eq!(extra, values(&extra_inventory(&FIELDS, &policies())));
    assert_eq!((rules.len(), extra.len()), (105, 67));
    assert_eq!(hash(&rules, &extra), content_hash());
}

#[test]
fn every_actual_word_membership_and_observable_order_changes_aggregate() {
    let base = actual();
    let inventories = [
        rule_inventory(&rows()),
        extra_inventory(&FIELDS, &policies()),
    ];
    let mut changed_words = 0;
    let mut deleted_words = 0;
    let mut inserted_words = 0;
    let mut changed_order = 0;
    for (section, inventory) in inventories.iter().enumerate() {
        for (i, word) in inventory.iter().enumerate() {
            for operation in 0..3 {
                let mut candidate = base.clone();
                let target = if section == 0 {
                    &mut candidate.0
                } else {
                    &mut candidate.1
                };
                match operation {
                    0 => {
                        target[i] ^= 1;
                        changed_words += 1;
                    }
                    1 => {
                        target.remove(i);
                        deleted_words += 1;
                    }
                    2 => {
                        target.insert(i, target[i]);
                        inserted_words += 1;
                    }
                    _ => unreachable!(),
                }
                differs(
                    &base,
                    &candidate,
                    &format!("{} operation {operation}", word.label),
                );
            }
        }
        let source = if section == 0 { &base.0 } else { &base.1 };
        for i in 0..source.len() - 1 {
            // Exchanging identical words has no observable serialization order change.
            if source[i] == source[i + 1] {
                continue;
            }
            let mut candidate = base.clone();
            let target = if section == 0 {
                &mut candidate.0
            } else {
                &mut candidate.1
            };
            target.swap(i, i + 1);
            differs(
                &base,
                &candidate,
                &format!("section {section} word order {i}"),
            );
            changed_order += 1;
        }
    }
    assert_eq!(
        (changed_words, deleted_words, inserted_words),
        (172, 172, 172)
    );
    assert!(changed_order > 0);
    differs(
        &base,
        &(base.1.clone(), base.0.clone()),
        "rule/extra section identity",
    );
}

#[test]
fn typed_rows_and_optional_presence_are_part_of_identity() {
    let base = actual();
    let original_rows = rows();
    let original_policies = policies();
    for i in 0..original_rows.len() {
        let mut candidate_rows = original_rows.clone();
        candidate_rows[i].1.cap = if candidate_rows[i].1.cap.is_some() {
            None
        } else {
            Some(0.)
        };
        differs(
            &base,
            &(values(&rule_inventory(&candidate_rows)), base.1.clone()),
            &format!("rule[{i}] cap presence"),
        );
        let mut candidate_rows = original_rows.clone();
        candidate_rows[i] = original_rows[(i + 1) % original_rows.len()];
        differs(
            &base,
            &(values(&rule_inventory(&candidate_rows)), base.1.clone()),
            &format!("rule[{i}] membership"),
        );
        if i + 1 < original_rows.len() {
            let mut candidate_rows = original_rows.clone();
            candidate_rows.swap(i, i + 1);
            differs(
                &base,
                &(values(&rule_inventory(&candidate_rows)), base.1.clone()),
                &format!("rule[{i}] order"),
            );
        }
    }
    for i in 0..original_policies.len() {
        for burn_field in [false, true] {
            let mut candidate_policies = original_policies.clone();
            let p = &mut candidate_policies[i].1;
            if burn_field {
                p.burn = if p.burn.is_some() {
                    None
                } else {
                    Some((0., 0.))
                };
            } else {
                p.exit_stun_ms = if p.exit_stun_ms.is_some() {
                    None
                } else {
                    Some(0.)
                };
            }
            differs(
                &base,
                &(
                    base.0.clone(),
                    values(&extra_inventory(&FIELDS, &candidate_policies)),
                ),
                &format!("policy[{i}] optional field {burn_field}"),
            );
        }
        let mut candidate_policies = original_policies.clone();
        candidate_policies[i] = original_policies[(i + 1) % original_policies.len()];
        differs(
            &base,
            &(
                base.0.clone(),
                values(&extra_inventory(&FIELDS, &candidate_policies)),
            ),
            &format!("policy[{i}] membership"),
        );
        if i + 1 < original_policies.len() {
            let mut candidate_policies = original_policies.clone();
            candidate_policies.swap(i, i + 1);
            differs(
                &base,
                &(
                    base.0.clone(),
                    values(&extra_inventory(&FIELDS, &candidate_policies)),
                ),
                &format!("policy[{i}] order"),
            );
        }
    }
    for i in 0..FIELDS.len() {
        let mut fields = FIELDS;
        fields[i] = FIELDS[(i + 1) % FIELDS.len()];
        differs(
            &base,
            &(
                base.0.clone(),
                values(&extra_inventory(&fields, &original_policies)),
            ),
            &format!("field[{i}] membership"),
        );
        if i + 1 < FIELDS.len() {
            let mut fields = FIELDS;
            fields.swap(i, i + 1);
            differs(
                &base,
                &(
                    base.0.clone(),
                    values(&extra_inventory(&fields, &original_policies)),
                ),
                &format!("field[{i}] order"),
            );
        }
    }
}
