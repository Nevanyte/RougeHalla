"""Deterministic JSON: one canonical byte form, its SHA-256, and the identity of this tool's own source."""

import hashlib
import json
import math
import os

HERE = os.path.dirname(os.path.abspath(__file__))
TOOL_ROOT = os.path.dirname(HERE)


def _check_finite(value, path="$"):
    """NaN/Infinity have no canonical JSON form and hide missing data; refuse them everywhere."""
    if isinstance(value, float) and not math.isfinite(value):
        raise ValueError(f"non-finite number at {path}")
    if isinstance(value, dict):
        for k, v in value.items():
            if not isinstance(k, str):
                raise ValueError(f"non-string key at {path}")
            _check_finite(v, f"{path}.{k}")
    elif isinstance(value, list):
        for i, v in enumerate(value):
            _check_finite(v, f"{path}[{i}]")


def dumps(value):
    """Canonical text: sorted keys, no insignificant whitespace, UTF-8, no NaN."""
    _check_finite(value)
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False, allow_nan=False)


def sha256_json(value):
    return hashlib.sha256(dumps(value).encode("utf-8")).hexdigest()


def sha256_file(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 16), b""):
            h.update(chunk)
    return h.hexdigest()


def pretty(value):
    """Stable human-readable form for files written to evidence (sorted keys, two-space indent, trailing newline)."""
    _check_finite(value)
    return json.dumps(value, sort_keys=True, indent=2, ensure_ascii=False, allow_nan=False) + "\n"


def load(path):
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f, parse_constant=_refuse_constant)


def _refuse_constant(name):
    raise ValueError(f"non-finite JSON constant {name}")


def tool_sha256():
    """SHA-256 over this tool's Python sources and matrix (sorted relative paths and bytes). Summaries carry it so a
    summary is tied to the exact code that computed it."""
    h = hashlib.sha256()
    files = []
    for base, dirs, names in os.walk(TOOL_ROOT):
        dirs[:] = sorted(d for d in dirs if d not in ("__pycache__", "tests"))
        for n in sorted(names):
            if n.endswith(".py") or n.endswith(".json"):
                files.append(os.path.join(base, n))
    for p in sorted(files):
        rel = os.path.relpath(p, TOOL_ROOT).replace(os.sep, "/")
        h.update(rel.encode() + b"\0")
        with open(p, "rb") as f:
            h.update(f.read())
        h.update(b"\0")
    return h.hexdigest()
