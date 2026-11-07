#!/usr/bin/env python3
"""Generate the typed 80-card catalog table from the accepted 409-case source corpus.

The corpus (parity/card-catalog/source.json) is the authority: its catalog/* cases carry each card's
source definition and complete effect rows. This emits crates/rh-sim/src/cards/catalog_data.rs.
Run: python3 tools/card-catalog-fixtures/emit_cards.py
"""
import json, pathlib, re, sys

ROOT = pathlib.Path(__file__).resolve().parents[2]
CORPUS = ROOT / "parity/card-catalog/source.json"
OUT = ROOT / "crates/rh-sim/src/cards/catalog_data.rs"

def pascal(s):
    return s[0].upper() + s[1:]

def rust_str(s):
    return json.dumps(s, ensure_ascii=False)

BASE = {"ad": "Ad", "ap": "Ap", "haste": "Haste", "vitality": "Vitality", "armor": "Armor", "mr": "Mr", "leech": "Leech", "fleet": "Fleet"}
STAT = {"attackSpeed": "AttackSpeed", "moveSpeed": "MoveSpeed", "damage": "Damage", "windup": "Windup", "lifesteal": "Lifesteal",
        "markRate": "MarkRate", "healTaken": "HealTaken", "damageTaken": "DamageTaken", "cooldown": "Cooldown", "executeBand": "ExecuteBand",
        "slowResist": "SlowResist", "lifestealMult": "LifestealMult", "lifestealDot": "LifestealDot", "critChance": "CritChance",
        "healBarrier": "HealBarrier", "maxHp": "MaxHp"}
FLAT = {"armor": "Armor", "shield": "Shield", "ad": "Ad", "ap": "Ap"}
MULT = {"asPost": "AsPost", "hit": "Hit", "dot": "Dot", "returned": "Returned", "ap": "Ap", "wishCooldown": "WishCooldown", "hpRace": "HpRace", "linger": "Linger"}
FLAG = {"lockSecondSlot": "LockSecondSlot", "noCrit": "NoCrit", "dotCrit": "DotCrit", "plagueDotCritConversion": "PlagueDotCritConversion",
        "gambler": "Gambler", "thirdCharm": "ThirdCharm", "eyeForAnEye": "EyeForAnEye", "twiceUnarmed": "TwiceUnarmed", "blockHits": "BlockHits",
        "plantFeet": "PlantFeet", "festering": "Festering", "heavierSentence": "HeavierSentence", "swiftJudgment": "SwiftJudgment",
        "gallowsPatience": "GallowsPatience", "noCommutation": "NoCommutation", "finalVerdict": "FinalVerdict"}
WHILE = {"chasingLock": "ChasingLock", "hpBelow": "HpBelow", "afterCast": "AfterCast", "notShooting": "NotShooting", "unarmed": "Unarmed", "fightTime": "FightTime"}
CONV_FROM = {"ad": "Ad", "maxHp": "MaxHp", "bonusAttackSpeed": "BonusAttackSpeed", "bonusMoveSpeed": "BonusMoveSpeed"}
CONV_TO = {"attackSpeed": "AttackSpeed", "moveSpeed": "MoveSpeed", "damage": "Damage", "windup": "Windup", "lifesteal": "Lifesteal",
           "markRate": "MarkRate", "healTaken": "HealTaken", "damageTaken": "DamageTaken", "cooldown": "Cooldown", "executeBand": "ExecuteBand",
           "slowResist": "SlowResist", "lifestealMult": "LifestealMult", "lifestealDot": "LifestealDot", "critChance": "CritChance",
           "healBarrier": "HealBarrier", "armor": "Armor", "shield": "Shield", "ad": "Ad", "ap": "Ap"}
VS = {"elite": "Elite", "higherPower": "HigherPower", "slowed": "Slowed", "streak": "Streak", "thirdParty": "ThirdParty", "hpBelow": "HpBelow", "playerAbove": "PlayerAbove"}
SCALE_SRC = {"campsCleared": "CampsCleared", "streak": "Streak"}
KIND = {"base": "Base", "conditional": "Conditional", "augment": "Augment"}
TAGS = {"physical": "Physical", "magic": "Magic", "true": "True_", "dot": "Dot", "onHit": "OnHit", "returned": "Returned", "slow": "Slow",
        "heal": "Heal", "block": "Block", "ramping": "Ramping", "execute": "Execute", "crit": "Crit", "area": "Area", "wish": "Wish"}
def NUM(v):
    # Integer JSON numbers are exact f64 literals in these rows; emit a float so const rows type-check.
    return "{}.0".format(v) if isinstance(v, int) else json.dumps(v)

def opt_num(v):
    return "None" if v is None else "Some({})".format(NUM(v))

def row(e):
    k = e["k"]
    if k == "stat":
        return "CardRow::Fold(EffectKind::Stat {{ stat: EffectStat::{}, v: {} }})".format(STAT[e["stat"]], NUM(e["v"]))
    if k == "flat":
        return "CardRow::Fold(EffectKind::Flat {{ stat: FlatStat::{}, v: {} }})".format(FLAT[e["stat"]], NUM(e["v"]))
    if k == "mult":
        return "CardRow::Fold(EffectKind::Mult {{ key: MultKey::{}, v: {} }})".format(MULT[e["key"]], NUM(e["v"]))
    if k == "flag":
        return "CardRow::Fold(EffectKind::Flag {{ flag: EffectFlag::{} }})".format(FLAG[e["flag"]])
    if k == "while":
        return "CardRow::Fold(EffectKind::While(WhileRow {{ cond: WhileCond::{}, arg: {}, stat: StatKey::{}, v: {}, ms: {} }}))".format(
            WHILE[e["cond"]], NUM(e["arg"]), STAT[e["stat"]], NUM(e["v"]), opt_num(e.get("ms")))
    if k == "convert":
        return "CardRow::Fold(EffectKind::Convert {{ from: ConvertFrom::{}, to: ConvertTo::{}, per: {}, cap: {} }})".format(
            CONV_FROM[e["from"]], CONV_TO[e["to"]], NUM(e["per"]), opt_num(e.get("cap")))
    if k == "vs":
        return "CardRow::Vs(VsRow {{ test: VsTest::{}, arg: {}, v: {} }})".format(VS[e["test"]], NUM(e["arg"]), NUM(e["v"]))
    if k == "scale":
        return "CardRow::Scale(ScaleRow {{ src: ScaleSrc::{}, per: {}, step: {}, cap: {} }})".format(
            SCALE_SRC[e["src"]], NUM(e["per"]), NUM(e["step"]), NUM(e["cap"]))
    if k == "onHit":
        return "CardRow::OnHit(OnHitRow {{ status: StatusKind::{}, per: {}, cap: {}, ms: {} }})".format(
            STATUS[e["status"]], NUM(e["per"]), opt_num(e.get("cap")), NUM(e["ms"]))
    if k == "trigger":
        d = e["do"]
        action = trigger_action(d)
        return "CardRow::Trigger(TriggerRow {{ on: TriggerOn::{}, arg: {}, once: {}, action: {} }})".format(
            TRIGGER_ON[e["on"]], NUM(e["arg"]), "true" if e.get("once") else "false", action)
    raise SystemExit("unknown k " + k)

STATUS = {"dot": "Dot", "slowMove": "SlowMove", "stun": "Stun", "hidden": "Hidden", "haste": "Haste", "zoned": "Zoned", "deathFloor": "DeathFloor"}
TRIGGER_ON = {"kill": "Kill", "block": "Block", "hitTaken": "HitTaken", "hit": "Hit", "hpBelow": "HpBelow"}

def trigger_action(d):
    k = d["do"]
    if k == "splash":
        return "TriggerAction::Splash {{ radius: {} }}".format(NUM(d["radius"]))
    if k == "fortify":
        return "TriggerAction::Fortify {{ per: {}, cap: {} }}".format(NUM(d["per"]), NUM(d["cap"]))
    if k == "status":
        to = "Side::Self_" if d.get("to") == "self" else "Side::Target"
        return "TriggerAction::Status {{ to: {}, status: StatusKind::{}, ms: {}, value: {} }}".format(
            to, STATUS[d["status"]], NUM(d["ms"]), opt_num(d.get("value")))
    if k == "boost":
        return "TriggerAction::Boost {{ as_: {}, move_: {}, ms: {} }}".format(NUM(d["as"]), NUM(d["move"]), NUM(d["ms"]))
    if k == "cooldown":
        return "TriggerAction::Cooldown {{ ms: {} }}".format(NUM(d["ms"]))
    if k == "return":
        return "TriggerAction::Return {{ melee: {}, share: {} }}".format("true" if d.get("melee") else "false", NUM(d["share"]))
    if k == "heal":
        return "TriggerAction::Heal {{ share: {}, ms: {}, ignore_lockout: {} }}".format(
            NUM(d["share"]), opt_num(d.get("ms")), "true" if d.get("ignoreLockout") else "false")
    raise SystemExit("unknown trigger do " + k)

FACTION = {"fire": "Fire", "sentenced": "Sentenced", "plague": "Plague", "frost": "Frost", "holy": "Holy"}

def faction_of(s):
    f = s.get("faction")
    if f is None:
        return None
    if isinstance(f, dict) and f.get("$undefined"):
        return None
    return f

def selection_rows(d, sels):
    out = []
    for s in sels:
        fac = faction_of(s)
        if fac is None or fac not in FACTION:
            continue
        if s["rows"] == d.get("effects", []) and s["text"] == d.get("text"):
            continue
        out.append(s)
    return out

def main():
    corpus = json.loads(CORPUS.read_text())
    defs = []
    for c in corpus["cases"]:
        if c.get("family") == "catalog":
            defs.append((c["expected"]["definition"], c["expected"]["selections"]))
    ids = [d["id"] for d, _ in defs]
    out = []
    out.append("//! Generated by tools/card-catalog-fixtures/emit_cards.py from parity/card-catalog/source.json (409 cases).")
    out.append("//! The source corpus is the authority; do not hand-edit. Every row carries its complete typed payload.")
    out.append("")
    out.append("use super::{BaseStatId, CardDef, CardId, CardKind, CardRow, MechanicTag, OnHitRow, ScaleRow, ScaleSrc, Selection, Side, TriggerAction, TriggerOn, TriggerRow, VsRow, VsTest};")
    out.append("use crate::FactionId;")
    out.append("use crate::status_runtime::StatusKind;")
    out.append("use crate::stat_fold::{ConvertFrom, ConvertTo, EffectFlag, EffectKind, EffectStat, FlatStat, MultKey, StatKey, WhileCond, WhileRow};")
    out.append("")
    out.append("pub static DEFINITIONS: [CardDef; {}] = [".format(len(defs)))
    for d, sels in defs:
        rows = ",\n            ".join(row(e) for e in d.get("effects", []))
        tags = ", ".join("MechanicTag::{}".format(TAGS[t]) for t in d.get("tags", []))
        out.append("    CardDef {")
        out.append("        id: CardId::{},".format(pascal(d["id"])))
        out.append("        kind: CardKind::{},".format(KIND[d["kind"]]))
        out.append("        tier: {},".format(d["tier"]))
        out.append("        base: {},".format("None" if "base" not in d else "Some(BaseStatId::{})".format(BASE[d["base"]])))
        out.append("        requires: {},".format("None" if "requires" not in d else "Some(BaseStatId::{})".format(BASE[d["requires"]])))
        out.append("        unique: {},".format("true" if d.get("unique") else "false"))
        out.append("        ready: {},".format("true" if d.get("ready") == "a" else "false"))
        out.append("        title: {},".format(rust_str(d["title"])))
        out.append("        text: {},".format(rust_str(d["text"])))
        out.append("        tags: &[{}],".format(tags))
        out.append("        rows: &[")
        out.append("            {},".format(rows))
        out.append("        ],")
        out.append("        selections: &[")
        for s in selection_rows(d, sels):
            srows = ",\n                ".join(row(e) for e in s["rows"])
            out.append("            Selection {{ faction: FactionId::{}, text: {}, rows: &[{}] }},".format(
                FACTION[faction_of(s)], rust_str(s["text"]), srows))
        out.append("        ],")
        out.append("    },")
    out.append("];")
    OUT.write_text("\n".join(out) + "\n")
    print("cards", len(defs), "->", OUT)

c_order = {}
if __name__ == "__main__":
    main()
