"""Local-only deterministic package tests; no host, binary execution, or network."""
import hashlib
import json
import os
from pathlib import Path
import stat
import tarfile
import tempfile
import unittest
from unittest import mock

import bundle
from bootstrap import unpack


ELF = b"\x7fELF\x02\x01" + bytes(12) + b"\x3e\x00" + bytes(44)


def inputs(root, *, web_files=None):
    root.mkdir(parents=True, exist_ok=True)
    server = root / "rh-server"
    server.write_bytes(ELF)
    server.chmod(0o755)
    source_map = root / "map.json"
    source_map.write_text('{"width":1,"height":1,"tiles":[]}\n', encoding="utf-8")
    web = root / "web-input"
    web.mkdir()
    values = web_files or {"index.html": b"<html>ok</html>\n", "Build/game.data": b"data"}
    for name, data in values.items():
        path = web / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
    return server, source_map, web


class BundleTests(unittest.TestCase):
    def test_deterministic_tar_ignores_input_mtime_and_walk_order(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            server1, map1, web1 = inputs(root / "a", web_files={"z.txt": b"z", "index.html": b"i", "A/a.js": b"a"})
            server2, map2, web2 = inputs(root / "b", web_files={"A/a.js": b"a", "index.html": b"i", "z.txt": b"z"})
            for path in [server1, map1, *web1.rglob("*")]:
                if path.is_file():
                    os.utime(path, (1_700_000_001, 1_700_000_001))
            for path in [server2, map2, *web2.rglob("*")]:
                if path.is_file():
                    os.utime(path, (1_800_000_001, 1_800_000_001))
            bundle.build_bundle(server1, map1, web1, root / "a.tar", root / "a.json")
            bundle.build_bundle(server2, map2, web2, root / "b.tar", root / "b.json")
            self.assertEqual((root / "a.tar").read_bytes(), (root / "b.tar").read_bytes())

    def test_tar_manifest_metadata_and_existing_consumer(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            server, source_map, web = inputs(root / "inputs")
            result = bundle.build_bundle(server, source_map, web, root / "bundle.tar", root / "receipt.json")
            self.assertFalse(result["deployable"])
            self.assertIn("not measured", result["runtimeIdentity"])
            self.assertEqual(hashlib.sha256((root / "bundle.tar").read_bytes()).hexdigest(), result["archive"]["sha256"])
            with tarfile.open(root / "bundle.tar", "r:") as tar:
                members = tar.getmembers()
                names = [item.name for item in members]
                self.assertEqual(names, sorted(names))
                self.assertTrue(all(item.isfile() for item in members))
                self.assertTrue(all(item.uid == item.gid == item.mtime == 0 for item in members))
                self.assertTrue(all(item.uname == item.gname == "" for item in members))
                manifest = json.load(tar.extractfile("bundle-manifest.json"))
                self.assertEqual(set(manifest), set(names) - {"bundle-manifest.json"})
                for item in members:
                    if item.name != "bundle-manifest.json":
                        self.assertEqual(hashlib.sha256(tar.extractfile(item).read()).hexdigest(), manifest[item.name])
            unpack(root / "bundle.tar", root / "installed")
            self.assertEqual((root / "installed/web/index.html").read_bytes(), b"<html>ok</html>\n")
            self.assertTrue((root / "installed/rh-server").stat().st_mode & stat.S_IXUSR)

    def test_output_collision_and_tar_receipt_collision_refuse(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            server, source_map, web = inputs(root / "inputs")
            output = root / "bundle.tar"
            output.write_bytes(b"keep")
            with self.assertRaisesRegex(ValueError, "already exists"):
                bundle.build_bundle(server, source_map, web, output, root / "receipt.json")
            self.assertEqual(output.read_bytes(), b"keep")
            receipt = root / "receipt.json"
            receipt.write_bytes(b"keep receipt")
            with self.assertRaisesRegex(ValueError, "already exists"):
                bundle.build_bundle(server, source_map, web, root / "new.tar", receipt)
            self.assertEqual(receipt.read_bytes(), b"keep receipt")

    def test_symlink_and_unsafe_web_inputs_refuse(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            server, source_map, web = inputs(root / "inputs")
            map_link = root / "map-link.json"
            map_link.symlink_to(source_map)
            with self.assertRaisesRegex(ValueError, "symlink input"):
                bundle.build_bundle(server, map_link, web, root / "link.tar", root / "link.json")
            (web / "link").symlink_to(web / "index.html")
            with self.assertRaisesRegex(ValueError, "symlink or special"):
                bundle.build_bundle(server, source_map, web, root / "bad.tar", root / "bad.json")
            (web / "link").unlink()
            (web / "bad name").write_bytes(b"x")
            with self.assertRaisesRegex(ValueError, "unsafe member characters"):
                bundle.build_bundle(server, source_map, web, root / "bad2.tar", root / "bad2.json")
            (web / "bad name").unlink()
            (web / "bad dir").mkdir()
            with self.assertRaisesRegex(ValueError, "unsafe member characters"):
                bundle.build_bundle(server, source_map, web, root / "bad3.tar", root / "bad3.json")

    def test_special_server_input_refuses(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            _, source_map, web = inputs(root / "inputs")
            server_dir = root / "server-dir"
            server_dir.mkdir()
            with self.assertRaisesRegex(ValueError, "regular non-symlink"):
                bundle.build_bundle(server_dir, source_map, web, root / "special.tar", root / "special.json")

    def test_unreadable_web_traversal_does_not_silently_omit_files(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            server, source_map, web = inputs(root / "inputs")

            def denied_walk(*args, onerror, **kwargs):
                onerror(PermissionError(13, "permission denied", str(web / "Build")))
                return iter(())

            with mock.patch.object(bundle.os, "walk", side_effect=denied_walk):
                with self.assertRaisesRegex(ValueError, "cannot traverse complete Web input"):
                    bundle.build_bundle(server, source_map, web, root / "denied.tar", root / "denied.json")
            self.assertFalse((root / "denied.tar").exists())

    def test_missing_index_bad_map_and_wrong_elf_refuse(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            server, source_map, web = inputs(root / "inputs", web_files={"only.txt": b"x"})
            with self.assertRaisesRegex(ValueError, "missing web/index.html"):
                bundle.build_bundle(server, source_map, web, root / "no-index.tar", root / "no-index.json")
            (web / "index.html").write_bytes(b"index")
            source_map.write_text("not-json", encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "finite UTF-8 JSON"):
                bundle.build_bundle(server, source_map, web, root / "bad-map.tar", root / "bad-map.json")
            source_map.write_text("{}", encoding="utf-8")
            server.write_bytes(b"not an ELF")
            with self.assertRaisesRegex(ValueError, "ELF64 x86-64"):
                bundle.build_bundle(server, source_map, web, root / "bad-elf.tar", root / "bad-elf.json")

    def test_expanded_member_count_manifest_and_archive_bounds_refuse_before_write(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            server, source_map, web = inputs(root / "inputs", web_files={"index.html": b"i", "large": b"0123456789"})
            old = bundle.MAX_EXTRACT
            bundle.MAX_EXTRACT = 9
            try:
                with self.assertRaisesRegex(ValueError, "400 MiB"):
                    bundle.build_bundle(server, source_map, web, root / "expanded.tar", root / "expanded.json")
                self.assertFalse((root / "expanded.tar").exists())
            finally:
                bundle.MAX_EXTRACT = old
            old = bundle.MAX_EXTRACT
            input_total = sum(path.stat().st_size for path in [server, source_map, *web.rglob("*")] if path.is_file())
            bundle.MAX_EXTRACT = input_total
            try:
                with self.assertRaisesRegex(ValueError, "400 MiB"):
                    bundle.build_bundle(server, source_map, web, root / "manifest-expanded.tar", root / "manifest-expanded.json")
                self.assertFalse((root / "manifest-expanded.tar").exists())
            finally:
                bundle.MAX_EXTRACT = old
            old = bundle.MAX_MEMBERS
            bundle.MAX_MEMBERS = 4
            try:
                with self.assertRaisesRegex(ValueError, "10,000 members"):
                    bundle.build_bundle(server, source_map, web, root / "count.tar", root / "count.json")
            finally:
                bundle.MAX_MEMBERS = old
            old = bundle.MAX_MANIFEST
            bundle.MAX_MANIFEST = 1
            try:
                with self.assertRaisesRegex(ValueError, "manifest exceeds"):
                    bundle.build_bundle(server, source_map, web, root / "manifest.tar", root / "manifest.json")
            finally:
                bundle.MAX_MANIFEST = old
            old = bundle.MAX_BUNDLE
            bundle.MAX_BUNDLE = 512
            try:
                with self.assertRaisesRegex(ValueError, "160 MiB"):
                    bundle.build_bundle(server, source_map, web, root / "archive.tar", root / "archive.json")
            finally:
                bundle.MAX_BUNDLE = old


if __name__ == "__main__":
    unittest.main()
