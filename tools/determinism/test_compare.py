#!/usr/bin/env python3

import copy
import hashlib
import importlib.util
import json
import shlex
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest


MODULE_PATH = Path(__file__).resolve().with_name("compare.py")
SPEC = importlib.util.spec_from_file_location("determinism_compare", MODULE_PATH)
compare = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(compare)
SHARED_INVENTORY = Path(__file__).resolve().with_name("inventory-v1.json")


def canonical(value):
    return (json.dumps(value, ensure_ascii=False, allow_nan=False,
                       separators=(",", ":")) + "\n").encode("utf-8")


def hash64(value):
    return "{:016x}".format(value)


def empty_event_fold(initial_tick, first_tick, count):
    ticks = range(first_tick, first_tick + count)
    return hash64(compare.fold_all(compare.fold_all([tick]) for tick in ticks))


class ComparatorTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        self.inventory_path = self.root / "inventory-v1.json"
        self.inventory = json.loads(SHARED_INVENTORY.read_text())
        self.scenarios = self.inventory["ci"]
        self.inventory_path.write_bytes(canonical(self.inventory))
        self.left = self.root / "left"
        self.right = self.root / "right"
        self.write_pair(self.left, "x86_64-unknown-linux-gnu", "x86_64")
        self.write_pair(self.right, "aarch64-unknown-linux-gnu", "aarch64")

    def tearDown(self):
        self.temporary.cleanup()

    def reset(self):
        self.tearDown()
        self.setUp()

    def replay(self):
        spec = self.scenarios[0]
        arena = copy.deepcopy(compare.expected_practice_arena())
        placements = []
        for index, player in enumerate(spec["players"]):
            at = arena["spawns"][(index * 7 + spec["seed"]) % len(arena["spawns"])]
            placements.append({
                "profile": player["profile"], "faction": player["faction"], "bot": True,
                "at": copy.deepcopy(at), "hp": None, "weapon0": None, "weapon1": None,
            })
        return {
            "format": compare.authoritative_versions()["replay_format"],
            "content_hash": 0x0123456789ABCDEF,
            "build": "dev-test",
            "match_id": None,
            "config": copy.deepcopy(spec["sim"]),
            "arena": arena,
            "secrets": {"order_salt": 1, "spawn_seed": 2},
            "start": {"Active": {"placements": placements}},
            "ticks": [{"tick": 2, "inputs": [{"Leave": {"player": 1}}]}],
            "hashes": list(range(1, spec["max_ticks"] + 1)),
        }

    def result(self, spec, hashes):
        ticks = len(hashes)
        checkpoints = []
        for step in spec["checkpoint_steps"]:
            tick = step + 2
            continuation = ticks - step - 1
            checkpoints.append({
                "step": step, "tick": tick, "continuation_ticks": continuation,
                "state_hash_fold": hash64(compare.fold_all(hashes[step + 1:])),
                "event_fold": empty_event_fold(1, tick + 1, continuation),
            })
        return {
            "id": spec["id"], "seed": spec["seed"], "ticks": ticks,
            "terminated": spec["expected_stop"] == "terminal",
            "truncated": spec["expected_stop"] == "truncated", "events": 0,
            "final_state_hash": hash64(hashes[-1]),
            "state_hash_fold": hash64(compare.fold_all(hashes)),
            "event_fold": empty_event_fold(1, 2, ticks),
            "fresh_ticks": ticks * 2, "fresh_compared_ticks": ticks, "replay_steps": ticks,
            "checkpoints": checkpoints,
        }

    def manifest(self):
        results = []
        for index, spec in enumerate(self.scenarios):
            ticks = spec["max_ticks"] if spec["expected_stop"] == "truncated" else 501
            hashes = list(range(1 + index * 1000, 1 + index * 1000 + ticks))
            results.append(self.result(spec, hashes))
        replay_raw = canonical(self.replay())
        map_inputs = []
        for path in compare.expected_map_inputs(self.scenarios):
            map_inputs.append({
                "path": path,
                "sha256": hashlib.sha256((compare.REPOSITORY_ROOT / path).read_bytes()).hexdigest(),
            })
        totals = {"scenarios": len(results)}
        for key in ("ticks", "events", "fresh_ticks", "fresh_compared_ticks", "replay_steps"):
            totals[key] = sum(result[key] for result in results)
        totals["checkpoint_restores"] = sum(len(result["checkpoints"]) for result in results)
        totals["continuation_ticks"] = sum(
            checkpoint["continuation_ticks"] for result in results
            for checkpoint in result["checkpoints"])
        engine = compare.authoritative_versions()
        engine.update(content_hash="0123456789abcdef", build="dev-test")
        return {
            "format": "rh-determinism-manifest/1", "fold_format": "rh-determinism-fold/1",
            "inventory": {"format": "rh-determinism-inventory/1", "preset": "ci",
                          "scenarios": copy.deepcopy(self.scenarios)},
            "engine": engine, "map_inputs": map_inputs, "results": results, "totals": totals,
            "artifacts": [{
                "kind": "replay", "scenario": results[0]["id"], "path": "replay.json",
                "bytes": len(replay_raw), "steps": results[0]["replay_steps"],
                "sha256": hashlib.sha256(replay_raw).hexdigest(),
            }],
        }

    def provenance(self, directory, target, architecture):
        return {
            "format": "rh-determinism-provenance/1",
            "commit": "c7b140a3c94180ae78b0bf164c66ae9f0e1ec8b6", "dirty": False,
            "rustc_vv": "rustc 1.90.0\nhost: {}\nrelease: 1.90.0\n".format(target),
            "cargo_version": "cargo 1.90.0", "target_triple": target,
            "execution_arch": architecture, "os": "linux", "native": True,
            "profile": "release", "command": "determinism_sweep ci --out {}".format(directory),
            "elapsed_ms": 123,
        }

    def write_pair(self, directory, target, architecture):
        directory.mkdir()
        (directory / "replay.json").write_bytes(canonical(self.replay()))
        (directory / "manifest.json").write_bytes(canonical(self.manifest()))
        (directory / "provenance.json").write_bytes(canonical(
            self.provenance(directory, target, architecture)))

    def run_compare(self):
        return compare.compare_directories(
            self.left, self.right, "ci", "x86_64-unknown-linux-gnu",
            "aarch64-unknown-linux-gnu", self.inventory_path)

    def assert_rejected(self):
        with self.assertRaises(compare.ComparisonError):
            self.run_compare()

    def load(self, directory, name):
        return json.loads((directory / name).read_text())

    def save(self, directory, name, value):
        (directory / name).write_bytes(canonical(value))

    def mutate_manifest(self, directory, function):
        value = self.load(directory, "manifest.json")
        function(value)
        self.save(directory, "manifest.json", value)

    def mutate_both_manifests(self, function):
        self.mutate_manifest(self.left, function)
        self.mutate_manifest(self.right, function)

    def mutate_provenance(self, directory, function):
        value = self.load(directory, "provenance.json")
        function(value)
        self.save(directory, "provenance.json", value)

    def mutate_replay(self, directory, function):
        replay = self.load(directory, "replay.json")
        function(replay)
        raw = canonical(replay)
        (directory / "replay.json").write_bytes(raw)
        manifest = self.load(directory, "manifest.json")
        manifest["artifacts"][0].update(bytes=len(raw), sha256=hashlib.sha256(raw).hexdigest())
        self.save(directory, "manifest.json", manifest)

    def mutate_both_replays(self, function):
        self.mutate_replay(self.left, function)
        self.mutate_replay(self.right, function)

    def test_valid_pair_and_only_allowed_provenance_differences_pass(self):
        self.assertEqual(self.run_compare(), 6)
        self.mutate_provenance(self.right, lambda p: p.update(
            elapsed_ms=999999,
            rustc_vv=p["rustc_vv"].replace("aarch64-unknown-linux-gnu", "different-host")))
        self.assertEqual(self.run_compare(), 6)

    def test_literal_cargo_workflow_command_passes(self):
        for directory in (self.left, self.right):
            command = ("cargo run --release --locked -p rh-headless --bin determinism_sweep "
                       "-- ci --out {}".format(shlex.quote(str(directory))))
            self.mutate_provenance(directory, lambda p: p.update(command=command))
        self.assertEqual(self.run_compare(), 6)

    def test_shell_escaped_output_paths_with_spaces_pass(self):
        for directory, name in ((self.left, "left output"), (self.right, "right output")):
            output = self.root / name
            command = "determinism_sweep ci --out {}".format(shlex.quote(str(output)))
            self.mutate_provenance(directory, lambda p: p.update(command=command))
        self.assertEqual(self.run_compare(), 6)

    def test_inventory_admission_and_required_ci_coverage_fail(self):
        mutations = (
            lambda i: i.update(ci=[]),
            lambda i: i["ci"][0].update(max_ticks=11),
            lambda i: i["ci"][1]["players"][0].update(faction="Unknown"),
            lambda i: i["ci"][1]["sim"].update(faction_mode="Unknown"),
            lambda i: i["ci"][4].update(arena={"file": {"path": "other.map.json"}}),
            lambda i: i["ci"][1].update(expected_stop="truncated"),
            lambda i: i["ci"][4].update(arena="practice"),
            lambda i: i["ci"][5]["sim"].update(faction_mode="Off"),
            lambda i: [s.update(seed=5) for s in i["ci"]],
            lambda i: [s.update(players=[s["players"][0]] * 4) for s in i["ci"]],
            lambda i: i["soak"][0].update(seed=999),
        )
        for mutate in mutations:
            with self.subTest(mutate=mutate):
                self.reset()
                mutate(self.inventory)
                self.inventory_path.write_bytes(canonical(self.inventory))
                self.assert_rejected()

    def test_so_inventory_requires_terminal_truncated_and_multiple_counts(self):
        self.assertTrue(any(s["expected_stop"] == "terminal" for s in self.scenarios))
        self.assertTrue(any(s["expected_stop"] == "truncated" for s in self.scenarios))
        self.assertGreaterEqual(len({s["seed"] for s in self.scenarios}), 2)
        self.assertGreaterEqual(len({len(s["players"]) for s in self.scenarios}), 2)

    def test_equally_empty_and_identically_invalid_manifests_fail(self):
        def empty(manifest):
            manifest["results"] = []
            manifest["inventory"]["scenarios"] = []
        self.mutate_both_manifests(empty)
        self.assert_rejected()
        for mutate in (
            lambda m: m.update(format="wrong"),
            lambda m: m.update(fold_format="wrong"),
            lambda m: m["inventory"].update(format="wrong"),
            lambda m: m["inventory"].update(preset="soak"),
            lambda m: m["results"][0].update(ticks="3"),
            lambda m: m["results"][0].update(unexpected=True),
        ):
            with self.subTest(mutate=mutate):
                self.reset()
                self.mutate_both_manifests(mutate)
                self.assert_rejected()

    def test_non_first_embedded_scenario_must_match_external_inventory(self):
        self.mutate_both_manifests(
            lambda m: m["inventory"]["scenarios"][1]["players"][0].update(profile="mutated"))
        self.assert_rejected()

    def test_missing_duplicate_reordered_and_extra_scenarios_fail(self):
        for mutate in (
            lambda m: m["results"].pop(),
            lambda m: m["results"].__setitem__(1, copy.deepcopy(m["results"][0])),
            lambda m: m["results"].reverse(),
            lambda m: m["results"].append(copy.deepcopy(m["results"][1])),
        ):
            with self.subTest(mutate=mutate):
                self.reset()
                self.mutate_manifest(self.right, mutate)
                self.assert_rejected()

    def test_engine_versions_match_authoritative_rust_constants(self):
        for key in ("replay_format", "checkpoint_format", "observation_version",
                    "policy_contract_version"):
            with self.subTest(key=key):
                self.reset()
                self.mutate_both_manifests(lambda m, key=key: m["engine"].update({key: "wrong"}))
                self.assert_rejected()
        self.reset()
        self.mutate_both_manifests(lambda m: m["engine"].update(content_hash="ffffffffffffffff"))
        self.assert_rejected()
        self.reset()
        self.mutate_both_replays(lambda r: r["config"].update(faction_mode="EngagementHoly"))
        self.assert_rejected()

    def test_result_counters_totals_and_fold_changes_fail(self):
        mutations = []
        for key in ("ticks", "events", "fresh_ticks", "fresh_compared_ticks", "replay_steps",
                    "final_state_hash", "state_hash_fold", "event_fold"):
            def result_change(manifest, key=key):
                manifest["results"][1][key] = 99 if key not in {
                    "final_state_hash", "state_hash_fold", "event_fold"
                } else "ffffffffffffffff"
            mutations.append(result_change)
        for key in compare.TOTAL_KEYS:
            mutations.append(lambda m, key=key: m["totals"].__setitem__(key, 99))
        mutations.extend((
            lambda m: m["results"][0]["checkpoints"][0].update(state_hash_fold="f" * 16),
            lambda m: m["results"][1]["checkpoints"][0].update(event_fold="f" * 16),
        ))
        for mutate in mutations:
            with self.subTest(mutate=mutate):
                self.reset()
                self.mutate_manifest(self.right, mutate)
                self.assert_rejected()

    def test_empty_suffix_and_all_event_free_folds_are_recomputed(self):
        for mutate in (
            lambda m: m["results"][0]["checkpoints"][-1].update(state_hash_fold="f" * 16),
            lambda m: m["results"][0]["checkpoints"][-1].update(event_fold="f" * 16),
            lambda m: m["results"][1].update(event_fold="f" * 16),
            lambda m: m["results"][1]["checkpoints"][0].update(event_fold="f" * 16),
        ):
            with self.subTest(mutate=mutate):
                self.reset()
                self.mutate_both_manifests(mutate)
                self.assert_rejected()

    def test_active_and_lobby_checkpoint_ticks_use_actual_start(self):
        self.assertEqual(self.run_compare(), 6)
        self.mutate_both_manifests(lambda m: m["results"][0]["checkpoints"][0].update(tick=5))
        self.assert_rejected()
        self.reset()

        def lobby(replay):
            replay["start"] = "Lobby"
            for tick in replay["ticks"]:
                tick["tick"] -= 1
        self.mutate_both_replays(lobby)
        for directory in (self.left, self.right):
            self.mutate_manifest(directory, lambda m: [
                checkpoint.update(tick=checkpoint["tick"] - 1)
                for checkpoint in m["results"][0]["checkpoints"]])
            self.mutate_manifest(directory, lambda m: m["results"][0].update(
                event_fold=empty_event_fold(0, 1, m["results"][0]["ticks"])))
            self.mutate_manifest(directory, lambda m: [
                checkpoint.update(event_fold=empty_event_fold(
                    0, checkpoint["tick"] + 1, checkpoint["continuation_ticks"]))
                for checkpoint in m["results"][0]["checkpoints"]])
        self.assertEqual(self.run_compare(), 6)

    def test_active_replay_highest_input_tick_and_stale_or_extra_records(self):
        self.mutate_both_replays(lambda r: r["ticks"].append(
            {"tick": len(r["hashes"]) + 1, "inputs": [{"Leave": {"player": 1}}]}))
        self.assertEqual(self.run_compare(), 6)
        for mutate in (
            lambda r: r["ticks"].append({"tick": len(r["hashes"]) + 2, "inputs": [{}]}),
            lambda r: r["ticks"].append({"tick": 1, "inputs": [{}]}),
            lambda r: r["ticks"].append({"tick": 2, "inputs": [{}]}),
            lambda r: r["ticks"].__setitem__(0, {"tick": 2, "inputs": []}),
        ):
            with self.subTest(mutate=mutate):
                self.reset()
                self.mutate_replay(self.left, mutate)
                self.assert_rejected()

    def test_active_roster_is_bound_to_ordered_scenario(self):
        for mutate in (
            lambda r: r["start"]["Active"]["placements"][0].update(profile="substituted"),
            lambda r: r["start"]["Active"]["placements"][0].update(faction="Holy"),
            lambda r: r["start"]["Active"]["placements"][0].update(bot=False),
            lambda r: r["start"]["Active"]["placements"][0]["at"].update(x=1.0),
            lambda r: r["start"]["Active"]["placements"].reverse(),
            lambda r: r["start"]["Active"]["placements"].pop(),
        ):
            with self.subTest(mutate=mutate):
                self.reset()
                self.mutate_both_replays(mutate)
                self.assert_rejected()

    def test_substituted_arena_geometry_spawns_and_layers_fail(self):
        for mutate in (
            lambda r: r["arena"]["map"]["tiles"].__setitem__(0, 0),
            lambda r: r["arena"]["spawns"].reverse(),
            lambda r: r["arena"]["map"].update(layers={"unexpected": True}),
            lambda r: r["arena"]["map"].update(w=47),
        ):
            with self.subTest(mutate=mutate):
                self.reset()
                self.mutate_both_replays(mutate)
                self.assert_rejected()

    def test_admitted_map_arena_is_exactly_bound_to_public_source(self):
        spec = {"arena": {"file": {"path": compare.MAP_PATH}}}
        arena = compare.expected_file_arena()
        compare.validate_arena(arena, "$.replay.arena", spec)
        for mutate in (
            lambda a: a["map"]["tiles"].__setitem__(0, 0),
            lambda a: a["spawns"].reverse(),
            lambda a: a["map"]["layers"]["data"].update(seed=999),
        ):
            with self.subTest(mutate=mutate):
                changed = copy.deepcopy(arena)
                mutate(changed)
                with self.assertRaises(compare.ComparisonError):
                    compare.validate_arena(changed, "$.replay.arena", spec)

    def test_rust_exponent_spelling_is_accepted_but_noncompact_json_is_not(self):
        inventory_raw = canonical(self.inventory).replace(b'"lobby_seconds":30.0',
                                                          b'"lobby_seconds":1e-7')
        self.inventory_path.write_bytes(inventory_raw)
        for directory in (self.left, self.right):
            raw = canonical(self.load(directory, "replay.json")).replace(
                b'"lobby_seconds":30.0', b'"lobby_seconds":1e-7', 1)
            (directory / "replay.json").write_bytes(raw)
            self.mutate_manifest(directory, lambda m: m["artifacts"][0].update(
                bytes=len(raw), sha256=hashlib.sha256(raw).hexdigest()))
            manifest_path = directory / "manifest.json"
            manifest_path.write_bytes(manifest_path.read_bytes().replace(
                b'"lobby_seconds":30.0', b'"lobby_seconds":1e-7'))
        self.assertEqual(self.run_compare(), 6)
        self.reset()
        (self.right / "manifest.json").write_text(json.dumps(self.manifest(), indent=2) + "\n")
        self.assert_rejected()

    def test_missing_truncated_malformed_replays_and_artifacts_fail(self):
        (self.right / "replay.json").unlink()
        self.assert_rejected()
        self.reset()
        raw = (self.right / "replay.json").read_bytes()
        (self.right / "replay.json").write_bytes(raw[:len(raw) // 2])
        self.assert_rejected()
        self.reset()
        (self.right / "replay.json").write_bytes(b"{}\n")
        self.assert_rejected()
        for mutate in (
            lambda r: r.update(hashes=r["hashes"][:-1]),
            lambda r: r.update(hashes=r["hashes"][:-1] + [999]),
            lambda r: r.update(arena={}), lambda r: r.update(start={}),
        ):
            with self.subTest(mutate=mutate):
                self.reset()
                self.mutate_replay(self.left, mutate)
                self.assert_rejected()
        for mutate in (
            lambda m: m.update(artifacts=[]),
            lambda m: m["artifacts"][0].update(bytes=1),
            lambda m: m["artifacts"][0].update(sha256="0" * 64),
            lambda m: m["artifacts"][0].update(path="other.json"),
            lambda m: m["artifacts"].append(copy.deepcopy(m["artifacts"][0])),
        ):
            with self.subTest(mutate=mutate):
                self.reset()
                self.mutate_both_manifests(mutate)
                self.assert_rejected()

    def test_provenance_native_architecture_target_and_command_fail(self):
        (self.right / "provenance.json").unlink()
        self.assert_rejected()
        for key, value in (
            ("native", False), ("dirty", True), ("os", "macos"), ("profile", "debug"),
            ("execution_arch", "x86_64"), ("target_triple", "x86_64-unknown-linux-gnu"),
            ("commit", "0" * 40), ("cargo_version", "different"),
            ("command", "other-determinism_sweep ci --out {}".format(self.right)),
            ("command", "determinism_sweep soak --out {}".format(self.right)),
            ("command", "determinism_sweep ci --out {} --extra".format(self.right)),
        ):
            with self.subTest(key=key, value=value):
                self.reset()
                self.mutate_provenance(self.right, lambda p: p.update({key: value}))
                self.assert_rejected()
        self.reset()
        with self.assertRaises(compare.ComparisonError):
            compare.compare_directories(
                self.left, self.right, "ci", "x86_64-unknown-linux-gnu",
                "x86_64-unknown-linux-gnu", self.inventory_path)

    def test_toolchain_difference_fails(self):
        self.mutate_provenance(self.right, lambda p: p.update(
            rustc_vv=p["rustc_vv"].replace("release: 1.90.0", "release: 1.89.0")))
        self.assert_rejected()

    def test_duplicate_keys_and_nonfinite_numbers_fail(self):
        raw = (self.right / "manifest.json").read_text()
        raw = raw.replace('"format":"rh-determinism-manifest/1"',
                          '"format":"rh-determinism-manifest/1","format":"rh-determinism-manifest/1"', 1)
        (self.right / "manifest.json").write_text(raw)
        self.assert_rejected()
        self.reset()
        raw = (self.right / "provenance.json").read_text().replace('"elapsed_ms":123',
                                                                    '"elapsed_ms":NaN')
        (self.right / "provenance.json").write_text(raw)
        self.assert_rejected()

    def test_map_checksum_is_checked_against_admitted_file(self):
        self.assertEqual(self.run_compare(), 6)
        self.mutate_both_manifests(lambda m: m["map_inputs"][0].update(sha256="0" * 64))
        self.assert_rejected()

    def test_soak_uses_expanded_inventory(self):
        extra = copy.deepcopy(self.inventory["ci"][2])
        extra["id"] = "synthetic-soak-extra"
        self.inventory["soak"].append(extra)
        self.inventory_path.write_bytes(canonical(self.inventory))
        for directory in (self.left, self.right):
            self.mutate_manifest(directory, lambda m: m["inventory"].update(preset="soak"))
        with self.assertRaises(compare.ComparisonError):
            compare.compare_directories(
                self.left, self.right, "soak", "x86_64-unknown-linux-gnu",
                "aarch64-unknown-linux-gnu", self.inventory_path)

    def test_cli_rejects_unknown_duplicate_missing_malformed_and_extra_args(self):
        valid = ["L", "R", "--preset", "ci", "--left-target",
                 "x86_64-unknown-linux-gnu", "--right-target", "aarch64-unknown-linux-gnu"]
        self.assertEqual(compare.parse_args(valid)[2], "ci")
        invalid = [
            [], valid + ["extra"], valid[:-2], ["L", "R", "--unknown", "x"] + valid[2:],
            valid + ["--preset", "ci"],
            ["L", "R", "--preset", "ci", "--preset", "soak", "--left-target", "x"],
            ["L", "R", "--preset", "--left-target", "x", "--right-target", "y"],
        ]
        for argv in invalid:
            with self.subTest(argv=argv):
                with self.assertRaises(ValueError):
                    compare.parse_args(argv)

    def test_command_line_entry_point_accepts_valid_pair(self):
        process = subprocess.run([
            sys.executable, str(MODULE_PATH), str(self.left), str(self.right),
            "--preset", "ci", "--left-target", "x86_64-unknown-linux-gnu",
            "--right-target", "aarch64-unknown-linux-gnu",
        ], stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=False)
        self.assertEqual(process.returncode, 0, process.stderr)
        self.assertIn(b"6 scenarios match", process.stdout)


if __name__ == "__main__":
    unittest.main()
