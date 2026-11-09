"""Cheap filesystem/Git guard tests. No database or gameplay run."""
import importlib.util
import os
from pathlib import Path
import stat
import subprocess
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("full_runtime_proof", Path(__file__).with_name("proof.py"))
proof = importlib.util.module_from_spec(spec)
spec.loader.exec_module(proof)


class PrivateStateGuard(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="rh-account-guard-")
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name).resolve()
        self.repo = self.root / "other-repo"
        subprocess.run(["git", "init", "-q", str(self.repo)], check=True)
        subprocess.run(["git", "-C", str(self.repo), "-c", "user.name=Guard Test", "-c",
                        "user.email=guard@example.invalid", "-c", "commit.gpgsign=false", "commit",
                        "-q", "--allow-empty", "-m", "local guard fixture"], check=True)

    def test_outside_git_with_missing_parent_is_accepted(self):
        candidate = self.root / "outside" / "nested" / "new-state"
        self.assertEqual(proof.private_state_path(candidate), candidate)
        self.assertFalse(candidate.exists())

    def test_this_repository_is_rejected(self):
        with self.assertRaises(RuntimeError):
            proof.private_state_path(proof.REPO / "guard-state-must-not-exist")

    def test_other_worktree_is_rejected(self):
        worktree = self.root / "linked-worktree"
        subprocess.run(["git", "-C", str(self.repo), "worktree", "add", "-q", "--detach",
                        str(worktree)], check=True)
        with self.assertRaises(RuntimeError):
            proof.private_state_path(worktree / "nested" / "state")

    def test_resolved_symlink_into_other_repository_is_rejected(self):
        link = self.root / "link"
        link.symlink_to(self.repo, target_is_directory=True)
        with self.assertRaises(RuntimeError):
            proof.private_state_path(link / "nested" / "state")

    def test_git_metadata_is_rejected(self):
        with self.assertRaises(RuntimeError):
            proof.private_state_path(self.repo / ".git" / "new-state")

    def test_bare_repository_is_rejected(self):
        bare = self.root / "bare"
        subprocess.run(["git", "init", "-q", "--bare", str(bare)], check=True)
        with self.assertRaises(RuntimeError):
            proof.private_state_path(bare / "nested" / "state")

    def test_ambient_git_variables_cannot_hide_membership(self):
        bare = self.root / "bare"
        subprocess.run(["git", "init", "-q", "--bare", str(bare)], check=True)
        with patch.dict(os.environ, {"GIT_CEILING_DIRECTORIES": str(bare), "GIT_DIR": str(self.root / "absent")}):
            with self.assertRaises(RuntimeError):
                proof.private_state_path(bare / "new-state")
            self.assertEqual(proof.private_state_path(self.root / "outside"), self.root / "outside")

    def test_private_writes_obey_umask_0077(self):
        previous = os.umask(0o077)
        try:
            path = self.root / "receipt.json"
            proof.write(path, {"synthetic": True})
        finally:
            os.umask(previous)
        self.assertEqual(stat.S_IMODE(path.stat().st_mode), 0o600)


if __name__ == "__main__":
    unittest.main()
