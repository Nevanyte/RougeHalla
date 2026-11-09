# Attempt03 rendered review

This is a separate inspection of actual attempt03 PNGs and their finite routed input sequence. It leaves [report.json](attempt-03/report.json) unchanged at **PARTIAL**, with its HUD/help/journal/drawer/planning checks OPEN. Observations below cover a single production Web build at2560×1440/DPR1 in the pinned headed Chrome/Metal environment.

| Capture / action | Observed pixels | Scope |
| --- | --- | --- |
| [02 owned profile](attempt-03/02-owned-profile.png) | Synthetic callsign `ui14mw8zlpf2`, zeroed public records and selected faction. No access code, recovery token or owner credential visible. | Profile raster privacy only; credentials were supplied through the real masked form before this capture. |
| [03 active HUD](attempt-03/03-active-hud.png) | Stats top-left; health bottom-left; separated action controls low-center; large minimap bottom-right. World terrain shows through navy surfaces, while visible glyphs/text retain colour and opacity. No cyan fill or obvious overlapping HUD groups. | Placement/translucency/readability at this size; no numerical contrast measurement, exact20% actor-scale verification or other resolution claim. |
| [06 Help](attempt-03/06-help.png) | Help opens with legible text; world environment and actor cues remain visible through the translucent panel. | One real open/close sequence. The recorded Help key window has no unintended world commands. |
| [07 active journal](attempt-03/07-active-journal.png) | Journal opens and says **“Quest journal unavailable.”** Combat stats/health/action HUD are suppressed; world actors/overhead cues remain visible beneath glass. | Actual unavailable-state dialog only. No populated quest/trader/planning-J acceptance. Recorded J key window has no unintended world commands. |
| [08 drawer top](attempt-03/08-drawer-top.png) | First rows and coloured card glyphs render immediately. No cyan fill. | Visible rows only. Some tile areas are very dark; the images do not establish whether that is intentional art styling. |
| [09 first selection](attempt-03/09-drawer-first-selection.png) | Clicking Offense I changes the highlighted card and detail footer. | Real canvas click followed by visible detail change. |
| [10 wheel](attempt-03/10-drawer-scrolled.png) | Wheel changes which rows occupy the card viewport. | Partial scroll demonstrated; full catalogue bottom/reachability was not tested. |
| [11 scrolled selection](attempt-03/11-drawer-scrolled-selection.png) | Selecting Soul Offence II changes the visible highlight and footer to `Soul Offence II · +21 Soul Offence · Magic, Dot`. | A second real selection after scrolling. |
| [12 outside viewport click](attempt-03/12-drawer-outside-viewport-click.png) | The recorded gap click outside the card viewport leaves the Soul Offence II detail unchanged. Focus tint can differ without changing the retained detail. | One clipped-area input subcase; no direct inspection/export of internal GraphicRaycaster hit results. |
| [13 covered header click](attempt-03/13-drawer-hidden-global-help-click.png) | Clicking the global Help coordinate while the drawer covers it leaves the drawer open. | One tested covered control. |
| [14 restored header Help](attempt-03/14-restored-header-help.png) | After Escape closes the drawer, clicking the same now-visible header control opens Help. | Visible restoration after that specific close/click sequence. |

The main reviewer and a second read-only reviewer inspected the current captures. The second reviewer independently verified all14 screenshot lengths, SHA-256 hashes and PNG dimensions against the unchanged raw report. Earlier attempt02 also retains its own14 captures, but it remains an automated FAIL.

These observations support the listed rendered subcases. They do not establish a complete modal/input matrix, full catalogue navigation, full-game or performance acceptance. Root retains admission of the rendered rows.
