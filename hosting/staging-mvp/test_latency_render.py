"""Local-only regression tests for the opt-in latency-duel staging profile."""
import importlib.util
import io
import json
from pathlib import Path
import tarfile
import tempfile
import unittest


MODULE_PATH = Path(__file__).with_name("staging.py")
SPEC = importlib.util.spec_from_file_location("staging", MODULE_PATH)
staging = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(staging)


class LatencyRenderTests(unittest.TestCase):
    def test_default_render_is_byte_preserving(self):
        source = (MODULE_PATH.parent / "bootstrap.sh.in").read_text()
        self.assertEqual(staging.render_bootstrap(source), source)
        template = staging.render()
        expected = {
            "Fn::Base64": {"Fn::Sub": source}
        }
        self.assertEqual(template["Resources"]["Host"]["Properties"]["UserData"], expected)
        self.assertIn(staging.DEFAULT_SERVICE, source)

    def test_latency_profile_args_runtime_watchdog_and_unchanged_expiry(self):
        source = (MODULE_PATH.parent / "bootstrap.sh.in").read_text()
        rendered = staging.render_bootstrap(source, latency_duel=True)
        self.assertNotIn(staging.DEFAULT_SERVICE, rendered)
        self.assertIn(staging.LATENCY_DUEL_SERVICE, rendered)
        self.assertIn("--map /opt/rougehalla/maps/latency-duel.map.json", rendered)
        self.assertIn("--min-players 2 --fill-bots 0", rendered)
        self.assertIn("--max-rooms 2 --lobby-seconds 3 --fill-seconds 0", rendered)
        self.assertNotIn("--first-playable", rendered)
        self.assertIn("RuntimeMaxSec=4h", rendered)
        self.assertIn("TimeoutStopSec=180", rendered)
        # The whole bootstrap is an exact one-block substitution; the absolute
        # OS deadline, egress limiter, Caddy configuration, and startup stay fixed.
        self.assertEqual(rendered.replace(staging.LATENCY_DUEL_SERVICE, staging.DEFAULT_SERVICE, 1), source)
        self.assertIn("enable --now rougehalla-expiry.timer", rendered)
        self.assertIn("OnCalendar=$expiry", rendered)
        self.assertIn("root handle 1: tbf rate 8mbit burst 512kb latency 50ms", rendered)
        self.assertIn("parent 1:1 handle 10: fq_codel", rendered)
        self.assertNotIn("latency 1000ms", rendered)
        self.assertIn("rougehalla.com {", rendered)
        self.assertEqual(staging.profile_name(True), "latency-duel")
        self.assertEqual(staging.profile_name(False), "first-playable")

    def test_substitution_fails_closed_on_changed_or_duplicate_default_block(self):
        source = (MODULE_PATH.parent / "bootstrap.sh.in").read_text()
        with self.assertRaisesRegex(RuntimeError, "block changed"):
            staging.render_bootstrap(source.replace("--fill-bots 4", "--fill-bots 5"), True)
        with self.assertRaisesRegex(RuntimeError, "block changed"):
            staging.render_bootstrap(source + "\n" + staging.DEFAULT_SERVICE, True)

    def test_latency_bundle_requires_controlled_map_only_when_selected(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            files = {
                "bin/rh-server": b"server",
                "bin/caddy": b"caddy",
                "web/index.html": b"web",
            }

            def write_bundle(contents):
                archive_path = root / "bundle.tar.gz"
                with tarfile.open(archive_path, "w:gz") as archive:
                    for name, payload in contents.items():
                        path = root / name.replace("/", "_")
                        path.write_bytes(payload)
                        info = tarfile.TarInfo(name)
                        info.size = len(payload)
                        info.mode = 0o755 if name in {"bin/rh-server", "bin/caddy"} else 0o644
                        with path.open("rb") as handle:
                            archive.addfile(info, handle)
                return archive_path

            bundle = write_bundle(files)
            staging.validate_bundle(bundle)
            with self.assertRaisesRegex(RuntimeError, "incomplete"):
                staging.validate_bundle(bundle, latency_duel=True)
            files[staging.LATENCY_DUEL_MAP] = b'{"map":"wrong"}\n'
            with self.assertRaisesRegex(RuntimeError, "controlled fixture"):
                staging.validate_bundle(write_bundle(files), latency_duel=True)
            files[staging.LATENCY_DUEL_MAP] = (MODULE_PATH.parents[2] / "parity/maps/duel.map.json").read_bytes()
            staging.validate_bundle(write_bundle(files), latency_duel=True)
            with tarfile.open(bundle, "r:gz") as archive:
                members = [(member, archive.extractfile(member).read()) for member in archive if member.isfile()]
            for invalid in ("directory", "duplicate"):
                with self.subTest(invalid=invalid):
                    with tarfile.open(bundle, "w:gz") as archive:
                        for member, payload in members:
                            if invalid == "directory" and member.name == staging.LATENCY_DUEL_MAP:
                                directory = tarfile.TarInfo(staging.LATENCY_DUEL_MAP)
                                directory.type = tarfile.DIRTYPE
                                archive.addfile(directory)
                            else:
                                archive.addfile(member, io.BytesIO(payload))
                        if invalid == "duplicate":
                            archive.addfile(tarfile.TarInfo(staging.LATENCY_DUEL_MAP))
                    with self.assertRaisesRegex(RuntimeError, "exactly one regular file"):
                        staging.validate_bundle(bundle, latency_duel=True)

    def test_network_ingress_and_deadline_template_are_unchanged(self):
        original = json.loads((MODULE_PATH.parent / "stack.base.json").read_text())
        selected = staging.render(latency_duel=True)
        # UserData is the only template difference between profiles.
        selected_resources = json.loads(json.dumps(selected["Resources"]))
        original_resources = json.loads(json.dumps(original["Resources"]))
        selected_resources["Host"]["Properties"]["UserData"] = "normalized"
        original_resources["Host"]["Properties"]["UserData"] = "normalized"
        self.assertEqual(selected_resources, original_resources)
        ingress = selected["Resources"]["WebSecurityGroup"]["Properties"]["SecurityGroupIngress"]
        self.assertEqual([(rule["FromPort"], rule["ToPort"]) for rule in ingress], [(80, 80), (443, 443)])
        self.assertEqual(selected["Parameters"]["DeadlineUnix"], original["Parameters"]["DeadlineUnix"])
        self.assertEqual(selected["Outputs"]["ExpiresUnix"], original["Outputs"]["ExpiresUnix"])


if __name__ == "__main__":
    unittest.main()
