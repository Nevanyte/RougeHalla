# Owner queue

Decisions waiting for the owner, one line each, with the default the coordinator applies until an answer arrives. The
coordinator edits this file in place: a row leaves when the owner answers (the answer is recorded in
[MIGRATION.md](../MIGRATION.md) and indexed in [OWNER_DECISIONS.md](../OWNER_DECISIONS.md)). To answer, name the row
number in chat: "Q18 yes".

Last updated 2026-11-14 (Q22 to Q25 added by the final combined review), after the owner's "Please go with your recommendations" closed Q18, Q19 and Q21; earlier the same day he answered Q1 to Q13 and Q15 to Q17 (MIGRATION "Owner answers 2026-11-14").
Q14 was closed by the standing instruction that emptied files stay as placeholders.

## Before the beta host goes up

| # | Question | Default in force | Record |
|---|---|---|---|
| Q22 | The beta host's three launch settings were never chosen for this deploy: `map_pool` (each room its own certified generated map, or the one fixed map), `signature_landmarks` (volcano, church, bog tree, cave; needs the pool), `lobby_timing` (`legacy`: 10 s lobby, bots at 3 s, as the last beta; or `matchmaking`: 15 s, bots at 13 s). The coordinator recommends pool on, landmarks on (what every Web round since round 9 was judged with), lobby timing as the last beta. | The host is not deployed until this is answered. | final combined review, 2026-11-14 |
| Q23 | Walking into a Frost Wall rubber-bands on the client: its walk prediction does not know about walls (the sprite walks into the ice, snaps back about 3 tiles, repeats; a click past a wall walks through, then snaps). The server is right throughout. Build the prediction fix (P-FROST-WALL-PREDICT-1) before the beta host, or deploy without it and tell testers? The coordinator recommends building it first and has started its brief. | Being built; the host waits for it unless you say otherwise. | final combined review, 2026-11-14 |

## At the pull request to `main`

| # | Question | Default in force | Record |
|---|---|---|---|
| Q24 | DEV-001 to DEV-006, DEV-008 and DEV-011 are still "pending", and DEV-007 says "confirm": early privacy and platform differences from legacy (hidden ids not leaked through tie order, id gaps or damage chunks; case-insensitive callsigns; mob separation). Sign them as a set? | They stay pending; nothing in the release depends on the signature. | final combined review, 2026-11-14; DEVIATIONS |
| Q25 | The committed `.claude/settings.json` (the shared one you approved on 2026-11-12: it allows every Bash command and names a path under your home directory) would reach `main` with the pull request and become every contributor's project setting. Intended? | The PR is opened with it; say if it should be trimmed first. | final combined review, 2026-11-14 |

## Protected path, needs your word

| # | Question | Default in force | Record |
|---|---|---|---|
| Q20 | `.claude/hooks/guard-oracles.sh` (blocks hand edits to `packages/` and the golden vectors) recognises only the main checkout and `.claude/worktrees/*`; in a lane's sibling worktree (`../RH-<lane>`) such an edit is not blocked when made (the gate's path checks still catch it before a merge). Fix the hook to resolve the path against the worktree's own top level? The coordinator recommends yes. | Hook unchanged; the gate is the backstop. | reviewer-opus on P-AGENT-RETRO-1, 2026-11-14 |

## Deferred by the owner

| # | Item | Until then | Record |
|---|---|---|---|
| Q16 | `hosting/technical-demo/README.md:199` names the old content hash; the next deploy needs protocol 18 and a rebuilt client. Owner 2026-11-14: "we can work on this later when all changes are done". | Untouched; raised again at the deploy step. | MIGRATION "Owner answers 2026-11-14" |
