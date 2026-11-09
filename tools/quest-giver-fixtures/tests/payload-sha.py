#!/usr/bin/env python3
"""Reproduce the quest-giver canonical format+cases payload SHA256.

Canonicalization (exact):
  payload = {"format": corpus["format"], "cases": corpus["cases"]}
  text    = json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
  digest  = sha256(text.encode("utf-8")).hexdigest()

No trailing newline. Object keys are recursively sorted; array order is preserved; output is UTF-8 with
non-ASCII characters unescaped. Both the current corpus and the pre-repair corpus must yield the same digest.
"""
import hashlib
import json
import pathlib
import subprocess
import sys

EXPECTED_PAYLOAD_SHA = "ad6e10ddd7f2de02530b8ae037101315941aef4da815cdfd279773f32b215b8d"
OLD_COMMIT = "00f9767755414ce3dbf3e7857965ad287fb334d1"
OLD_CORPUS_SHA = "51c074b4c41b28147de7a2d215a581e617363ed5552a45aac4e46025b612d4fa"
CURRENT_CORPUS_SHA = "039d4e058fa914f42080f1c55d8640cc508c5b4745504930ca3db49579adc8b4"


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def canonical_payload(raw: bytes) -> tuple:
    corpus = json.loads(raw.decode("utf-8"))
    payload = {"format": corpus["format"], "cases": corpus["cases"]}
    text = json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    return text, text.encode("utf-8"), sha256_bytes(text.encode("utf-8"))


def main() -> int:
    repo = pathlib.Path(__file__).resolve().parents[3]
    current_path = repo / "parity" / "quest-giver" / "source.json"
    if len(sys.argv) > 2:
        print("usage: payload-sha.py [OLD_CORPUS_PATH]", file=sys.stderr)
        return 2
    if len(sys.argv) == 2:
        old_path = pathlib.Path(sys.argv[1])
        old_raw = old_path.read_bytes()
        old_origin = str(old_path)
    else:
        old_raw = subprocess.check_output(
            ["git", "show", OLD_COMMIT + ":parity/quest-giver/source.json"], cwd=repo
        )
        old_origin = "git " + OLD_COMMIT + ":parity/quest-giver/source.json"
    current_raw = current_path.read_bytes()

    old_sha = sha256_bytes(old_raw)
    current_sha = sha256_bytes(current_raw)
    if old_sha != OLD_CORPUS_SHA:
        print("FAIL: pre-repair corpus sha256 " + old_sha + " != " + OLD_CORPUS_SHA, file=sys.stderr)
        return 1
    if current_sha != CURRENT_CORPUS_SHA:
        print("FAIL: current corpus sha256 " + current_sha + " != " + CURRENT_CORPUS_SHA, file=sys.stderr)
        return 1

    old_text, old_bytes, old_payload_sha = canonical_payload(old_raw)
    new_text, new_bytes, new_payload_sha = canonical_payload(current_raw)
    if old_text != new_text:
        print("FAIL: old/new canonical text differs", file=sys.stderr)
        return 1
    if old_payload_sha != EXPECTED_PAYLOAD_SHA or new_payload_sha != EXPECTED_PAYLOAD_SHA:
        print("FAIL: payload sha256 " + old_payload_sha + " / " + new_payload_sha + " != " + EXPECTED_PAYLOAD_SHA, file=sys.stderr)
        return 1

    print("canonicalization: json.dumps({'format': corpus['format'], 'cases': corpus['cases']},")
    print("  sort_keys=True, separators=(',', ':'), ensure_ascii=False).encode('utf-8')")
    print("  no trailing newline; recursively sorted object keys; array order preserved")
    print("old corpus (" + old_origin + "): sha256 " + old_sha + " bytes " + str(len(old_raw)))
    print("new corpus (" + str(current_path) + "): sha256 " + current_sha + " bytes " + str(len(current_raw)))
    print("canonical payload bytes: " + str(len(new_bytes)))
    print("canonical payload sha256: " + new_payload_sha + " (identical old/new)")
    print("PASS")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
