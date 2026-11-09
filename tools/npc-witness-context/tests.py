"""Offline synthetic controls only; no Source, Docker, npm or subprocess invocation. UNRUN."""
import json
from pathlib import Path
import runpy
import tempfile
import unittest

HERE = Path(__file__).absolute().parent
API = runpy.run_path(str(HERE / "run.py"))

class ContextControls(unittest.TestCase):
    def test_current_and_historical_doc_drift_refused_independently(self):
        with tempfile.TemporaryDirectory() as root:
            root = Path(root).resolve()
            (root / "current.md").write_bytes(b"current normative")
            (root / "old.md").write_bytes(b"historical metadata")
            for name in ("current.md", "old.md"):
                value = (root / name).read_bytes()
                pin = dict(path=name, bytes=len(value), sha256=API["sha"](value))
                API["check_pin"](root, pin)
                (root / name).write_bytes(value + b"\n")
                with self.assertRaisesRegex(ValueError, "pin drift"):
                    API["check_pin"](root, pin)

    def test_every_byte_including_metadata_is_compared_without_normalization(self):
        API["exact_bytes"](b'{"doc":"old","event":1}\n', b'{"doc":"old","event":1}\n')
        for changed in (b'{"doc":"new","event":1}\n', b'{"doc":"old","event":2}\n', b'{"doc":"old","event":1}'):
            with self.assertRaisesRegex(ValueError, "WHOLE-BYTE"):
                API["exact_bytes"](changed, b'{"doc":"old","event":1}\n')

    def test_symlink_ancestor_and_file_are_refused(self):
        with tempfile.TemporaryDirectory() as parent:
            root = Path(parent).resolve()
            (root / "real").mkdir()
            (root / "real/data").write_text("x")
            (root / "link").symlink_to(root / "real", target_is_directory=True)
            with self.assertRaisesRegex(ValueError, "symlink"):
                API["plain"](root / "link/data")
            (root / "file").symlink_to(root / "real/data")
            with self.assertRaisesRegex(ValueError, "symlink"):
                API["plain"](root / "file")

    def test_source_inventory_and_new_old_tool_files_refused(self):
        with tempfile.TemporaryDirectory() as parent:
            root = Path(parent).resolve()
            for p in ("packages/shared/src", "packages/client/src", "packages/server/src/sim", "packages/server/src/bots", "packages/server/src/rooms", "tools/npc-continuity-fixtures"):
                (root / p).mkdir(parents=True, exist_ok=True)
            paths = ("packages/server/src/rooms/FxChannel.ts", "packages/shared/src/a.ts", "tools/npc-continuity-fixtures/capture.mts")
            for p in paths:
                (root / p).write_text("original")
            w = dict(toolDirectory="tools/npc-continuity-fixtures", pins={p: {} for p in paths})
            API["inventories"](root, w)
            (root / "packages/shared/src/new.ts").write_text("extra")
            with self.assertRaisesRegex(ValueError, "source inventory"):
                API["inventories"](root, w)
            (root / "packages/shared/src/new.ts").unlink()
            (root / "tools/npc-continuity-fixtures/new.md").write_text("extra")
            with self.assertRaisesRegex(ValueError, "tool inventory"):
                API["inventories"](root, w)

    def test_one_write_original_script_and_mount_envelope(self):
        m = json.loads((HERE / "context.json").read_text())
        for w in m["witnesses"].values():
            args = API["docker_args"](Path("/repo-source"), Path("/fresh"), Path("/historical.md"), m["image"], "owned", w["script"])
            command = args[-1]
            self.assertEqual(command.count("--write /out/actual.json"), 1)
            self.assertNotIn("--check", command)
            self.assertNotIn("capture.sh", command)
            self.assertIn("--pull=never", args)
            self.assertIn("--read-only", args)
            self.assertIn("type=bind,src=/historical.md,dst=/repo/docs/CONTRACTS.md,readonly", args)
            self.assertEqual(sum(x.startswith("/repo/") and ":rw,exec,size=" in x for x in args), 4)
            self.assertIn("NPM_CONFIG_USERCONFIG=/tmp/empty-user-npmrc", args)
            self.assertIn("NPM_CONFIG_GLOBALCONFIG=/tmp/empty-global-npmrc", args)
            self.assertNotIn("/dev/null", command)
            self.assertIn("--ignore-scripts", command)
            self.assertIn("/out/npm.log", command)

    def test_cleanup_never_stops_unowned_container(self):
        class Result:
            returncode = 0
            stdout = "expected-owner\n"
        calls = []
        def fake_run(argv, **kwargs):
            calls.append(argv)
            result = Result()
            if "inspect" in argv:
                result.stdout = "foreign-owner\n"
            return result
        function = API["owned_cleanup"]
        original = function.__globals__["subprocess"].run
        function.__globals__["subprocess"].run = fake_run
        try:
            with self.assertRaisesRegex(ValueError, "ownership mismatch"):
                function(["docker"], "expected-owner")
        finally:
            function.__globals__["subprocess"].run = original
        self.assertEqual(len(calls), 2)
        self.assertIn("inspect", calls[1])

if __name__ == "__main__":
    unittest.main()
