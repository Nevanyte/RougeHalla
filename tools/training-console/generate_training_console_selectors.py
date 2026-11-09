#!/usr/bin/env python3
"""Generate the Unity training console's presentation-only selector mirror from pinned source catalogs."""
from __future__ import annotations

import hashlib
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
MOB_RS = "crates/rh-sim/src/mob_catalog/mod.rs"
REWARD_RS = "crates/rh-sim/src/reward_chests/pools.rs"
CARD_RS = "crates/rh-sim/src/cards/catalog.rs"
MOB_TS = "packages/shared/src/mobs.ts"
CARDS_TS = "packages/shared/src/cards.ts"
TRAIN_TS = "packages/shared/src/training.ts"
MOB_STATS_TS = "packages/shared/src/mobStats.ts"
SERVER_INPUTS_TS = "packages/server/src/sim/inputs.ts"
ZERO_STAT_MUTANT = "tools/training-fixtures/mutants/07-stat-zero-door-accepted.patch"
FARM_RS = "crates/rh-sim/src/modifiers/farm.rs"
VIEWS_CS = "client-unity/UnityProject/Assets/RoguehallaNet/Net/Views.cs"
CARD_DISPLAY_CS = "client-unity/UnityProject/Assets/Scripts/UI/CardDisplayCatalog.cs"
OUT_CS = "client-unity/UnityProject/Assets/Scripts/UI/TrainingConsoleSelectors.cs"
OUT_PINS = "tools/training-console/training-console-source-pins.json"
BASE_REVISION = "3126e5c3209334c637d1f067f3f0b8209dbf06f4"


def read(rel: str) -> str:
    return (ROOT / rel).read_text(encoding="utf-8")


def digest(rel: str) -> str:
    return hashlib.sha256((ROOT / rel).read_bytes()).hexdigest()


def array_body(text: str, marker: str) -> str:
    marker_at = text.index(marker)
    start = marker_at + len(marker)
    opening = start - 1 if marker.endswith("[") else text.index("[", start)
    depth = 0
    for i in range(opening, len(text)):
        if text[i] == "[":
            depth += 1
        elif text[i] == "]":
            depth -= 1
            if depth == 0:
                return text[opening + 1:i]
    raise ValueError(f"unterminated array after {marker!r}")


def rust_as_str(text: str, method_marker: str, enum_name: str) -> dict[str, str]:
    start = text.index(method_marker)
    opening = text.index("{", start)
    depth = 0
    for i in range(opening, len(text)):
        if text[i] == "{":
            depth += 1
        elif text[i] == "}":
            depth -= 1
            if depth == 0:
                body = text[opening + 1:i]
                break
    else:
        raise ValueError(f"unterminated string conversion method {method_marker!r}")
    return {variant: value for variant, value in re.findall(r'Self::(\w+)\s*=>\s*"([^"]+)"', body)}


def first_variant_block(text: str, marker: str) -> list[str]:
    body = array_body(text, marker)
    return re.findall(r"Self::(\w+)\s*,", body)


def generate() -> tuple[str, dict]:
    mob_rs = read(MOB_RS)
    farm_rs = read(FARM_RS)
    mob_ts = read(MOB_TS)
    views = read(VIEWS_CS)
    card_rs = read(CARD_RS)
    rewards = read(REWARD_RS)
    cards_ts = read(CARDS_TS)
    training_ts = read(TRAIN_TS)
    mob_stats_ts = read(MOB_STATS_TS)
    server_inputs_ts = read(SERVER_INPUTS_TS)
    zero_stat_mutant = read(ZERO_STAT_MUTANT)
    card_display = read(CARD_DISPLAY_CS)

    mob_all = first_variant_block(mob_rs, "pub const ALL: [Self; 30] = [")
    as_str = rust_as_str(mob_rs, "pub fn as_str(self)", "MobTypeId")
    types_start = mob_rs.index("types: [", mob_rs.index("pub static DEFINITION"))
    types_end = mob_rs.index("regions: [", types_start)
    type_defs = re.findall(r"MobTypeDef\s*\{(.*?)\n\s*\}", mob_rs[types_start:types_end], re.S)
    mob_rows: dict[str, tuple[str, str, bool]] = {}
    for body in type_defs:
        variant = re.search(r"id:\s*MobTypeId::(\w+)", body).group(1)
        name = re.search(r'name:\s*"([^"]+)"', body).group(1)
        elite = re.search(r"elite:\s*(true|false)", body).group(1) == "true"
        mob_rows[variant] = (as_str[variant], name, elite)
    if len(mob_all) != 30 or len(mob_rows) != 30 or set(mob_all) != set(mob_rows):
        raise ValueError("Rust mob catalog does not have the expected 30 ID/definition rows")

    unity_enum = re.search(r"enum MobTypeId\s*:\s*byte\s*\{(.*?)\n\s*\}", views, re.S)
    unity_mobs = [(name, int(pos)) for name, pos in re.findall(r"(\w+)\s*=\s*(\d+)\s*,", unity_enum.group(1))]
    if [name for name, _ in unity_mobs] != mob_all or [pos for _, pos in unity_mobs] != list(range(30)):
        raise ValueError("Unity MobTypeId enum no longer mirrors Rust MobTypeId::ALL")
    ts_mobs = re.findall(r'row\("([^"]+)",\s*"[^"]+",\s*(?:true|false),\s*"([^"]+)"', mob_ts)
    if ts_mobs != [(mob_rows[v][0], mob_rows[v][1]) for v in mob_all]:
        raise ValueError("legacy TypeScript MOB_TYPES order/IDs/names diverge from Rust")

    farm_body = array_body(farm_rs[farm_rs.index("pub const DEFINITION:"):], "rows: [")
    farm_variants = re.findall(r"(?:stat|flat)\(M::(\w+),", farm_body)
    reward_start = mob_stats_ts.index("const REWARDS:")
    reward_end = mob_stats_ts.index("};", reward_start)
    ts_reward_ids = re.findall(r"^\s{2}(\w+):\s*\{", mob_stats_ts[reward_start:reward_end], re.M)
    farm_ids = [mob_rows[v][0] for v in farm_variants]
    if len(farm_variants) != 20 or any(mob_rows[v][2] for v in farm_variants):
        raise ValueError("Rust Farm reward rows no longer contain exactly the 20 normal mob types")
    expected_farm_variants = [v for v in mob_all if mob_rows[v][0] in set(ts_reward_ids)]
    if farm_variants != expected_farm_variants or set(farm_ids) != set(ts_reward_ids):
        raise ValueError("legacy normal-mob stat IDs and Rust Farm order diverge")

    card_all = first_variant_block(card_rs, "pub const ALL: [Self; 80] = [")
    card_as_str = rust_as_str(card_rs, "pub const fn as_str(self)", "CardId")
    interactive_body = array_body(rewards, "pub const INTERACTIVE: [CardId; 14] = [")
    interactive_variants = re.findall(r"CardId::(\w+)\s*,", interactive_body)
    ts_interactive_body = array_body(cards_ts, "const INTERACTIVE_AUGMENT_IDS = new Set<string>([")
    ts_interactive_ids = re.findall(r'"([^"]+)"', ts_interactive_body)
    indexed_cards = {variant: pos for pos, variant in enumerate(card_all)}
    if len(card_all) != 80 or len(interactive_variants) != 14:
        raise ValueError("Rust card catalog or interactive whitelist count changed")
    interactive_ids = [card_as_str[v] for v in interactive_variants]
    if interactive_ids != ts_interactive_ids:
        raise ValueError("legacy and Rust interactive card order/IDs diverge")

    entries_start = card_display.index("static readonly Entry[] Entries =")
    entries_end = card_display.index("        };", entries_start)
    display_ids = re.findall(r'new Entry\("([^"]+)"', card_display[entries_start:entries_end])
    if len(display_ids) != 80 or display_ids != card_all:
        raise ValueError("CardDisplayCatalog order/IDs no longer mirror Rust CardId::ALL")
    interactive_indices = [indexed_cards[v] for v in interactive_variants]

    count_match = re.search(r"TRAIN_CARD_COUNT_CHOICES:\s*readonly number\[\]\s*=\s*\[([^\]]+)\]", training_ts)
    max_match = re.search(r"TRAIN_MAX_CARD_COUNT\s*=\s*(\d+)", training_ts)
    maximum = int(max_match.group(1))
    choices = [maximum if v.strip() == "TRAIN_MAX_CARD_COUNT" else int(v.strip())
               for v in count_match.group(1).split(",") if v.strip()]
    if choices[-1] != maximum:
        raise ValueError("shared training count choices do not end at the source maximum")
    choices.append(0)  # The source console uses zero as its explicit Remove choice.

    mob_max_match = re.search(r"TRAIN_MAX_MOB_STAT_COUNT\s*=\s*Number\.MAX_SAFE_INTEGER", training_ts)
    mob_stat_max_match = re.search(r"MOB_STAT_COUNT_MAX\s*=\s*Number\.MAX_SAFE_INTEGER", mob_stats_ts)
    if not mob_max_match or not mob_stat_max_match:
        raise ValueError("shared mob-stat count limit no longer uses JavaScript's safe-integer bound")
    max_safe = 9007199254740991
    input_rs_rel = "crates/rh-sim/src/input.rs"
    input_rs = read(input_rs_rel)
    if "2 if raw.count == 0 => Err(Reject::InvalidTrain)" not in input_rs:
        raise ValueError("expected Rust stat-zero validation changed; review the generated boundary note")
    if "if (raw !== undefined && raw >= 0 && count === 0) return null" not in server_inputs_ts:
        raise ValueError("expected TypeScript stat-zero input rejection changed")
    if "2 if raw.count == 0" not in zero_stat_mutant:
        raise ValueError("stat-zero mutant fixture no longer describes the Rust validator branch")

    src = [MOB_RS, FARM_RS, REWARD_RS, CARD_RS, MOB_TS, CARDS_TS, TRAIN_TS, MOB_STATS_TS,
           SERVER_INPUTS_TS, ZERO_STAT_MUTANT, input_rs_rel, VIEWS_CS, CARD_DISPLAY_CS]
    source_hashes = {rel: digest(rel) for rel in src}
    pins = {
        "schema": 1,
        "baseRevision": BASE_REVISION,
        "generatedFile": OUT_CS,
        "generator": "tools/training-console/generate_training_console_selectors.py",
        "sourceSha256": source_hashes,
        "catalogCounts": {"mobTypes": 30, "interactiveCards": 14, "cards": 80},
        "mobStatIdsInCatalogOrder": farm_ids,
        "mobStatPositionsInCatalogOrder": [mob_all.index(v) for v in farm_variants],
        "interactiveCardIdsInWireOrder": interactive_ids,
        "interactiveCardIndicesInWireOrder": interactive_indices,
        "cardCountChoices": choices,
        "maxSafeInteger": max_safe,
        "sourceBoundary": "The parser accepts zero as a nonnegative safe integer and exposes the requested value without clamping. Current legacy parseTrain rejects an explicitly supplied zero stat count, and Rust validate_train also rejects it; tools/training-fixtures/mutants/07-stat-zero-door-accepted.patch records the inverse Rust mutation.",
    }

    lines = [
        "// Generated by tools/training-console/generate_training_console_selectors.py; do not hand-edit.",
        "// Presentation-only mirrors of pinned Rust catalogs and existing CardDisplayCatalog labels.",
        "using System;",
        "using System.Collections.Generic;",
        "using System.Collections.ObjectModel;",
        "using Roguehalla.Net;",
        "",
        "namespace Roguehalla.Client",
        "{",
        "    public static class TrainingConsoleSelectors",
        "    {",
        "        public const ulong MaxSafeInteger = 9007199254740991UL;",
        "",
        "        public readonly struct MobChoice",
        "        {",
        "            public readonly byte Position;",
        "            public readonly string Id;",
        "            public readonly string Name;",
        "            public MobChoice(byte position, string id, string name) { Position = position; Id = id; Name = name; }",
        "        }",
        "",
        "        static readonly MobChoice[] MobData =",
        "        {",
    ]
    for pos, variant in enumerate(mob_all):
        ident, name, _ = mob_rows[variant]
        lines.append(f"            new MobChoice({pos}, {json.dumps(ident)}, {json.dumps(name)}),")
    lines += ["        };", "        static readonly ReadOnlyCollection<MobChoice> MobView = Array.AsReadOnly(MobData);", "        public static IReadOnlyList<MobChoice> MobChoices => MobView;", ""]
    lines += ["        static readonly byte[] InteractiveCardData = { " + ", ".join(str(i) for i in interactive_indices) + " };",
              "        static readonly ReadOnlyCollection<byte> InteractiveCardView = Array.AsReadOnly(InteractiveCardData);",
              "        public static IReadOnlyList<byte> InteractiveCardIndices => InteractiveCardView;", ""]
    lines += ["        static readonly int[] CardCountData = { " + ", ".join(str(i) for i in choices) + " };",
              "        static readonly ReadOnlyCollection<int> CardCountView = Array.AsReadOnly(CardCountData);",
              "        public static IReadOnlyList<int> CardCountChoices => CardCountView;", ""]
    lines += [
        "        /// <summary>Parses a complete ASCII-digit nonnegative integer no greater than JavaScript's exact integer limit.</summary>",
        "        public static bool TryParseNonnegativeSafeInteger(string text, out ulong value)",
        "        {",
        "            value = 0;",
        "            if (string.IsNullOrEmpty(text)) return false;",
        "            ulong parsed = 0;",
        "            for (int i = 0; i < text.Length; i++)",
        "            {",
        "                char c = text[i];",
        "                if (c < '0' || c > '9') return false;",
        "                uint digit = (uint)(c - '0');",
        "                if (parsed > (MaxSafeInteger - digit) / 10UL) return false;",
        "                parsed = parsed * 10UL + digit;",
        "            }",
        "            value = parsed;",
        "            return true;",
        "        }",
        "    }",
        "}",
        "",
    ]
    return "\n".join(lines), pins


def main() -> None:
    source, pins = generate()
    out_cs = ROOT / OUT_CS
    out_pins = ROOT / OUT_PINS
    out_cs.parent.mkdir(parents=True, exist_ok=True)
    out_pins.parent.mkdir(parents=True, exist_ok=True)
    out_cs.write_text(source, encoding="utf-8")
    out_pins.write_text(json.dumps(pins, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"generated {OUT_CS} ({len(source.encode('utf-8'))} bytes)")
    print(f"wrote {OUT_PINS}")


if __name__ == "__main__":
    main()
