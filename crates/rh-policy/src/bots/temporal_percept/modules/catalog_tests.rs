//! Frozen-catalog cross-check for the private modules layer.
//!
//! The module corpus embeds the complete actual source catalog (80 cards, 5 Wish definitions, boost/kill format
//! tables and the four built-ins' rule numbers). This test proves the admitted immutable sim static leaves and the
//! public planning/Wish/hazard rule tables the module layer consumes are exactly those source rows, so the replay's
//! expected scores/decisions are not fitted to a drifted catalog. It never feeds corpus expectations into runtime
//! inputs; it only compares declared constants.

use serde_json::Value;

use super::source_reader::{self, SVal};
use crate::bots::hazards as public_hazards;
use crate::bots::planning::PLAN_RULES;
use crate::bots::wish::WISH_RULES;
use rh_sim::cards::{BaseStatId, CardId, CardKind, MechanicTag};
use rh_sim::status_runtime::AbilityId;

fn source() -> SVal {
    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../parity/policy/bot-private-modules/source.json");
    let text = std::fs::read_to_string(&path).expect("frozen modules source.json");
    let raw: Value = serde_json::from_str(&text).expect("source.json is JSON");
    source_reader::parse(&raw["catalog"], "catalog").expect("catalog is a tagged method value")
}

fn text(v: &SVal, key: &str) -> String {
    v.field(key, key)
        .and_then(|value| value.string(key).map(str::to_owned))
        .unwrap_or_else(|error| panic!("{key}: {error}"))
}

fn num(v: &SVal, key: &str) -> f64 {
    v.field(key, key)
        .and_then(|value| value.num(key))
        .unwrap_or_else(|error| panic!("{key}: {error}"))
}

fn boolv(v: &SVal, key: &str) -> bool {
    v.field(key, key)
        .and_then(|value| value.bool(key))
        .unwrap_or_else(|error| panic!("{key}: {error}"))
}

fn strings(v: &SVal) -> Vec<String> {
    v.arr("array")
        .expect("string array")
        .iter()
        .map(|row| row.string("string").expect("string").to_owned())
        .collect()
}

fn opt_string(v: &SVal, key: &str) -> Option<String> {
    match v.optional(key) {
        None | Some(SVal::Null) => None,
        Some(SVal::Undefined) => None,
        Some(row) => Some(row.string(key).expect("string").to_owned()),
    }
}

fn kind_name(kind: CardKind) -> &'static str {
    match kind {
        CardKind::Base => "base",
        CardKind::Conditional => "conditional",
        CardKind::Augment => "augment",
    }
}

fn base_name(base: BaseStatId) -> &'static str {
    match base {
        BaseStatId::Ad => "ad",
        BaseStatId::Ap => "ap",
        BaseStatId::Haste => "haste",
        BaseStatId::Vitality => "vitality",
        BaseStatId::Armor => "armor",
        BaseStatId::Mr => "mr",
        BaseStatId::Leech => "leech",
        BaseStatId::Fleet => "fleet",
    }
}

fn tag_name(tag: MechanicTag) -> &'static str {
    match tag {
        MechanicTag::Physical => "physical",
        MechanicTag::Magic => "magic",
        MechanicTag::True_ => "true",
        MechanicTag::Dot => "dot",
        MechanicTag::OnHit => "onHit",
        MechanicTag::Returned => "returned",
        MechanicTag::Slow => "slow",
        MechanicTag::Heal => "heal",
        MechanicTag::Block => "block",
        MechanicTag::Ramping => "ramping",
        MechanicTag::Execute => "execute",
        MechanicTag::Crit => "crit",
        MechanicTag::Area => "area",
        MechanicTag::Wish => "wish",
    }
}

#[test]
fn admitted_static_card_catalog_matches_the_frozen_source_catalog() {
    let catalog = source();
    let cards = catalog
        .field("cards", "catalog.cards")
        .and_then(|value| value.arr("cards"))
        .expect("cards array");
    assert_eq!(cards.len(), CardId::ALL.len(), "card count");
    let card_ids = strings(catalog.field("cardIds", "catalog.cardIds").unwrap());
    for (index, card) in cards.iter().enumerate() {
        let id = CardId::ALL[index];
        assert_eq!(text(card, "id"), id.as_str(), "catalog order at {index}");
        assert_eq!(card_ids[index], id.as_str(), "cardIds order at {index}");
        let def = id.definition();
        assert_eq!(
            text(card, "kind"),
            kind_name(def.kind),
            "{} kind",
            id.as_str()
        );
        assert_eq!(num(card, "tier") as u8, def.tier, "{} tier", id.as_str());
        assert_eq!(text(card, "title"), def.title, "{} title", id.as_str());
        assert_eq!(text(card, "text"), def.text, "{} text", id.as_str());
        assert_eq!(boolv(card, "unique"), def.unique, "{} unique", id.as_str());
        assert_eq!(
            text(card, "ready") == "a",
            def.ready,
            "{} ready flag (source ready literal \"a\")",
            id.as_str()
        );
        let tags = strings(card.field("tags", "tags").unwrap());
        assert_eq!(
            tags,
            def.tags
                .iter()
                .map(|tag| tag_name(*tag))
                .collect::<Vec<_>>(),
            "{} tags",
            id.as_str()
        );
        assert_eq!(
            opt_string(card, "base").as_deref(),
            def.base.map(base_name),
            "{} base",
            id.as_str()
        );
        assert_eq!(
            opt_string(card, "requires").as_deref(),
            def.requires.map(base_name),
            "{} requires",
            id.as_str()
        );
    }
}

#[test]
fn admitted_boost_and_kill_format_tables_match_the_frozen_source_catalog() {
    let catalog = source();
    let boosts = strings(catalog.field("chestBoostStats", "chestBoostStats").unwrap());
    let ours: Vec<String> = rh_sim::reward_chests::BoostId::ALL
        .iter()
        .map(|boost| boost.as_str().trim_start_matches("boost:").to_owned())
        .collect();
    assert_eq!(boosts, ours, "CHEST_BOOST_STATS order");
    let kills = strings(catalog.field("killStatKeys", "killStatKeys").unwrap());
    let ours: Vec<String> = rh_sim::kill_augments::KillStatKey::ALL
        .iter()
        .map(|key| key.as_str().to_owned())
        .collect();
    assert_eq!(kills, ours, "KILL_STAT_KEYS order");
}

#[test]
fn admitted_rule_tables_match_the_frozen_source_catalog() {
    let catalog = source();
    let rules = catalog.field("rules", "catalog.rules").expect("rules");

    let hunter = rules.field("hunter", "rules.hunter").expect("hunter");
    let config = super::chest_hunt::CHEST_HUNT;
    assert_eq!(num(hunter, "pickRange"), config.pick_range, "pickRange");
    assert_eq!(num(hunter, "pickMarginMs"), config.pick_margin_ms);
    assert_eq!(num(hunter, "holdMs"), config.hold_ms);
    assert_eq!(num(hunter, "arriveSlackMs"), config.arrive_slack_ms);
    assert_eq!(num(hunter, "paceShare"), config.pace_share);
    assert_eq!(num(hunter, "fightWalk"), config.fight_walk);
    assert_eq!(num(hunter, "stallMs"), config.stall_ms);
    assert_eq!(num(hunter, "stallProgress"), config.stall_progress);
    assert_eq!(num(hunter, "stallStepMaxMs"), config.stall_step_max_ms);
    assert_eq!(num(hunter, "maxCandidates"), config.max_candidates);
    assert_eq!(num(hunter, "walkCacheMs"), config.walk_cache_ms);

    let planning = rules.field("planning", "rules.planning").expect("planning");
    let reads = planning.field("read", "read").expect("read");
    for (index, tier) in ["easy", "normal", "hard"].iter().enumerate() {
        let row = reads.field(tier, tier).expect("read row");
        let values = row.arr("read row").expect("read pair");
        assert_eq!(values[0].num("read lo").unwrap(), PLAN_RULES.read[index].0);
        assert_eq!(values[1].num("read hi").unwrap(), PLAN_RULES.read[index].1);
        let settles = planning.field("settle", "settle").expect("settle");
        let row = settles.field(tier, tier).expect("settle row");
        let values = row.arr("settle row").expect("settle pair");
        assert_eq!(
            values[0].num("settle lo").unwrap(),
            PLAN_RULES.settle[index].0
        );
        assert_eq!(
            values[1].num("settle hi").unwrap(),
            PLAN_RULES.settle[index].1
        );
    }
    assert_eq!(num(planning, "readShare"), PLAN_RULES.read_share);
    assert_eq!(num(planning, "readyBeforeMs"), PLAN_RULES.ready_before_ms);
    assert_eq!(
        num(planning, "readyBeforeShare"),
        PLAN_RULES.ready_before_share
    );
    assert_eq!(num(planning, "noDealMs"), PLAN_RULES.no_deal_ms);
    assert_eq!(num(planning, "resendMs"), PLAN_RULES.resend_ms);
    assert_eq!(num(planning, "maxAsks") as u32, PLAN_RULES.max_asks);

    let wishes = rules.field("wishes", "rules.wishes").expect("wishes");
    assert_eq!(num(wishes, "retryMs"), WISH_RULES.retry_ms);
    assert_eq!(num(wishes, "recentHitMs"), WISH_RULES.recent_hit_ms);
    assert_eq!(num(wishes, "chaseClosing"), WISH_RULES.chase_closing);
    assert_eq!(num(wishes, "chaseCos"), WISH_RULES.chase_cos);
    assert_eq!(num(wishes, "onItDistance"), WISH_RULES.on_it_distance);
    assert_eq!(num(wishes, "easyRemembers"), WISH_RULES.easy_remembers);
    assert_eq!(num(wishes, "slipPendingMs"), WISH_RULES.slip_pending_ms);
    assert_eq!(num(wishes, "slipGraceMs"), WISH_RULES.slip_grace_ms);
    assert_eq!(num(wishes, "slipUtility"), WISH_RULES.slip_utility);
    assert_eq!(num(wishes, "slipStepU"), WISH_RULES.slip_step_u);
    assert_eq!(num(wishes, "slipKeepMs"), WISH_RULES.slip_keep_ms);
    assert_eq!(num(wishes, "slipArrivedU"), WISH_RULES.slip_arrived_u);

    let hazards = rules.field("hazards", "rules.hazards").expect("hazards");
    assert_eq!(num(hazards, "stepEveryMs"), public_hazards::STEP_EVERY_MS);
    assert_eq!(num(hazards, "stillMs"), public_hazards::STILL_MS);
    assert_eq!(num(hazards, "stepTiles") as i64, public_hazards::STEP_TILES);
    assert_eq!(num(hazards, "holdMs"), public_hazards::HOLD_MS);
    assert_eq!(num(hazards, "arriveU"), public_hazards::ARRIVE_U);
    assert_eq!(
        num(hazards, "redirectTiles") as i64,
        public_hazards::REDIRECT_TILES
    );
    assert_eq!(num(hazards, "redirectMinU"), public_hazards::REDIRECT_MIN_U);
    assert_eq!(
        num(hazards, "lightTiles") as i64,
        public_hazards::LIGHT_TILES
    );
}

#[test]
fn admitted_wish_table_matches_the_frozen_source_ability_rows() {
    let catalog = source();
    let abilities = catalog
        .field("abilities", "catalog.abilities")
        .expect("abilities");
    let ids = strings(catalog.field("abilityIds", "abilityIds").unwrap());
    assert_eq!(
        ids,
        AbilityId::ALL
            .iter()
            .map(|id| id.as_str().to_owned())
            .collect::<Vec<_>>(),
        "ability ids/order"
    );
    for (index, id) in AbilityId::ALL.iter().enumerate() {
        let def = crate::bots::wish::wish_by_id(*id).expect("admitted wish row");
        let raw = abilities.field("x", "abilities").err();
        let _ = raw;
        let source_def = abilities
            .obj("abilities")
            .expect("abilities object")
            .iter()
            .find(|(key, _)| key == id.as_str())
            .map(|(_, value)| value)
            .expect("source ability row");
        assert_eq!(text(source_def, "id"), id.as_str(), "ability order {index}");
        assert_eq!(text(source_def, "name"), def.name, "{} name", id.as_str());
        let blocked_by: Vec<String> = def
            .blocked_by
            .iter()
            .map(|blocked| match blocked {
                crate::bots::wish::BlockedBy::Stun => "stun".to_owned(),
                crate::bots::wish::BlockedBy::Silence => "silence".to_owned(),
                crate::bots::wish::BlockedBy::Root => "root".to_owned(),
            })
            .collect();
        assert_eq!(
            strings(source_def.field("blockedBy", "blockedBy").unwrap()),
            blocked_by,
            "{} blockedBy",
            id.as_str()
        );
        let ai: Vec<String> = def
            .ai
            .iter()
            .map(|intent| match intent {
                crate::bots::wish::AiIntent::Escape => "escape",
                crate::bots::wish::AiIntent::Sustain => "sustain",
                crate::bots::wish::AiIntent::Engage => "engage",
                crate::bots::wish::AiIntent::Control => "control",
                crate::bots::wish::AiIntent::Peel => "peel",
                crate::bots::wish::AiIntent::Burst => "burst",
                crate::bots::wish::AiIntent::Zone => "zone",
                crate::bots::wish::AiIntent::Buff => "buff",
            })
            .map(str::to_owned)
            .collect();
        assert_eq!(
            strings(source_def.field("ai", "ai").unwrap()),
            ai,
            "{} ai",
            id.as_str()
        );
        let ranks = source_def
            .field("ranks", "ranks")
            .and_then(|value| value.arr("ranks"))
            .expect("ranks");
        assert_eq!(ranks.len(), 1, "{} rank count", id.as_str());
        let rank = &ranks[0];
        assert_eq!(
            num(rank, "castMs"),
            def.rank.cast_ms,
            "{} castMs",
            id.as_str()
        );
        let targeting = rank.field("targeting", "targeting").expect("targeting");
        match def.rank.targeting {
            crate::bots::wish::TargetRule::Self_ => {
                assert_eq!(text(targeting, "kind"), "self");
            }
            crate::bots::wish::TargetRule::Unit {
                range,
                los,
                snap_radius,
            } => {
                assert_eq!(text(targeting, "kind"), "unit");
                assert_eq!(num(targeting, "range"), range);
                assert_eq!(boolv(targeting, "los"), los);
                assert_eq!(num(targeting, "snapRadius"), snap_radius);
            }
            crate::bots::wish::TargetRule::Point { range, min_range } => {
                assert_eq!(text(targeting, "kind"), "point");
                assert_eq!(num(targeting, "range"), range);
                assert_eq!(num(targeting, "minRange"), min_range);
            }
        }
        let effects = rank
            .field("effects", "effects")
            .and_then(|value| value.arr("effects"))
            .expect("effects");
        let mut hides = false;
        let mut blink = None;
        for effect in effects {
            if text(effect, "do") == "status"
                && text(effect, "to") == "self"
                && opt_string(effect, "status").as_deref() == Some("hidden")
            {
                hides = true;
            }
            if text(effect, "do") == "blink" {
                blink = Some((num(effect, "maxDist"), num(effect, "minDist")));
            }
        }
        assert_eq!(
            hides,
            crate::bots::wish::hides_caster(def, 1),
            "{} hides caster",
            id.as_str()
        );
        let admitted_blink: Option<(f64, f64)> =
            def.rank.effects.iter().find_map(|effect| match effect {
                crate::bots::wish::PolicyEffect::Blink { max_dist, min_dist } => {
                    Some((*max_dist, *min_dist))
                }
                crate::bots::wish::PolicyEffect::HidesCaster => None,
            });
        assert_eq!(blink, admitted_blink, "{} blink", id.as_str());
    }
}
