#!/usr/bin/env python3
"""Strictly compare two synthetic determinism-sweep result directories."""

import hashlib
import json
import math
import re
import shlex
from pathlib import Path
import sys


INVENTORY_PATH = Path(__file__).resolve().with_name("inventory-v1.json")
REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
U64_MAX = (1 << 64) - 1
TARGETS = {"x86_64-unknown-linux-gnu", "aarch64-unknown-linux-gnu"}
MAP_PATH = "crates/rh-sim/src/mapdata/fixtures/seed1.map.json"
FULL_FACTION_MODE = "EngagementHolyPlagueFireFrostSentenced"
HEX64 = frozenset("0123456789abcdef")
HEX256 = frozenset("0123456789abcdef")

MANIFEST_KEYS = {
    "format", "fold_format", "inventory", "engine", "map_inputs", "results",
    "totals", "artifacts",
}
ENGINE_KEYS = {
    "content_hash", "build", "replay_format", "checkpoint_format",
    "observation_version", "policy_contract_version",
}
RESULT_KEYS = {
    "id", "seed", "ticks", "terminated", "truncated", "events",
    "final_state_hash", "state_hash_fold", "event_fold", "fresh_ticks",
    "fresh_compared_ticks", "replay_steps", "checkpoints",
}
CHECKPOINT_KEYS = {
    "step", "tick", "continuation_ticks", "state_hash_fold", "event_fold",
}
TOTAL_KEYS = {
    "scenarios", "ticks", "events", "fresh_ticks", "fresh_compared_ticks",
    "replay_steps", "checkpoint_restores", "continuation_ticks",
}
ARTIFACT_KEYS = {"kind", "scenario", "path", "bytes", "steps", "sha256"}
PROVENANCE_KEYS = {
    "format", "commit", "dirty", "rustc_vv", "cargo_version", "target_triple",
    "execution_arch", "os", "native", "profile", "command", "elapsed_ms",
}
SCENARIO_KEYS = {
    "id", "seed", "arena", "players", "sim", "max_ticks", "checkpoint_steps",
    "expected_stop",
}
INVENTORY_SIM_KEYS = {
    "min_players", "lobby_seconds", "fill_seconds", "pvp_rules",
    "weapon_specials", "faction_mode",
}
SIM_KEYS = INVENTORY_SIM_KEYS | {
    "abilities", "wish_lock_ms", "lifecycle", "hazards", "initial_loot", "mob_mode",
}
REPLAY_KEYS = {
    "format", "content_hash", "build", "match_id", "config", "arena", "secrets",
    "start", "ticks", "hashes",
}


class ComparisonError(Exception):
    def __init__(self, path, message):
        super().__init__(message)
        self.path = path
        self.message = message


def fail(path, message):
    raise ComparisonError(path, message)


def is_int(value):
    return isinstance(value, int) and not isinstance(value, bool)


def require(condition, path, message):
    if not condition:
        fail(path, message)


def exact_keys(value, keys, path):
    require(isinstance(value, dict), path, "expected object")
    actual = set(value)
    require(actual == keys, path, "wrong keys; missing {}, extra {}".format(
        sorted(keys - actual), sorted(actual - keys)))


def string(value, path, nonempty=True):
    require(isinstance(value, str), path, "expected string")
    if nonempty:
        require(bool(value), path, "must not be empty")
    return value


def boolean(value, path):
    require(isinstance(value, bool), path, "expected boolean")
    return value


def uint(value, path, maximum=U64_MAX):
    require(is_int(value), path, "expected integer")
    require(0 <= value <= maximum, path, "integer outside supported range")
    return value


def number(value, path):
    require(is_int(value) or isinstance(value, float), path, "expected number")
    require(not isinstance(value, bool), path, "expected number")
    require(not isinstance(value, float) or math.isfinite(value), path, "nonfinite number")
    return value


def hash64(value, path):
    string(value, path)
    require(len(value) == 16 and set(value) <= HEX64, path,
            "expected fixed-width lowercase 16-digit hexadecimal hash")
    return value


def sha256_hex(value, path):
    string(value, path)
    require(len(value) == 64 and set(value) <= HEX256, path,
            "expected lowercase SHA-256 hexadecimal digest")
    return value


def reject_constant(value):
    raise ValueError("nonfinite JSON number {}".format(value))


def unique_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("duplicate JSON key {!r}".format(key))
        result[key] = value
    return result


def check_numbers(value, path="$"):
    if isinstance(value, float):
        require(math.isfinite(value), path, "nonfinite number")
    elif isinstance(value, list):
        for index, item in enumerate(value):
            check_numbers(item, "{}[{}]".format(path, index))
    elif isinstance(value, dict):
        for key, item in value.items():
            check_numbers(item, "{}.{}".format(path, key))


def rust_source(relative):
    try:
        return (REPOSITORY_ROOT / relative).read_text()
    except OSError as error:
        fail("$.engine", "cannot read authoritative Rust source {}: {}".format(relative, error))


def rust_constant(relative, name):
    source = rust_source(relative)
    match = re.search(r"pub const " + re.escape(name) +
                      r"\s*:\s*(?:&str|u16)\s*=\s*(\"(?:[^\"\\]|\\.)*\"|\d+)\s*;", source)
    require(match is not None, "$.engine", "missing authoritative Rust constant " + name)
    value = match.group(1)
    return json.loads(value) if value.startswith('"') else int(value)


def authoritative_versions():
    return {
        "replay_format": rust_constant("crates/rh-sim/src/replay.rs", "REPLAY_FORMAT"),
        "checkpoint_format": rust_constant("crates/rh-sim/src/checkpoint.rs", "CHECKPOINT_FORMAT"),
        "observation_version": rust_constant("crates/rh-sim/src/observe.rs", "OBSERVATION_VERSION"),
        "policy_contract_version": rust_constant("crates/rh-policy/src/lib.rs", "POLICY_CONTRACT_VERSION"),
    }


def rust_enum_variants(relative, name):
    source = rust_source(relative)
    match = re.search(r"pub enum " + re.escape(name) + r"\s*\{(.*?)\}", source, re.DOTALL)
    require(match is not None, "$.inventory", "missing authoritative Rust enum " + name)
    variants = re.findall(r"^\s*([A-Z][A-Za-z0-9_]*)\s*,\s*$", match.group(1), re.MULTILINE)
    require(bool(variants), "$.inventory", "empty authoritative Rust enum " + name)
    return frozenset(variants)


def factions():
    return rust_enum_variants("crates/rh-sim/src/content.rs", "FactionId")


def faction_modes():
    return rust_enum_variants("crates/rh-sim/src/statics.rs", "FactionMode")


def require_compact_json(text, label):
    path = "$." + label
    require(text.endswith("\n") and not text.endswith("\n\n"), path,
            "expected compact JSON followed by one newline")
    in_string = False
    escaped = False
    for char in text[:-1]:
        if in_string:
            if escaped:
                escaped = False
            elif char == "\\":
                escaped = True
            elif char == '"':
                in_string = False
        elif char == '"':
            in_string = True
        elif char.isspace():
            fail(path, "noncompact JSON whitespace outside a string")


def load_json(path, label, canonical=False):
    try:
        raw = path.read_bytes()
    except OSError as error:
        fail("$.{}".format(label), "cannot read {}: {}".format(path, error))
    require(bool(raw), "$.{}".format(label), "empty JSON file")
    try:
        text = raw.decode("utf-8")
        value = json.loads(text, object_pairs_hook=unique_object,
                           parse_constant=reject_constant)
    except (UnicodeDecodeError, ValueError, json.JSONDecodeError) as error:
        fail("$.{}".format(label), "invalid JSON: {}".format(error))
    check_numbers(value, "$.{}".format(label))
    if canonical:
        require_compact_json(text, label)
    return value, raw


def validate_sim(config, path, full=True):
    exact_keys(config, SIM_KEYS if full else INVENTORY_SIM_KEYS, path)
    uint(config["min_players"], path + ".min_players")
    number(config["lobby_seconds"], path + ".lobby_seconds")
    number(config["fill_seconds"], path + ".fill_seconds")
    require(config["lobby_seconds"] >= 0, path + ".lobby_seconds", "must be nonnegative")
    require(config["fill_seconds"] >= 0, path + ".fill_seconds", "must be nonnegative")
    boolean(config["pvp_rules"], path + ".pvp_rules")
    boolean(config["weapon_specials"], path + ".weapon_specials")
    string(config["faction_mode"], path + ".faction_mode")
    require(config["faction_mode"] in faction_modes(), path + ".faction_mode",
            "unknown faction mode")
    if full:
        for key in ("abilities", "lifecycle", "hazards", "mob_mode"):
            string(config[key], path + "." + key)
        boolean(config["initial_loot"], path + ".initial_loot")
        number(config["wish_lock_ms"], path + ".wish_lock_ms")
        require(config["wish_lock_ms"] >= 0, path + ".wish_lock_ms", "must be nonnegative")


def validate_inventory_scenario(spec, path):
    exact_keys(spec, SCENARIO_KEYS, path)
    string(spec["id"], path + ".id")
    uint(spec["seed"], path + ".seed")
    arena = spec["arena"]
    if arena != "practice":
        exact_keys(arena, {"file"}, path + ".arena")
        exact_keys(arena["file"], {"path"}, path + ".arena.file")
        require(arena["file"]["path"] == MAP_PATH, path + ".arena.file.path",
                "arena is not the admitted map input")
    players = spec["players"]
    require(isinstance(players, list) and players, path + ".players",
            "expected a nonempty ordered player array")
    for index, player in enumerate(players):
        player_path = "{}.players[{}]".format(path, index)
        exact_keys(player, {"profile", "faction", "policy", "cadence"}, player_path)
        string(player["profile"], player_path + ".profile")
        string(player["faction"], player_path + ".faction")
        require(player["faction"] in factions(), player_path + ".faction", "unknown faction")
        require(player["policy"] == "brawler", player_path + ".policy",
                "only the brawler policy is admitted")
        uint(player["cadence"], player_path + ".cadence", (1 << 32) - 1)
        require(player["cadence"] > 0, player_path + ".cadence", "cadence must be positive")
    validate_sim(spec["sim"], path + ".sim", full=False)
    uint(spec["max_ticks"], path + ".max_ticks", (1 << 32) - 1)
    require(spec["max_ticks"] > 0, path + ".max_ticks", "zero-work scenario")
    steps = spec["checkpoint_steps"]
    require(isinstance(steps, list) and steps, path + ".checkpoint_steps",
            "expected nonempty checkpoint step array")
    previous = None
    for index, step in enumerate(steps):
        step_path = "{}.checkpoint_steps[{}]".format(path, index)
        uint(step, step_path)
        require(step < spec["max_ticks"], step_path, "checkpoint outside tick limit")
        require(previous is None or step > previous, step_path,
                "checkpoint steps must be sorted and unique")
        previous = step
    require(spec["expected_stop"] in {"terminal", "truncated"},
            path + ".expected_stop", "unknown expected stop")


def validate_ci_coverage(ci):
    path = "$.inventory.ci"
    required = next((s for s in ci if s["id"] == "practice-truncated-off"), None)
    require(required is not None, path, "missing practice-truncated-off")
    require(required["seed"] == 5 and required["arena"] == "practice" and
            len(required["players"]) == 4 and required["sim"]["faction_mode"] == "Off" and
            required["max_ticks"] == 10 and required["expected_stop"] == "truncated",
            path, "practice-truncated-off does not match its required definition")
    require(any(s["expected_stop"] == "terminal" and s["arena"] == "practice" for s in ci),
            path, "CI lacks a terminal practice case")
    require(any(s["expected_stop"] == "truncated" for s in ci), path,
            "CI lacks a truncated case")
    require(any(s["arena"] == {"file": {"path": MAP_PATH}} for s in ci), path,
            "CI lacks the admitted map case")
    require(any(s["sim"]["faction_mode"] == FULL_FACTION_MODE for s in ci), path,
            "CI lacks the explicit full-faction case")
    require(len({s["seed"] for s in ci}) >= 2 and
            len({len(s["players"]) for s in ci}) >= 2, path,
            "CI requires several seeds and player counts")


def load_inventory(path, preset):
    inventory, _ = load_json(path, "inventory")
    exact_keys(inventory, {"format", "ci", "soak"}, "$.inventory")
    require(inventory["format"] == "rh-determinism-inventory/1", "$.inventory.format",
            "unsupported inventory format")
    for name in ("ci", "soak"):
        scenarios = inventory[name]
        require(isinstance(scenarios, list) and scenarios, "$.inventory." + name,
                "inventory preset must be nonempty")
        ids = set()
        for index, spec in enumerate(scenarios):
            scenario_path = "$.inventory.{}[{}]".format(name, index)
            validate_inventory_scenario(spec, scenario_path)
            require(spec["id"] not in ids, scenario_path + ".id", "duplicate scenario id")
            ids.add(spec["id"])
    validate_ci_coverage(inventory["ci"])
    require(len(inventory["soak"]) >= len(inventory["ci"]) and
            inventory["soak"][:len(inventory["ci"])] == inventory["ci"],
            "$.inventory.soak", "soak must begin with the CI inventory verbatim")
    return inventory[preset]


def validate_engine(engine, path):
    exact_keys(engine, ENGINE_KEYS, path)
    hash64(engine["content_hash"], path + ".content_hash")
    string(engine["build"], path + ".build")
    expected = authoritative_versions()
    for key, value in expected.items():
        require(engine[key] == value, path + "." + key,
                "engine version differs from authoritative Rust constant")


def expected_map_inputs(scenarios):
    result = []
    seen = set()
    for spec in scenarios:
        if spec["arena"] != "practice":
            path = spec["arena"]["file"]["path"]
            if path not in seen:
                seen.add(path)
                result.append(path)
    return result


def validate_map_inputs(inputs, scenarios, path):
    require(isinstance(inputs, list), path, "expected array")
    paths = expected_map_inputs(scenarios)
    require(len(inputs) == len(paths), path, "wrong map input count")
    for index, (entry, expected_path) in enumerate(zip(inputs, paths)):
        entry_path = "{}[{}]".format(path, index)
        exact_keys(entry, {"path", "sha256"}, entry_path)
        require(entry["path"] == expected_path, entry_path + ".path",
                "map input does not match inventory order")
        sha256_hex(entry["sha256"], entry_path + ".sha256")
        disk_path = REPOSITORY_ROOT / expected_path
        try:
            digest = hashlib.sha256(disk_path.read_bytes()).hexdigest()
        except OSError as error:
            fail(entry_path + ".path", "cannot read admitted map: {}".format(error))
        require(entry["sha256"] == digest, entry_path + ".sha256",
                "map checksum does not match admitted file")


def validate_result(result, spec, path):
    validate_inventory_scenario(spec, path + ".scenario")
    exact_keys(result, RESULT_KEYS, path)
    require(result["id"] == spec["id"], path + ".id", "scenario id mismatch")
    require(result["seed"] == spec["seed"], path + ".seed", "scenario seed mismatch")
    uint(result["seed"], path + ".seed")
    ticks = uint(result["ticks"], path + ".ticks")
    require(ticks > 0, path + ".ticks", "zero-work result")
    require(ticks <= spec["max_ticks"], path + ".ticks", "exceeds scenario tick limit")
    terminated = boolean(result["terminated"], path + ".terminated")
    truncated = boolean(result["truncated"], path + ".truncated")
    require(terminated != truncated, path, "exactly one of terminated/truncated must be true")
    if spec["expected_stop"] == "terminal":
        require(terminated, path + ".terminated", "expected genuine terminal result")
    else:
        require(truncated and ticks == spec["max_ticks"], path + ".truncated",
                "truncated result must consume exactly max_ticks")
    uint(result["events"], path + ".events")
    hash64(result["final_state_hash"], path + ".final_state_hash")
    hash64(result["state_hash_fold"], path + ".state_hash_fold")
    hash64(result["event_fold"], path + ".event_fold")
    uint(result["fresh_ticks"], path + ".fresh_ticks")
    uint(result["fresh_compared_ticks"], path + ".fresh_compared_ticks")
    uint(result["replay_steps"], path + ".replay_steps")
    require(result["fresh_ticks"] == 2 * ticks, path + ".fresh_ticks",
            "two fresh environments must each execute every tick")
    require(result["fresh_compared_ticks"] == ticks, path + ".fresh_compared_ticks",
            "every tick must be compared")
    require(result["replay_steps"] == ticks, path + ".replay_steps",
            "replay step count differs from scenario ticks")
    checkpoints = result["checkpoints"]
    require(isinstance(checkpoints, list), path + ".checkpoints", "expected array")
    require(len(checkpoints) == len(spec["checkpoint_steps"]), path + ".checkpoints",
            "checkpoint count differs from inventory")
    for index, (checkpoint, expected_step) in enumerate(
            zip(checkpoints, spec["checkpoint_steps"])):
        checkpoint_path = "{}.checkpoints[{}]".format(path, index)
        exact_keys(checkpoint, CHECKPOINT_KEYS, checkpoint_path)
        step = uint(checkpoint["step"], checkpoint_path + ".step")
        tick = uint(checkpoint["tick"], checkpoint_path + ".tick")
        continuation = uint(checkpoint["continuation_ticks"],
                            checkpoint_path + ".continuation_ticks")
        require(step == expected_step, checkpoint_path + ".step",
                "checkpoint steps are missing, duplicate, or reordered")
        require(tick > 0, checkpoint_path + ".tick", "checkpoint tick must be positive")
        require(step < ticks, checkpoint_path + ".step", "checkpoint beyond recorded result")
        require(continuation == ticks - step - 1, checkpoint_path + ".continuation_ticks",
                "continuation must cover the exact expected suffix")
        hash64(checkpoint["state_hash_fold"], checkpoint_path + ".state_hash_fold")
        hash64(checkpoint["event_fold"], checkpoint_path + ".event_fold")
        if continuation == 0:
            empty = "{:016x}".format(fold_all([]))
            require(checkpoint["state_hash_fold"] == empty,
                    checkpoint_path + ".state_hash_fold", "empty continuation fold mismatch")
            require(checkpoint["event_fold"] == empty, checkpoint_path + ".event_fold",
                    "empty continuation event fold mismatch")


def validate_checkpoint_timing(result, path, initial_tick):
    for index, checkpoint in enumerate(result["checkpoints"]):
        require(checkpoint["tick"] == initial_tick + checkpoint["step"] + 1,
                path + ".checkpoints[{}].tick".format(index),
                "checkpoint tick differs from the replay start form")


def validate_empty_event_folds(result, path, initial_tick):
    if result["events"] != 0:
        return
    ticks = range(initial_tick + 1, initial_tick + result["ticks"] + 1)
    expected = "{:016x}".format(fold_all(fold_all([tick]) for tick in ticks))
    require(result["event_fold"] == expected, path + ".event_fold",
            "event-free scenario fold mismatch")
    for index, checkpoint in enumerate(result["checkpoints"]):
        first = checkpoint["tick"] + 1
        ticks = range(first, first + checkpoint["continuation_ticks"])
        expected = "{:016x}".format(fold_all(fold_all([tick]) for tick in ticks))
        require(checkpoint["event_fold"] == expected,
                path + ".checkpoints[{}].event_fold".format(index),
                "event-free continuation fold mismatch")


def validate_totals(totals, results, path):
    exact_keys(totals, TOTAL_KEYS, path)
    for key in TOTAL_KEYS:
        uint(totals[key], path + "." + key)
    expected = {
        "scenarios": len(results),
        "ticks": sum(r["ticks"] for r in results),
        "events": sum(r["events"] for r in results),
        "fresh_ticks": sum(r["fresh_ticks"] for r in results),
        "fresh_compared_ticks": sum(r["fresh_compared_ticks"] for r in results),
        "replay_steps": sum(r["replay_steps"] for r in results),
        "checkpoint_restores": sum(len(r["checkpoints"]) for r in results),
        "continuation_ticks": sum(c["continuation_ticks"] for r in results
                                  for c in r["checkpoints"]),
    }
    for key in sorted(TOTAL_KEYS):
        require(totals[key] == expected[key], path + "." + key,
                "total does not equal the sum of actual result counters")


def validate_artifacts(artifacts, results, path):
    require(isinstance(artifacts, list), path, "expected array")
    require(len(artifacts) == 1, path, "exactly one synthetic replay artifact is required")
    artifact = artifacts[0]
    exact_keys(artifact, ARTIFACT_KEYS, path + "[0]")
    require(artifact["kind"] == "replay", path + "[0].kind", "unknown artifact kind")
    scenario = string(artifact["scenario"], path + "[0].scenario")
    require(any(r["id"] == scenario for r in results), path + "[0].scenario",
            "artifact references an unknown scenario")
    require(artifact["path"] == "replay.json", path + "[0].path",
            "synthetic replay path must be replay.json")
    uint(artifact["bytes"], path + "[0].bytes")
    require(artifact["bytes"] > 0, path + "[0].bytes", "empty replay artifact")
    uint(artifact["steps"], path + "[0].steps")
    sha256_hex(artifact["sha256"], path + "[0].sha256")
    result = next(r for r in results if r["id"] == scenario)
    require(artifact["steps"] == result["replay_steps"], path + "[0].steps",
            "artifact steps differ from its scenario")
    return artifact


def validate_manifest(manifest, scenarios):
    exact_keys(manifest, MANIFEST_KEYS, "$.manifest")
    require(manifest["format"] == "rh-determinism-manifest/1", "$.manifest.format",
            "unsupported manifest format")
    require(manifest["fold_format"] == "rh-determinism-fold/1", "$.manifest.fold_format",
            "unsupported fold format")
    exact_keys(manifest["inventory"], {"format", "preset", "scenarios"},
               "$.manifest.inventory")
    require(manifest["inventory"]["format"] == "rh-determinism-inventory/1",
            "$.manifest.inventory.format", "inventory format mismatch")
    string(manifest["inventory"]["preset"], "$.manifest.inventory.preset")
    embedded = manifest["inventory"]["scenarios"]
    require(isinstance(embedded, list) and embedded, "$.manifest.inventory.scenarios",
            "embedded scenario inventory must be a nonempty array")
    require(len(embedded) == len(scenarios), "$.manifest.inventory.scenarios",
            "wrong embedded inventory scenario count")
    for index, (actual, expected) in enumerate(zip(embedded, scenarios)):
        path = "$.manifest.inventory.scenarios[{}]".format(index)
        validate_inventory_scenario(actual, path)
        require(actual == expected, path, "embedded ScenarioSpec differs from external inventory")
    validate_engine(manifest["engine"], "$.manifest.engine")
    validate_map_inputs(manifest["map_inputs"], scenarios, "$.manifest.map_inputs")
    results = manifest["results"]
    require(isinstance(results, list) and results, "$.manifest.results",
            "empty or missing results are not a successful verification")
    require(len(results) == len(scenarios), "$.manifest.results",
            "missing, duplicate, reordered, or extra scenarios")
    for index, (result, spec) in enumerate(zip(results, scenarios)):
        validate_result(result, spec, "$.manifest.results[{}]".format(index))
    validate_totals(manifest["totals"], results, "$.manifest.totals")
    artifact = validate_artifacts(manifest["artifacts"], results, "$.manifest.artifacts")
    for index, result in enumerate(results):
        if result["id"] != artifact["scenario"]:
            path = "$.manifest.results[{}]".format(index)
            validate_checkpoint_timing(result, path, 1)
            validate_empty_event_folds(result, path, 1)
    return artifact


def fold_all(values):
    mask = U64_MAX
    h = 0x6A09E667F3BCC908
    for value in values:
        h = ((((h << 5) | (h >> 59)) & mask) ^ value)
        h = (h * 0x9E3779B97F4A7C15) & mask
    z = h
    z = ((z ^ (z >> 30)) * 0xBF58476D1CE4E5B9) & mask
    z = ((z ^ (z >> 27)) * 0x94D049BB133111EB) & mask
    return z ^ (z >> 31)


def validate_vec2(value, path):
    exact_keys(value, {"x", "y"}, path)
    number(value["x"], path + ".x")
    number(value["y"], path + ".y")


def expected_practice_arena():
    source = rust_source("crates/rh-sim/src/arenas.rs")
    dimensions = re.search(r"let \(w, h\) = \((\d+)usize,\s*(\d+)usize\);", source)
    require(dimensions is not None, "$.replay.arena", "cannot read practice dimensions")
    width, height = int(dimensions.group(1)), int(dimensions.group(2))
    spawn_block = re.search(r"let spawns = \[(.*?)\]\s*\.iter\(\)", source, re.DOTALL)
    require(spawn_block is not None, "$.replay.arena", "cannot read practice spawns")
    spawn_tiles = [(int(x), int(y)) for x, y in
                   re.findall(r"\((\d+),\s*(\d+)\)", spawn_block.group(1))]
    constants = rust_source("crates/rh-sim/src/constants.rs")
    tile_match = re.search(r"\bTILE:\s*f64\s*=\s*([0-9.]+)", constants)
    require(tile_match is not None, "$.replay.arena", "cannot read authoritative TILE")
    tile_size = float(tile_match.group(1))
    tiles = []
    for y in range(height):
        for x in range(width):
            edge = x == 0 or y == 0 or x == width - 1 or y == height - 1
            pillar = x % 12 == 6 and 4 <= y % 10 <= 6
            fence = x == 24 and 12 <= y <= 19
            tiles.append(1 if edge or pillar else 2 if fence else 0)
    spawns = [{"x": x * tile_size + tile_size / 2.0,
               "y": y * tile_size + tile_size / 2.0} for x, y in spawn_tiles]
    return {"map": {"w": width, "h": height, "tiles": tiles, "layers": None},
            "spawns": spawns}


def expected_file_arena():
    exported, _ = load_json(REPOSITORY_ROOT / MAP_PATH, "admitted_map")
    require(exported.get("format") == "rh-map/2", "$.replay.arena",
            "admitted map has wrong format")
    source = exported["map"]
    data = {key: value for key, value in source.items() if key != "tiles"}
    return {
        "map": {"w": source["w"], "h": source["h"], "tiles": source["tiles"],
                "layers": {"legacyMapHashU32": exported["legacyMapHashU32"], "data": data}},
        "spawns": source["spawns"],
    }


def validate_arena(arena, path, spec):
    exact_keys(arena, {"map", "spawns"}, path)
    tile_map = arena["map"]
    exact_keys(tile_map, {"w", "h", "tiles", "layers"}, path + ".map")
    width = uint(tile_map["w"], path + ".map.w", (1 << 32) - 1)
    height = uint(tile_map["h"], path + ".map.h", (1 << 32) - 1)
    require(width > 0 and height > 0, path + ".map", "zero-sized replay map")
    tiles = tile_map["tiles"]
    require(isinstance(tiles, list), path + ".map.tiles", "expected array")
    require(len(tiles) == width * height, path + ".map.tiles", "replay map shape mismatch")
    for index, tile in enumerate(tiles):
        uint(tile, "{}.map.tiles[{}]".format(path, index), 255)
    require(isinstance(arena["spawns"], list), path + ".spawns", "expected array")
    for index, spawn in enumerate(arena["spawns"]):
        validate_vec2(spawn, "{}.spawns[{}]".format(path, index))
    expected = expected_practice_arena() if spec["arena"] == "practice" else expected_file_arena()
    require(arena == expected, path, "replay arena differs from the selected scenario arena")


def validate_replay_start(start, path, spec, arena):
    if start == "Lobby":
        return
    exact_keys(start, {"Active"}, path)
    exact_keys(start["Active"], {"placements"}, path + ".Active")
    placements = start["Active"]["placements"]
    require(isinstance(placements, list), path + ".Active.placements", "expected array")
    require(len(placements) == len(spec["players"]), path + ".Active.placements",
            "Active roster length differs from scenario")
    keys = {"profile", "faction", "bot", "at", "hp", "weapon0", "weapon1"}
    spawns = arena["spawns"]
    for index, (placement, player) in enumerate(zip(placements, spec["players"])):
        placement_path = "{}.Active.placements[{}]".format(path, index)
        exact_keys(placement, keys, placement_path)
        if spawns:
            at = spawns[(index * 7 + spec["seed"]) % len(spawns)]
        else:
            tile_map = arena["map"]
            at = {"x": (tile_map["w"] // 2) * 32.0 + 16.0,
                  "y": (tile_map["h"] // 2) * 32.0 + 16.0}
        expected = {"profile": player["profile"], "faction": player["faction"], "bot": True,
                    "at": at, "hp": None, "weapon0": None, "weapon1": None}
        require(placement == expected, placement_path,
                "Active placement differs from ordered scenario roster/spawn")


def validate_replay(replay, raw, artifact, manifest, scenarios):
    path = "$.replay"
    exact_keys(replay, REPLAY_KEYS, path)
    result_index = next(i for i, r in enumerate(manifest["results"])
                        if r["id"] == artifact["scenario"])
    result = manifest["results"][result_index]
    spec = scenarios[result_index]
    result_path = "$.manifest.results[{}]".format(result_index)
    require(replay["format"] == manifest["engine"]["replay_format"], path + ".format",
            "replay format differs from manifest engine")
    uint(replay["content_hash"], path + ".content_hash")
    require(replay["content_hash"] == int(manifest["engine"]["content_hash"], 16),
            path + ".content_hash", "replay content differs from manifest engine")
    require(replay["build"] == manifest["engine"]["build"], path + ".build",
            "replay build differs from manifest engine")
    require(replay["match_id"] is None or isinstance(replay["match_id"], str),
            path + ".match_id", "expected null or string")
    validate_sim(replay["config"], path + ".config")
    for key, value in spec["sim"].items():
        require(replay["config"].get(key) == value, path + ".config." + key,
                "replay config differs from inventory scenario")
    validate_arena(replay["arena"], path + ".arena", spec)
    exact_keys(replay["secrets"], {"order_salt", "spawn_seed", "reward_salt"}, path + ".secrets")
    uint(replay["secrets"]["order_salt"], path + ".secrets.order_salt", (1 << 32) - 1)
    uint(replay["secrets"]["spawn_seed"], path + ".secrets.spawn_seed", (1 << 32) - 1)
    require(isinstance(replay["secrets"]["reward_salt"], list)
            and len(replay["secrets"]["reward_salt"]) == 4,
            path + ".secrets.reward_salt", "expected four u32 values")
    for i, value in enumerate(replay["secrets"]["reward_salt"]):
        uint(value, path + ".secrets.reward_salt[{}]".format(i), (1 << 32) - 1)
    validate_replay_start(replay["start"], path + ".start", spec, replay["arena"])
    initial_tick = 0 if replay["start"] == "Lobby" else 1
    hashes = replay["hashes"]
    require(isinstance(hashes, list) and hashes, path + ".hashes",
            "replay must contain nonempty step hashes")
    require(len(hashes) == artifact["steps"], path + ".hashes",
            "truncated replay or wrong artifact step count")
    for index, value in enumerate(hashes):
        uint(value, "{}.hashes[{}]".format(path, index))
    ticks = replay["ticks"]
    require(isinstance(ticks, list), path + ".ticks", "expected array")
    previous = initial_tick
    last_tick = initial_tick + len(hashes)
    for index, tick in enumerate(ticks):
        tick_path = "{}.ticks[{}]".format(path, index)
        exact_keys(tick, {"tick", "inputs"}, tick_path)
        value = uint(tick["tick"], tick_path + ".tick", (1 << 32) - 1)
        require(value > previous, tick_path + ".tick",
                "replay ticks are stale or not strictly ordered")
        require(value <= last_tick, tick_path + ".tick", "replay tick is never consumed")
        require(isinstance(tick["inputs"], list) and tick["inputs"], tick_path + ".inputs",
                "recorded replay tick must contain inputs")
        previous = value
    expected_fold = "{:016x}".format(fold_all(hashes))
    require(result["state_hash_fold"] == expected_fold, result_path + ".state_hash_fold",
            "replay state fold mismatch")
    require(result["final_state_hash"] == "{:016x}".format(hashes[-1]),
            result_path + ".final_state_hash", "replay final state hash mismatch")
    validate_checkpoint_timing(result, result_path, initial_tick)
    validate_empty_event_folds(result, result_path, initial_tick)
    for index, checkpoint in enumerate(result["checkpoints"]):
        suffix = hashes[checkpoint["step"] + 1:]
        require(len(suffix) == checkpoint["continuation_ticks"],
                result_path + ".checkpoints[{}].continuation_ticks".format(index),
                "checkpoint suffix length mismatch")
        expected = "{:016x}".format(fold_all(suffix))
        require(checkpoint["state_hash_fold"] == expected,
                result_path + ".checkpoints[{}].state_hash_fold".format(index),
                "checkpoint continuation state fold mismatch")
    require(artifact["bytes"] == len(raw), "$.manifest.artifacts[0].bytes",
            "artifact byte count mismatch")
    require(artifact["sha256"] == hashlib.sha256(raw).hexdigest(),
            "$.manifest.artifacts[0].sha256", "artifact SHA-256 mismatch")


def recorded_command(value, preset):
    path = "$.provenance.command"
    try:
        tokens = shlex.split(value)
    except ValueError as error:
        fail(path, "malformed recorded command: {}".format(error))
    direct = len(tokens) == 4 and tokens[1:] == [preset, "--out", tokens[3]] and tokens[3]
    cargo_prefix = ["cargo", "run", "--release", "--locked", "-p", "rh-headless",
                    "--bin", "determinism_sweep", "--"]
    wrapped = (len(tokens) == 12 and tokens[:9] == cargo_prefix and
               tokens[9:] == [preset, "--out", tokens[11]] and tokens[11])
    require(direct or wrapped, path,
            "expected the direct binary or literal Cargo wrapper with the matching preset")
    return tokens


def validate_provenance(provenance, target, preset):
    path = "$.provenance"
    exact_keys(provenance, PROVENANCE_KEYS, path)
    require(provenance["format"] == "rh-determinism-provenance/1", path + ".format",
            "unsupported provenance format")
    string(provenance["commit"], path + ".commit")
    require(len(provenance["commit"]) == 40 and set(provenance["commit"]) <= HEX256,
            path + ".commit", "expected full lowercase Git commit")
    require(provenance["dirty"] is False, path + ".dirty", "comparison requires a clean tree")
    string(provenance["rustc_vv"], path + ".rustc_vv")
    string(provenance["cargo_version"], path + ".cargo_version")
    require(provenance["target_triple"] == target, path + ".target_triple",
            "target does not match declared command-line target")
    require(provenance["execution_arch"] == target.split("-", 1)[0],
            path + ".execution_arch", "execution architecture differs from target")
    require(provenance["os"] == "linux", path + ".os", "comparison requires native Linux")
    require(provenance["native"] is True, path + ".native",
            "emulated or unknown execution is not native proof")
    require(provenance["profile"] == "release", path + ".profile",
            "comparison requires release profile")
    string(provenance["command"], path + ".command")
    recorded_command(provenance["command"], preset)
    uint(provenance["elapsed_ms"], path + ".elapsed_ms")


def first_difference(left, right, path="$"):
    if type(left) is not type(right):
        fail(path, "different JSON types")
    if isinstance(left, dict):
        if list(left) != list(right):
            fail(path, "different object keys or key order")
        for key in left:
            first_difference(left[key], right[key], path + "." + key)
    elif isinstance(left, list):
        if len(left) != len(right):
            fail(path, "different array lengths")
        for index, (a, b) in enumerate(zip(left, right)):
            first_difference(a, b, "{}[{}]".format(path, index))
    elif left != right:
        fail(path, "values differ: {!r} != {!r}".format(left, right))


def without_rust_host(value):
    return ["host: <architecture-dependent>" if line.startswith("host:") else line
            for line in value.splitlines()]


def normalized_command(value, preset):
    tokens = recorded_command(value, preset)
    tokens[-1] = "<OUT>"
    return tokens


def compare_provenance(left, right, preset):
    for key in ("format", "commit", "dirty", "cargo_version", "os", "native", "profile"):
        if left[key] != right[key]:
            fail("$.provenance." + key, "provenance values differ")
    if without_rust_host(left["rustc_vv"]) != without_rust_host(right["rustc_vv"]):
        fail("$.provenance.rustc_vv", "toolchain differs beyond the host line")
    if normalized_command(left["command"], preset) != normalized_command(
            right["command"], preset):
        fail("$.provenance.command", "commands differ beyond the --out argument")


def validate_directory(directory, scenarios, preset, target):
    manifest, _ = load_json(directory / "manifest.json", "manifest", canonical=True)
    artifact = validate_manifest(manifest, scenarios)
    if manifest["inventory"]["preset"] != preset:
        fail("$.manifest.inventory.preset", "manifest preset does not match comparison preset")
    replay_path = directory / "replay.json"
    replay, raw = load_json(replay_path, "replay", canonical=True)
    validate_replay(replay, raw, artifact, manifest, scenarios)
    provenance, _ = load_json(directory / "provenance.json", "provenance", canonical=True)
    validate_provenance(provenance, target, preset)
    return manifest, provenance, raw


def compare_directories(left_dir, right_dir, preset, left_target, right_target,
                        inventory_path=INVENTORY_PATH):
    require(preset in {"ci", "soak"}, "$.preset", "unknown preset")
    require(left_target in TARGETS and right_target in TARGETS, "$.targets",
            "targets must be native Linux x86_64 and aarch64 triples")
    require(left_target != right_target, "$.targets", "comparison targets must be distinct")
    scenarios = load_inventory(Path(inventory_path), preset)
    left = validate_directory(Path(left_dir), scenarios, preset, left_target)
    right = validate_directory(Path(right_dir), scenarios, preset, right_target)
    first_difference(left[0], right[0], "$.manifest")
    compare_provenance(left[1], right[1], preset)
    if left[2] != right[2]:
        fail("$.replay", "replay bytes differ")
    return len(scenarios)


def parse_args(argv):
    if len(argv) != 8:
        raise ValueError("usage: compare.py LEFT_DIR RIGHT_DIR --preset ci|soak "
                         "--left-target TRIPLE --right-target TRIPLE")
    left, right = argv[0], argv[1]
    if left.startswith("--") or right.startswith("--"):
        raise ValueError("left and right directories must come first")
    options = {}
    for index in range(2, 8, 2):
        key, value = argv[index], argv[index + 1]
        if key not in {"--preset", "--left-target", "--right-target"}:
            raise ValueError("unknown argument {}".format(key))
        if key in options:
            raise ValueError("duplicate argument {}".format(key))
        if value.startswith("--"):
            raise ValueError("missing value for {}".format(key))
        options[key] = value
    if set(options) != {"--preset", "--left-target", "--right-target"}:
        raise ValueError("missing required argument")
    return left, right, options["--preset"], options["--left-target"], options["--right-target"]


def main(argv=None):
    argv = sys.argv[1:] if argv is None else argv
    try:
        left, right, preset, left_target, right_target = parse_args(argv)
        count = compare_directories(left, right, preset, left_target, right_target)
    except ValueError as error:
        print("argument error: {}".format(error), file=sys.stderr)
        return 2
    except ComparisonError as error:
        print("mismatch at {}: {}".format(error.path, error.message), file=sys.stderr)
        return 1
    print("ok: {} {} scenarios match; replay bytes are identical".format(preset, count))
    return 0


if __name__ == "__main__":
    sys.exit(main())
