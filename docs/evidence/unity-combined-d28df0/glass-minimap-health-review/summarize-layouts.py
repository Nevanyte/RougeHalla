#!/usr/bin/env python3
"""Summarize native layout-capture JSON metadata without inferring absent evidence.

Default input is this file's sibling `layouts/`. Optional --out writes Markdown;
otherwise the same report is printed to stdout. No PNGs or project files are changed.
"""
import argparse
import collections
import json
import math
from pathlib import Path

DEFAULT_LAYOUTS = Path(__file__).resolve().parent / "layouts"


def fmt(value):
    if value is None:
        return "—"
    if isinstance(value, bool):
        return "yes" if value else "no"
    if isinstance(value, float):
        return f"{value:.3f}".rstrip("0").rstrip(".")
    return str(value)


def rect_text(rect):
    if not isinstance(rect, list) or len(rect) != 4:
        return "—"
    return "[" + ", ".join(fmt(v) for v in rect) + "]"


def vector_text(v):
    if not isinstance(v, list):
        return "—"
    return "(" + ", ".join(fmt(x) for x in v) + ")"


def summarize(path):
    data = json.loads(path.read_text())
    mode, scale = data.get("mode"), data.get("textScale")
    case = f"{path.stem}"
    flags = [
        f"ready={fmt(data.get('isReady'))}",
        f"nativeMatch={fmt(data.get('nativeDimensionsMatch'))}",
        f"advanced={fmt(data.get('advanced'))}",
        f"ticksAdvanced={fmt(data.get('ticksAdvanced'))}",
        f"watermark={fmt(data.get('stagedWatermark'))}",
    ]
    native = (data.get("imageWidth"), data.get("imageHeight"))
    screen = (data.get("screenWidth"), data.get("screenHeight"))
    expected = (data.get("expectedWidth"), data.get("expectedHeight"))
    png_exists = path.with_suffix(".png").exists()
    png_bytes = path.with_suffix(".png").stat().st_size if png_exists else None
    lines = [
        f"## {case}",
        "",
        f"- Mode/text scale: `{fmt(mode)}` / `{fmt(scale)}`; JSON source SHA: `{data.get('sourceSha', 'missing')}`.",
        f"- Image/screen/expected dimensions: `{native}` / `{screen}` / `{expected}`; JSON flags: {', '.join(flags)}.",
        f"- Initial/current frame: `{fmt(data.get('initialFrame'))}` / `{fmt(data.get('frame'))}`; newest time `{fmt(data.get('initialNewestMs'))}` → `{fmt(data.get('newestMs'))}` ms; ticks advanced `{fmt(data.get('ticksAdvanced'))}`.",
        f"- Screenshot pair: PNG `{ 'present' if png_exists else 'absent' }`" + (f" ({png_bytes:,} bytes)." if png_bytes is not None else "."),
    ]

    texts = data.get("texts")
    if isinstance(texts, list):
        overflow = [t for t in texts if t.get("overflow") is True or t.get("truncated") is True]
        absent = sum("overflow" not in t or "truncated" not in t for t in texts)
        lines.append(f"- TMP rows: {len(texts)}; captured overflow/truncated flags true: {len(overflow)}; one or both flags absent: {absent}.")
        for t in overflow:
            lines.append(f"  - Flagged `{t.get('path', '?')}`: overflow={fmt(t.get('overflow'))}, truncated={fmt(t.get('truncated'))}, text={t.get('text', '')!r}, rect={vector_text(t.get('rect'))}, preferred={vector_text(t.get('preferred'))}, bounds={rect_text(t.get('bounds'))}.")
    else:
        lines.append("- TMP rows: field absent; overflow status unknown.")

    graphics = data.get("graphics")
    if isinstance(graphics, list):
        color_counts = collections.Counter()
        alpha_exceptions = []
        canvas_rows = 0
        canvas_nondefault = []
        for g in graphics:
            color = g.get("color")
            renderer = g.get("rendererColor")
            color_alpha = color[3] if isinstance(color, list) and len(color) > 3 else None
            renderer_alpha = renderer[3] if isinstance(renderer, list) and len(renderer) > 3 else None
            color_counts[(g.get("type", "?"), color_alpha)] += 1
            groups = g.get("canvasGroups")
            if isinstance(groups, list):
                canvas_rows += 1
                for group in groups:
                    if not isinstance(group, dict):
                        canvas_nondefault.append((g, group))
                    elif group.get("alpha", 1) != 1 or group.get("interactable", True) is False or group.get("blocksRaycasts", True) is False:
                        canvas_nondefault.append((g, group))
            elif "canvasGroups" not in g:
                canvas_rows += 1  # field absent is recorded separately below
            if color_alpha is not None and (color_alpha < .999 or renderer_alpha is not None and renderer_alpha < .999):
                alpha_exceptions.append((g, color_alpha, renderer_alpha))
        compact = ", ".join(f"{typ} a={fmt(alpha)} ×{n}" for (typ, alpha), n in sorted(color_counts.items(), key=lambda item: (str(item[0][0]), str(item[0][1]))))
        canvas_absent = sum("canvasGroups" not in g for g in graphics)
        lines.append(f"- Graphics rows (active and inactive components): {len(graphics)}; component-color alpha distribution: {compact or 'none'}; CanvasGroup arrays absent on {canvas_absent} rows, present-empty on {sum(isinstance(g.get('canvasGroups'), list) and not g['canvasGroups'] for g in graphics)} rows.")
        if alpha_exceptions:
            alpha_groups = collections.defaultdict(list)
            for g, ca, ra in alpha_exceptions:
                alpha_groups[(g.get("type", "?"), ca, ra)].append(g.get("path", "?"))
            lines.append("- Non-opaque component-alpha exceptions (tints, not automatically defects):")
            for (typ, ca, ra), paths in sorted(alpha_groups.items(), key=lambda item: (str(item[0][0]), str(item[0][1]), str(item[0][2]))):
                examples = ", ".join(f"`{p}`" for p in paths[:3])
                more = f" (+{len(paths) - 3} more)" if len(paths) > 3 else ""
                lines.append(f"  - {typ} color alpha `{fmt(ca)}` / renderer alpha `{fmt(ra)}`: {len(paths)}; examples {examples}{more}.")
        if canvas_nondefault:
            lines.append("- Non-default captured CanvasGroup exceptions:")
            for g, group in canvas_nondefault:
                lines.append(f"  - `{g.get('path', '?')}`: `{group}`.")
        elif canvas_absent == 0:
            lines.append("- Captured CanvasGroup arrays contain no non-default group values.")
    else:
        lines.append("- Graphics alpha/CanvasGroup fields absent; opacity state unknown.")

    controls = data.get("controls")
    if isinstance(controls, list):
        exposed = [c for c in controls if c.get("interactable") is True and c.get("insideScreen") is True]
        widths = [c.get("width") for c in exposed if isinstance(c.get("width"), (int, float))]
        heights = [c.get("height") for c in exposed if isinstance(c.get("height"), (int, float))]
        smallest = min(exposed, key=lambda c: c.get("width", math.inf) * c.get("height", math.inf), default=None)
        smallest_text = f"{smallest.get('path')} `{fmt(smallest.get('width'))}×{fmt(smallest.get('height'))} px`" if smallest else "—"
        lines.append(f"- Control centers: {len(controls)} sampled; self-hit `{sum(c.get('centerHitsSelf') is True for c in controls)}/{len(controls)}`; top-hit differs from self `{sum(c.get('topHit') != c.get('path') for c in controls)}`; exposed in-screen interactable controls `{len(exposed)}`; independent min width/height `{fmt(min(widths) if widths else None)}×{fmt(min(heights) if heights else None)} px; smallest-area exposed target: {smallest_text}.")
        for c in controls:
            if c.get("centerHitsSelf") is False or c.get("insideScreen") is False or c.get("topHit") != c.get("path"):
                lines.append(f"  - Raycast/bounds exception `{c.get('path', '?')}`: centerHitsSelf={fmt(c.get('centerHitsSelf'))}, topHit={c.get('topHit')!r}, insideScreen={fmt(c.get('insideScreen'))}, bounds={rect_text(c.get('bounds'))}, size={fmt(c.get('width'))}×{fmt(c.get('height'))}.")
    else:
        lines.append("- Control-center raycast/bounds fields absent; pointer-target state unknown.")

    roots = data.get("uiRoots")
    if isinstance(roots, list):
        wanted = {"PlayerHUD", "VitalsPanel", "CombatActions", "BuildStrip", "Rewards", "BuildDrawer", "TacticalMap", "Minimap", "WishPanel"}
        lines.append("- HUD/map root records (active state is reported, including intentionally hidden roots):")
        for root in roots:
            if root.get("name") in wanted:
                lines.append(f"  - `{root.get('name')}` activeSelf={fmt(root.get('activeSelf'))}, activeInHierarchy={fmt(root.get('activeInHierarchy'))}, bounds={rect_text(root.get('bounds'))}, anchors={vector_text(root.get('anchorMin'))}→{vector_text(root.get('anchorMax'))}.")
    else:
        lines.append("- UI root bounds/active-state fields absent.")

    map_state = data.get("mapState")
    if isinstance(map_state, dict):
        lines.append(f"- Map state: open={fmt(map_state.get('isOpen'))}, planning={fmt(map_state.get('isPlanning'))}, blocksKeyboard={fmt(map_state.get('blocksKeyboard'))}, blocksPointer={fmt(map_state.get('blocksPointer'))}; minimap saved key present={fmt(map_state.get('savedScaleKey'))}, saved index={fmt(map_state.get('savedScaleIndex'))}, loaded scale={fmt(map_state.get('loadedScale'))}.")
    else:
        lines.append("- Map/minimap state absent.")

    surfaces = data.get("surfaces")
    if isinstance(surfaces, list):
        lines.append("- Captured map surfaces:")
        for surface in surfaces:
            alpha_counts = surface.get("textureAlphaCounts")
            if isinstance(alpha_counts, list):
                hist = ", ".join(f"{item.get('alpha')}×{item.get('count')}" for item in alpha_counts)
            else:
                hist = "histogram absent"
            lines.append(f"  - `{surface.get('path', '?')}` {fmt(surface.get('textureWidth'))}×{fmt(surface.get('textureHeight'))}, raw alpha={fmt(surface.get('rawImageAlpha'))}, CPU-readable={fmt(surface.get('textureReadable'))}; alpha histogram: {hist}.")
    else:
        lines.append("- Map surface alpha/readback fields absent.")

    camera = data.get("cameraInfo")
    if isinstance(camera, dict):
        lines.append(f"- Camera: orthographic={fmt(camera.get('orthographic'))}, size={fmt(camera.get('orthographicSize'))}, aspect={fmt(camera.get('aspect'))}, position={vector_text(camera.get('position'))}.")
    else:
        lines.append("- Camera facts absent.")

    actors = data.get("actors")
    if isinstance(actors, list):
        actor_one = next((actor for actor in actors if actor.get("uniqueObservedId") == 1), None)
        if actor_one is not None:
            lines.append(f"- Actor 1 anchor sample: delivered anchor matches `{fmt(actor_one.get('matchingDeliveredAnchorCount'))}`, root world anchor `{vector_text(actor_one.get('rootWorldAnchor'))}`, delivered `{vector_text(actor_one.get('deliveredAnchor'))}`, local scale `{vector_text(actor_one.get('rootLocalScale'))}`, lossy scale `{vector_text(actor_one.get('rootLossyScale'))}.")
        else:
            lines.append("- Actor 1 anchor sample absent.")
    else:
        lines.append("- Actor anchor fields absent.")
    return "\n".join(lines)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--layouts", type=Path, default=DEFAULT_LAYOUTS, help="directory containing capture JSON/PNG pairs")
    parser.add_argument("--out", type=Path, help="optional Markdown output path; stdout if omitted")
    args = parser.parse_args()
    files = sorted(args.layouts.glob("*.json"))
    if not files:
        raise SystemExit(f"no capture JSON files found under {args.layouts}")
    report = [
        "# Native layout capture metadata summary",
        "",
        f"Input: `{args.layouts}`. JSON fields are reported as captured; missing fields remain unknown. TMP flags and raycast records are metadata, not rendered-layout acceptance. Alpha values describe component tint; they are not an assertion that the final raster is opaque/transparent.",
        "",
        f"Capture JSONs found: {len(files)}. No pass criteria are synthesized by this script.",
        "",
    ]
    for path in files:
        report.append(summarize(path))
        report.append("")
    output = "\n".join(report)
    if args.out:
        args.out.write_text(output)
    else:
        print(output)


if __name__ == "__main__":
    main()
