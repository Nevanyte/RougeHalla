#!/usr/bin/env python3
"""Copy Unity output, configure same-origin staging, and add lossless data sidecars."""
import argparse
import gzip
import hashlib
import json
from pathlib import Path
import shutil

SCRIPT = """<script id="rougehalla-staging-origin">
(function () {
  var url = new URL(window.location.href);
  if (!url.searchParams.has("server")) {
    url.searchParams.set("server", (url.protocol === "https:" ? "wss://" : "ws://") + url.host + "/ws");
    window.history.replaceState(window.history.state, "", url.pathname + url.search + url.hash);
  }
})();
</script>
"""


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--dest", type=Path, required=True)
    parser.add_argument("--report", type=Path, required=True)
    args = parser.parse_args()
    source, dest = args.source.resolve(), args.dest.resolve()
    if source == dest or source in dest.parents:
        parser.error("destination must be separate from the canonical Web output")
    if dest.exists():
        parser.error("destination already exists; use a new private bundle directory")
    original = source / "index.html"
    content = original.read_text()
    if "rougehalla-staging-origin" in content or content.count("</head>") != 1:
        parser.error("expected one unmodified Unity HTML head")
    source_hashes = {str(p.relative_to(source)): digest(p) for p in sorted(source.rglob("*")) if p.is_file()}
    shutil.copytree(source, dest)
    (dest / "index.html").write_text(content.replace("</head>", SCRIPT + "</head>", 1))
    sidecars = {}
    for payload in sorted((dest / "Build").glob("*.data")):
        sidecar = payload.with_name(payload.name + ".gz")
        if sidecar.exists():
            raise RuntimeError("refusing to replace an existing gzip sidecar: " + str(sidecar))
        with payload.open("rb") as original_data, sidecar.open("wb") as compressed:
            with gzip.GzipFile(filename="", mode="wb", fileobj=compressed, compresslevel=9, mtime=0) as encoded:
                shutil.copyfileobj(original_data, encoded)
        with gzip.open(sidecar, "rb") as decoded:
            decoded_hash = hashlib.sha256(decoded.read()).hexdigest()
        if decoded_hash != digest(payload):
            raise RuntimeError("gzip sidecar does not reproduce the original payload")
        sidecars[str(sidecar.relative_to(dest))] = {
            "source": str(payload.relative_to(dest)), "source_sha256": decoded_hash,
            "source_bytes": payload.stat().st_size, "gzip_bytes": sidecar.stat().st_size,
            "gzip_sha256": digest(sidecar)}
    packaged_hashes = {str(p.relative_to(dest)): digest(p) for p in sorted(dest.rglob("*")) if p.is_file()}
    changed = [p for p in source_hashes if source_hashes[p] != packaged_hashes[p]]
    if changed != ["index.html"] or set(packaged_hashes) - set(source_hashes) != set(sidecars):
        raise RuntimeError("packaging changed unexpected files: " + repr(changed))
    report = {"source": str(source), "dest": str(dest), "changed": changed,
              "original_index_sha256": source_hashes["index.html"],
              "packaged_index_sha256": packaged_hashes["index.html"],
              "injected_script_sha256": hashlib.sha256(SCRIPT.encode()).hexdigest(),
              "gzip_sidecars": sidecars,
              "unchanged_payload_sha256": {p: v for p, v in source_hashes.items() if p != "index.html"}}
    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
