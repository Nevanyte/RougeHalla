"""realtime.py at the game's duel pace, as JSON for the TypeScript harness (packages/server/src/harness).

    python3 realtime_paced.py [--k 2] [--sub 1] [--nmax 12] [--cells mirror,sig] [--pairs] > out.json

DUEL_PACE k (GAME_DESIGN 10.2): every faction hit and damage param x k, Sentenced's mark ramp x k^2, hp unchanged.
Cells: "mirror" is every designed edge (winner first) with the same weapon on both sides; "sig" is every edge with
both on their signature weapons. Each cell is realtime.duel on its phase grid; --pairs adds every phase pair's
result (a-major, as the harness runs them).
"""
import argparse
import json
import os
import sys
from dataclasses import replace

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import realtime as W  # noqa: E402

DAMAGE = ("burn", "backlash", "plague", "execute", "mark_cap")
ID = {"Fire": "fire", "Sentenced": "sentenced", "Plague": "plague", "Frost": "frost", "Holy": "holy"}


def paced(p, k):
    params = {key: (v * k * k if key == "mark_ramp" else v * k if key in DAMAGE else v) for key, v in p.params.items()}
    return replace(p, hit=p.hit * k, params=params)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--k", type=float, default=2.0)
    ap.add_argument("--sub", type=int, default=1)
    ap.add_argument("--nmax", type=int, default=12)
    ap.add_argument("--cells", default="mirror,sig")
    ap.add_argument("--pairs", action="store_true")
    a = ap.parse_args()
    by = {n: paced(p, a.k) for n, p in W.BY.items()}
    want = set(a.cells.split(","))
    cells = []
    for win, lose in W.BEATS:
        if "mirror" in want:
            cells += [("mirror", win, w, lose, w) for w in W.WNAMES]
        if "sig" in want:
            cells.append(("sig", win, W.SIG[win], lose, W.SIG[lose]))
    out = {"k": a.k, "sub": a.sub, "nmax": a.nmax, "cells": []}
    for kind, fa, wa, fb, wb in cells:
        r = W.duel(W.Side(by[fa], wa), W.Side(by[fb], wb), sub=a.sub, nmax=a.nmax)
        st = W.edge_stats(r)
        cell = {
            "kind": kind, "a": {"faction": ID[fa], "weapon": wa}, "b": {"faction": ID[fb], "weapon": wb},
            "stats": {key: float(v) for key, v in st.items()},
        }
        if a.pairs:
            cell["pairs"] = [
                [int(r["win"][i]), round(float(r["frac0"][i]), 6), round(float(r["frac1"][i]), 6), round(float(r["t"][i]), 4)]
                for i in range(r["P"])
            ]
        out["cells"].append(cell)
    json.dump(out, sys.stdout, indent=1)
    print()


if __name__ == "__main__":
    main()
