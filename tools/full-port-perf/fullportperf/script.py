"""Stack-neutral scripted input. A script is data: browser keyboard/pointer events on a fixed cycle, restricted to the
R-GAME-2 controls. `timeline` expands it deterministically for a trial; the canonical SHA-256 of the script is the
`inputScriptSha256` both sides of a pair must report. Nothing here drives a browser."""

from . import FORMAT_SCRIPT, canonical

CODES = {"KeyW", "KeyA", "KeyS", "KeyD", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "KeyR", "KeyE", "Tab", "KeyJ",
         "KeyF"}
TYPES = {"keydown", "keyup", "pointermove", "pointerdown", "pointerup"}


def validate(s):
    errs = []
    if s.get("format") != FORMAT_SCRIPT:
        errs.append(f"format must be {FORMAT_SCRIPT}")
    cyc = s.get("cycleMs")
    if not isinstance(cyc, int) or cyc <= 0:
        errs.append("cycleMs must be a positive integer")
        return errs
    events = s.get("events")
    if not isinstance(events, list) or not events:
        return errs + ["events must be a non-empty list"]
    held, button, last = set(), False, -1
    for i, e in enumerate(events):
        t = e.get("atMs")
        if not isinstance(t, int) or not 0 <= t < cyc:
            errs.append(f"event {i}: atMs must be an integer in [0, cycleMs)")
            continue
        if t < last:
            errs.append(f"event {i}: events must be in time order")
        last = t
        ty = e.get("type")
        if ty not in TYPES:
            errs.append(f"event {i}: type {ty!r} not allowed")
        elif ty in ("keydown", "keyup"):
            c = e.get("code")
            if c not in CODES:
                errs.append(f"event {i}: {c!r} is not an R-GAME-2 control")
            elif ty == "keydown":
                if c in held:
                    errs.append(f"event {i}: {c} pressed twice")
                held.add(c)
            else:
                if c not in held:
                    errs.append(f"event {i}: {c} released while up")
                held.discard(c)
        elif ty == "pointermove":
            for k in ("x", "y"):
                x = e.get(k)
                if not isinstance(x, (int, float)) or not -0.5 <= x <= 0.5:
                    errs.append(f"event {i}: {k} must be a canvas fraction in [-0.5, 0.5]")
        else:
            if e.get("button") != 0:
                errs.append(f"event {i}: only the primary button is used")
            if (ty == "pointerdown") == button:
                errs.append(f"event {i}: unbalanced {ty}")
            button = ty == "pointerdown"
    if held or button:
        errs.append("every key and button must be released within the cycle")
    return errs


def sha256(s):
    return canonical.sha256_json(s)


def timeline(s, duration_ms):
    """Every event of the script repeated from t=0 up to (excluding) duration_ms, each with its absolute time and cycle.
    A cycle that would not finish inside the duration is not started, so no key is left held."""
    errs = validate(s)
    if errs:
        raise ValueError("; ".join(errs))
    cyc = s["cycleMs"]
    out = []
    for k in range(duration_ms // cyc):
        for e in s["events"]:
            out.append(dict(e, atMs=k * cyc + e["atMs"], cycle=k))
    return out
