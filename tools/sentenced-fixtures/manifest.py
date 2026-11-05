#!/usr/bin/env python3
"""Pin only exact source/capture artifacts; no simulation or package writes."""
import hashlib
import json
import pathlib
import subprocess

ROOT = pathlib.Path(__file__).resolve().parents[2]
BASE = "485c6f9e45a69cd5d98d82d25ba6f9c05002f0ec"
PREFIX = pathlib.Path("/Users/nevinmckinnon/.codex/tools/rougehalla-stage2/sentenced-capture")

def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

subprocess.run(["git", "diff", "--exit-code", BASE, "--", "packages"], cwd=ROOT, check=True, capture_output=True)
package_files = subprocess.check_output(["git", "ls-files", "packages"], cwd=ROOT, text=True).splitlines()
fixtures = sorted((ROOT / "parity/fixtures").glob("sentenced_*.json"))
assert len(fixtures) == 22
assert sum(len(json.loads(p.read_text())["ticks"]) for p in fixtures) == 5042
for path in fixtures:
    fx = json.loads(path.read_text())
    assert fx["inputs"] and fx["ticks"] and fx["requires"]
    assert fx["legacyConfig"]["rustSlice"] == "player-engagement-holy-plague-fire-frost-sentenced/1"
    assert all(t["sentenced"]["fighters"] for t in fx["ticks"])
artifacts = fixtures + sorted((ROOT / "parity/sentenced").glob("*.json")) + [ROOT / "parity/sentenced/README.md"]
artifacts = [p for p in artifacts if p.name != "source-manifest.json"]
scripts = [ROOT / "parity/legacy-capture/capture.ts", ROOT / "parity/legacy-capture/scenarios/types.ts", ROOT / "parity/legacy-capture/scenarios/sentenced.ts"] + sorted((ROOT / "tools/sentenced-fixtures").glob("*"))
scripts = [p for p in scripts if p.is_file()]
manifest = {
    "format": "rh-sentenced-source-manifest/1",
    "acceptedBaseline": BASE,
    "packageSourceUnchangedFromBaseline": True,
    "runtime": {"version": "v22.23.4", "platform": "linux", "arch": "x64", "nodeSha256": sha(PREFIX / "node-v22.23.4-linux-x64/bin/node"), "archiveSha256": sha(PREFIX / "node22.tar.gz"), "source": "https://nodejs.org/dist/v22.23.4/node-v22.23.4-linux-x64.tar.gz", "defaultImageBinaryRejected": "v24.22.2"},
    "fixtureRevision": {"value": "unknown", "reason": "isolated minimal capture image has no git; host package source verified byte-unchanged from acceptedBaseline and pinned below"},
    "ordinaryIntake": {"fixtures": len(fixtures), "ticks": 5042, "maxima": {"rawEvents": 30, "rawMarkFxRows": 3, "ledgerRows": 17, "markHitsPerOwner": 2, "performedRequests": 4, "publicInstantKeys": 3, "projectedOutputs": 23}},
    "packageLockSha256": sha(ROOT / "package-lock.json"),
    "sourceFiles": {p: sha(ROOT / p) for p in package_files if (ROOT / p).is_file()},
    "captureScripts": {str(p.relative_to(ROOT)): sha(p) for p in scripts},
    "artifacts": {str(p.relative_to(ROOT)): sha(p) for p in artifacts},
}
(ROOT / "parity/sentenced/source-manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
print(json.dumps({"sourceFiles": len(manifest["sourceFiles"]), "artifacts": len(manifest["artifacts"]), "fixtures": 22, "ticks": 5042}))
