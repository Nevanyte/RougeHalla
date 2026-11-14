# The look check: see a Unity presentation change before and after

Two ways to look, for two purposes. Use the first while working; only the second counts as "seen".

## 1. Editor render (an agent's before and after)

Status: the capture tool is being committed by P-UNITY-LOOK-TOOLS-1. Until that packet has landed, an agent in the
tuning lane skips the look check, says so in its report, and the coordinator's next Web round covers it.

Once landed (that packet fills in the exact commands here): one command renders a named scene (a zone scene, or a
landmark stamped from its approved drawing: wide, close, inside) through the client's real map view to an sRGB PNG;
a second command compares two PNGs and prints how many pixels differ and by how much, against the noise of one tree
rendered twice. An agent renders the scene named in the dial's row before and after its change and looks at both.

Known differences from the game, which is why this is not proof of a look:
- Plague and Sentenced scenes render darker than the Web client (measured 2026-11-13: Plague grass about 40, 75, 37
  against 104, 132, 77; Sentenced floor about 106, 89, 81 against 152, 136, 114). Cause not found. Use the render for
  differences (did my change move what it should, and nothing else), not for absolute brightness or colour.
- Test maps are small and hand-built: no pooled map's density of props, lamps and decoration bands.
- No session: no fog of war, no other players, no HUD.

## 2. Web round (what the owner is shown)

A build of the Web client run against a local server, driven in a browser, with screenshots. A look is approved only
on these. The recipe (server flags for pooled landmark maps, the build script, serving, the driver) is being written
down by the same packet as `docs/unity/WEB_ROUND.md`; until then the coordinator holds it.

Rules learned the hard way (2026-11-13):
- Never show the owner, or approve, a look from colour patches, texture composites or editor renders. Twice in one
  day a look approved that way was wrong in the client.
- A test that measures a colour model (albedo against a palette entry) says nothing about the screen: the ground is a
  shaded texture under a strong zone light. Measure rendered pixels, or do not claim the look.
