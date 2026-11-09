# Compact HUD revision

Owner feedback, 2026-11-08: retain the information, reduce lower-screen obstruction, and place stats at the top-left.

This presentation-only packet is based on `46671304233af2642d71d6d9d76bf5dbfb189160`; it does not include the queued hub continuation or change gameplay, protocol, input ownership, or server publication.

| Area | Revision |
| --- | --- |
| Top-left | Vitals, barrier, kills/GV/status, potion counts, eight build categories, and one labeled Build Details button. |
| Top-right | Scrollable Wish details; temporarily yields to rewards or the tactical map. |
| Bottom-center | Compact weapon/potion controls, authoritative Wish charge summary, and pickup action. |
| Bottom-right | Smaller minimap with the existing saved scale option and movement/peek gestures. |
| Header | Help, Settings, Leave, phase/time. |
| Rewards/map | Narrower upper-right reward panel; tactical map uses the space above the smaller action bar. |

At the 1920×1080 reference, the action bar is 130 units high (previously 245), with 48-unit primary icons. The minimap has a 39% smaller base area. The Build Details target is at least 44 pixels tall at 1280×720. Build contents and the B shortcut are preserved.

Validation so far: managed runtime and Editor-test source compilation against the installed Unity assemblies; one existing unused-event warning. Source geometry checks cover 1280×720, 1920×1080, 2560×1440, and 3440×1440 with all three minimap scale endpoints/default. These checks establish panel separation, not font fit or visual acceptance. The existing owner-facts test also checks summary stock updates, no timer-based stock prediction, and immediate clearing on owner reset; its native execution is pending.

Actual first review: combined source `20f188c678a48ce7aabe78801f122944df4e27a7` passed all 85 native Editor tests. Twelve advancing offline captures covered HUD/planning/Tab at 1280×720 and 2560×1440, default and 150% text. Default HUD had no text-overflow flags. Map route instructions overflowed at both text sizes; 150% also flagged headings, status, selected boon/marker, minimap label, and diagnostic watermark. The planning footer visibly overlapped and underlying rewards showed through the map. These failed cases are retained in `~/.codex/tools/rougehalla-unity-art/combined-20f188-2026-11-08/evidence/layouts`.

The follow-up fit packet keeps the compact HUD geometry and interactions: shared controls use the body font, with explicit decorative map headings; the map backplate is opaque; route/status labels have separate footer rows and concise copy; selected/pending text remains; and headings, minimap labels, marker widths, and the offline watermark have room at larger text sizes. Route math, timing and server facts are unchanged. Managed runtime and Editor-test compilation pass; the follow-up still requires native capture and font-fit review before acceptance.

No Editor was launched or switched by this lane. Diagnostic previews remain offline synthetic data, not browser or network proof.
