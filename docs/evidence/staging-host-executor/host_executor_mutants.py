"""Host-executor lane only: mutates COPIES of tools/staging-full-runtime under argv[1]; never another worktree."""
import os, shutil, subprocess, sys
from pathlib import Path
src = Path('/home/user/rh-host-installer/tools/staging-full-runtime')
scr = Path(sys.argv[1]).resolve()
assert 'host-executor-lane' in str(scr) and not str(scr).startswith('/home/user/')
M = {
 'M01-no-nft-verify': ("        verify_nft(out.decode('utf-8'), self.uids, self.inputs['boundary'])\n", ""),
 'M02-any-volume-owner': ("'retained volume is not owned by this run; never adopt or format foreign media')", "'x') if False else None"),
 'M03-no-marker-restart-hold': ("        require(MARKER not in entries, 'installation marker already exists; restart never revives writers')\n", ""),
 'M04-create-exact-adopts-different': ("            require(data == body and (info['user'], info['group'], info['mode']) == (user, group, file_mode),\n                    'existing file differs; unknown replacement refused')\n", ""),
 'M05-member-adopts-different': ("            require(sha256(data) == item['sha256'] and (info['user'], info['group'], info['mode']) ==\n                    (item['owner'], item['group'], item['file_mode']), 'existing destination differs; unknown replacement refused')\n", ""),
 'M06-no-settings-before-password': ("            self.pg_settings(sock, '')\n", ""),
 'M07-no-runtime-separation': ("        self.check_runtime_separation()\n", ""),
 'M08-gate-skips-timer': ("        expiry.verify_units(self.runner, self.end_us)\n        expiry.no_shutdown_pending(self.runner)\n        with self.fs.directory(ETC) as etc:\n            body, info = self.fs.read(etc, expiry.STATE, 8192)", "        with self.fs.directory(ETC) as etc:\n            body, info = self.fs.read(etc, expiry.STATE, 8192)"),
 'M09-gate-skips-budget': ("'bootstrap startup budget cannot cover this step; fail-safe instead of starting it')", "'x') if False else None"),
 'M10-gate-skips-guard': ("        expiry.verify_guard(self.runner)\n        expiry.verify_units", "        expiry.verify_units"),
 'M11-no-foreign-scan': ("        require(not foreign, 'foreign state on retained volume; refused without modification')\n", ""),
 'M12-no-device-binding': ("        require(self.fs.device(self.data_fd) == device['mounted_device'], 'held data directory is not the validated device')\n", ""),
 'M13-no-role-observation': ("            require(observed == EXPECTED_ROLE, 'application role is not the restricted non-superuser owner')\n", ""),
 'M14-no-download-verify': ("        transfer.verify_download(self.plan, self.bundle_path, metadata)\n", ""),
 'M15-no-put-verify': ("            receipt = transfer.verify_put_response(plan, response, digest)\n", "            receipt = {'version_id': response.get('VersionId'), 'ciphertext_sha256': digest}\n"),
 'M16-no-tool-pins': ("            require(self.fs.file_digest(item['path'], executable=True) == item['sha256'],\n                    'pinned tool missing or differs; no substitute is downloaded: ' + name)\n", ""),
 'M17-no-tree-pins': ("            require(self.fs.tree_digest(path) == pins['trees'][name], 'pinned tool tree differs: ' + name)\n", "            pass\n"),
 'M18-no-pg-journal-check': ("                require(not contents or self.journal_has('pg-init'), 'unjournaled PostgreSQL data refused; never reinitialize')\n", "                pass\n"),
 'M19-no-nologin-shell': ("                    and user['shell'] in NOLOGIN and group['members'] == [], 'restricted service identity required')", "                    and group['members'] == [], 'restricted service identity required')"),
 'M20-cleanup-removes-ciphertext-too': ("        self.fs.unlink(fd, BUNDLE)\n\n    # ---- backup", "        self.fs.unlink(fd, BUNDLE)\n        for n in self.fs.listdir(fd):\n            if n.endswith('.age'): self.fs.unlink(fd, n)\n\n    # ---- backup"),
 'M21-no-unit-binding': ("        self.lifetimes = check_units(self.unit_texts, self.plan, self.clock()[0] + self.timeout_us)", "        self.lifetimes = {}"),
 'M22-no-secret-shape': ("        require(type(value) is dict and set(value) == {'database_password', 'playtest_passcode'}\n                and all(type(v) is str and re.fullmatch('[0-9a-f]{64}', v) for v in value.values()),\n                'partial private secret requires operator review; never regenerated')\n", ""),
 'M23-no-quiescence-check': ("                require(self.show(unit).get('ActiveState') == 'inactive', 'writers not quiesced after producer')\n", "                pass\n"),
 'M24-no-lock': ("        self.fs.lock_exclusive(lock)\n        device = host_device", "        device = host_device"),
 'M25-backup-isolated-python': ("' -E -s /opt/rougehalla/installer/host_executor.py backup --run-id '", "' -I /opt/rougehalla/installer/host_executor.py backup --run-id '"),
}
for name, (old, new) in M.items():
    d = scr / name
    if d.exists(): shutil.rmtree(d)
    shutil.copytree(src, d, ignore=shutil.ignore_patterns('__pycache__'))
    f = d / 'installer/host_executor.py'
    text = f.read_text()
    assert text.count(old) == 1, name
    f.write_text(text.replace(old, new))
    r = subprocess.run([sys.executable, '-B', '-m', 'unittest', 'discover', '-s', str(d / 'installer'), '-p', 'test_host_executor.py'],
                       capture_output=True, text=True, env=dict(os.environ, PYTHONDONTWRITEBYTECODE='1'))
    last = [l for l in r.stderr.splitlines() if l.startswith(('OK', 'FAILED'))][-1]
    print(name, 'KILL' if r.returncode else 'SURVIVE', last, flush=True)
    shutil.rmtree(d)
