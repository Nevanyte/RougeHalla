export const meta = {
  name: 'sentenced-redesign',
  description: 'Implement the owner Sentenced redesign (tiered % max-HP mark, attack-speed tax, execute denial, kill-stacks, Trial retune, cards, UI), tune, review, fix, then merge, push and deploy live, all with Sonnet agents',
  phases: [
    { title: 'Core', detail: 'contract doc, then shared/server/python implementation and tests' },
    { title: 'Client', detail: 'UI: tier pips, tax and execute-denial icons, kill-stack counter, Trial ring' },
    { title: 'Tune', detail: 'measure and tune the four Sentenced edges against the balance targets' },
    { title: 'Review', detail: 'two Sonnet reviewers: sim/balance and client' },
    { title: 'Fix', detail: 'apply the real findings' },
    { title: 'Release', detail: 'gates, merge to main, push, live deploy' },
  ],
}

const X = '/Users/nevinmckinnon/Documents/Projects/RougeHalla/.claude/worktrees/sentenced-redesign'
const MM = '/Users/nevinmckinnon/Documents/Projects/RougeHalla/.claude/worktrees/main-merge'
const SL = '/Users/nevinmckinnon/Documents/Projects/RougeHalla/.claude/worktrees/site-live'
const S = '/private/tmp/claude-501/-Users-nevinmckinnon-Documents-Projects-RougeHalla/2fecac89-094f-4d8a-a460-aef8d4be96c5/scratchpad'
const SPEC = args

const RULES = `
Repository: RogueHalla (Phaser 4 client + Colyseus 0.18 authoritative server, npm workspaces; Python design tools in testing/). Your worktree is ${X} (branch claude/sentenced-redesign from main c977910; node_modules is linked). Use absolute paths or cd only into ${X} and its subfolders. Never touch /Users/nevinmckinnon/Documents/Projects/RougeHalla itself or another worktree, never git stash, never push, never touch ports 2600, 2567 or 5173 (use 2821/5821 if you need a browser check). Read CLAUDE.md first: its architecture rules bind (authoritative server, pure sim, fixed tick order, the ledger and payLater, stat mirrors as the one source of truth, AS_MULT_CAP, wire tables append-only, status runtime rules). Keep comments sparse and match the surrounding style. Commit with: git -c user.name=Nevanyte -c user.email=34900448+Nevanyte@users.noreply.github.com commit (no attribution lines).`

const DECISIONS = `
ORCHESTRATOR DECISIONS (they override the spec where they differ):
D1 The spec's numbers and names for OTHER factions (HP, armor, "Rat King", "Radiant", "Dragonslayer", rates) are illustrative. Use the repo's real sheet (shared/src/factions.ts after the balance pass) and real mechanic names. Sentenced's own baseline in the spec (850 hp, 0.90/s x 10, armor 125, shield 210) is the starting point; tuning may move it.
D2 Execute denial: while a Sentenced holds a tier-4 mark on a target, that target's execute effects (Plague's execute band, Pestilence, any execute card) cannot take THAT Sentenced below 1 hp; the would-be execute bonus is converted into the pulse (the 1.5x amplifier lingers 2 s more and the Sentenced gains +1 kill-stack, at most once per mark). Do it inside the ledger rules (decide from the pass-start snapshot; no order dependence).
D3 Kill-stacks count PLAYER kills by the Sentenced only (not mobs, not bots? bots count as players for this), cap 5, reset each run, not banked. Shown on the Sentenced's build strip.
D4 The attack-speed tax uses the target's faction attack rate times its card/buff attack-speed multiplier (not the weapon boost): r -> r if r <= 1.0, else min(1.6, 1 + (r - 1) * 0.5). Implement it as a world.modSources entry (asMult factor taxed/r) so the stat mirrors stay the one source of truth and AS_MULT_CAP/G9 apply; it must call recomputeMods when it starts or ends. Applies to mobs too (server-side, no mirror).
D5 Do NOT ship Respite (spec section 4 is optional). Ship Trial retuned.
D6 Ship the spec's five cards (Heavier Sentence, Swift Judgment, Gallows' Patience, No Commutation, Final Verdict) in shared/src/cards.ts. Card text must NEVER name a faction, the word "Sentenced" or a weapon (owner rule: builds are discovered, not forced): word them in mechanic terms ("your marks", "a marked enemy", "your zone Wish"). Conditional ones require their base (Vitality, Haste). The catalog grows 75 -> 80: update every count, test and doc.
D7 Sentenced-zone mobs mark players with the new mark too (scaled like their other numbers), without kill-stacks.
D8 Keep BEATS unchanged (Sentenced beats Plague and Frost, loses to Fire and Holy). Do not retune other factions unless a Sentenced edge cannot meet the targets otherwise; if you must, keep all other edges inside the targets.
D9 Targets (the balance pass's criteria, testing/TUNING_BALANCE.md and the balance report): each Sentenced edge's favourite wins 60-76% pooled with the underdog >= 24%, the favourite ends a fair fight with 10-35% hp; TTK curve still about 20 s at minute 0 falling toward ~5 s at minute 5; Sentenced's overall win share in an all-faction bot tournament within 45-55% if the tournament tool can report it.
D10 Update the Python design tools (testing/classes.py, testing/realtime.py, testing/test_rpsls.py identity tests, testing/weapon_reference.py and the parity tables pasted into shared/test/weapons.test.ts and server/src/harness/parity.ts) so npm run harness:factions -- --python agrees and python3 testing/test_rpsls.py passes with the new mark.
D11 Wire: new synced fields (mark tier, marker id, kill-stacks, tax/denial bits) are APPENDED to their schemas; new fx, status or effect-bit kinds are appended at the end of their tables; never reorder.`

const CONTRACT = `${X}/docs/SENTENCED_REDESIGN.md`

phase('Core')
const core = await agent(RULES + DECISIONS + `
THE OWNER'S SPEC (implement it, adapted by the decisions above):
<spec>
${SPEC}
</spec>
RESUMING: two previous runs were cut off (a usage limit, then an expired login). The contract is committed (9dce8c0, ${CONTRACT}) and WORK-IN-PROGRESS core commits sit on top (74d002f: shared/src/mark.ts, sim factions/ledger/mods/status/abilities, cards, schema, Python model; f18c08f: faction sheet and Python model; NOT green). Start by reading the contract and git -C ${X} diff 9dce8c0..HEAD, keep what is right, and finish the job below; do not rewrite the contract unless something in it is wrong.
YOUR JOB (core):
1. Read the current Sentenced implementation end to end (shared factions.ts, signatures.ts, cards.ts (Gathering Storm and markRate), abilities.ts (Trial), status.ts, server sim/factions.ts (mark, engagement, staggerPause), sim/abilities.ts (Trial), sim/ledger.ts, sim/mods.ts, mobs, the Python model in testing/). Then write the contract ${CONTRACT}: the exact rules, numbers, synced fields, hooks, tick placement, file list, and how each spec item maps to repo code, including the decisions above. Commit it.
2. Implement the shared + server + Python parts: the tiered mark (tiers by hits landed while marked and by the target's weapon swaps, one-way within a mark, reset on a new mark), % max-HP true damage per Sentenced weapon hit (tier 1 base, kill-stack bonus, tier-4 1.5x amplifier, the 300 u proximity halving overridden inside Trial), the tier-2 attack-speed tax (D4), tier-3 output suppression (target deals 20% less, through the outgoing multiplier fixed at pass start), tier-4 execute denial (D2), kill-stacks (D3), the Trial retune (300 u ring, shrinks to 200 u if the target is tier 3+ when it lands, leaving stuns 1 s, mark at full strength inside), the five cards (D6), mobs (D7). Remove the old ramp-and-reset-on-swap mark cleanly (and its cards' rows that no longer apply: retarget Gathering Storm to speed tier promotion, or explain in the contract).
3. Tests: unit tests for each rule (tier promotion by hits and swaps, % damage and kill-stack math, proximity, tax math incl. the 1.6 cap and the 1.0 threshold, suppression, execute denial incl. the once-per-mark stack, Trial shrink and stun, cards), update every test the old mark touched, and the Python oracles (D10).
4. Gates: npm run typecheck, npm test, python3 testing/test_rpsls.py, npm run harness:factions -- --python (report). Commit.
Return: the contract summary, the synced fields added, files changed, gate results, commit shas, and anything left for the client (what the UI should read).`, { label: 'core:sentenced', phase: 'Core', model: 'sonnet' })

phase('Client')
const client = await agent(RULES + DECISIONS + `
The core of the Sentenced redesign is implemented on the branch; its contract is ${CONTRACT} and the core agent reported:
${core}
YOUR JOB (client UI, spec section 7, adapted): read the contract, then build: a 4-pip tier row on the marked target (grey, amber, red, black), seen by everyone, dimmed beyond 300 u from its marker; a "slowed -N%" icon while the attack-speed tax applies; a broken-skull "execute blocked" icon at tier 4; a "Sentence: k/5" kill-stack counter on the Sentenced's own build strip; the Trial ring's contraction to 200 u when it shrinks; toasts "Sentenced marked you." / "Your sentence has been carried out." / "Execute blocked - already sentenced." (repo toast style); the five new cards render in the chest panel and tooltips. Follow the client rules in CLAUDE.md (render separate from logic, overlay uses --ui-w/--ui-h, no per-frame DOM churn, presentation-only juice). Update the faction card/role text and the help card if they describe the old mark. Add client tests. Gates: npm run typecheck, env -u VITE_SERVER_URL npm run build, the client tests. Commit.
Return: what you built, files, gate results, commit sha.`, { label: 'client:sentenced-ui', phase: 'Client', model: 'sonnet' })

phase('Tune')
const tune = await agent(RULES + DECISIONS + `
The Sentenced redesign is implemented (contract ${CONTRACT}). Core report:\n${core}\nClient report:\n${client}
YOUR JOB (tuning, spec section 9 adapted to the repo's real tools): measure the four Sentenced edges (vs Plague, Frost: should win; vs Fire, Holy: should lose) and the other edges that involve Sentenced's numbers, with the balance pass's own measurement tools (find them: the matchup/edge bench used for "favourite wins 60-76%", the TTK curve script, npm run harness:factions -- --python, npm run harness -w @raid/server -- --core, python3 testing/test_kite.py, the bots tournament if it reports win share per faction, npm run questbench -w @raid/server -- --quick). Tune ONLY the redesign's numbers (tier thresholds, % per hit, kill-stack step, amplifier, tax factor and cap, suppression, Trial numbers, Sentenced hp) until the targets in D9 hold, or report clearly which cannot hold and why. Record the before/after numbers in testing/TUNING_BALANCE.md (a new Sentenced redesign section) and the contract. Keep the Python parity (D10) in step with any number you change. Gates: typecheck, npm test, test_rpsls.py. Commit.
Return: a table of the edges before and after, the final numbers, which targets hold or miss, gate results, commit sha.`, { label: 'tune:sentenced', phase: 'Tune', model: 'sonnet' })

phase('Review')
const FIND = {
  type: 'object',
  properties: { summary: { type: 'string' }, findings: { type: 'array', items: { type: 'object', properties: {
    severity: { type: 'string', enum: ['high', 'medium', 'low'] }, title: { type: 'string' }, file: { type: 'string' }, evidence: { type: 'string' }, fix: { type: 'string' },
  }, required: ['severity', 'title', 'file', 'evidence', 'fix'] } } },
  required: ['summary', 'findings'],
}
const REVIEW = RULES + DECISIONS + `\nYou are REVIEWING (read-only: no edits, no commits; you may run tests, benches and scripts) the commits on claude/sentenced-redesign since c977910 (git -C ${X} log c977910..HEAD; git -C ${X} diff c977910..HEAD). Contract: ${CONTRACT}. Reports: core:\n${core}\nclient:\n${client}\ntune:\n${tune}\nReport only real defects with evidence. high = breaks the game, an architecture rule (order dependence in the ledger, a client deciding outcomes, a wire reorder), a crash, or a target badly missed; medium = a visible bug or a rule the spec/decisions require that is missing; low = advisory.`
const reviews = await parallel([
  () => agent(REVIEW + `\nFocus: SIM, RULES AND BALANCE. Check every mark rule against the contract and the decisions (tiers, swaps, % damage, proximity, tax as a mod source with recomputeMods, suppression via the pass-start multiplier, execute denial order independence, kill-stacks player-only, Trial shrink/stun, mobs), that no reward or hook decides who survives in a pass, that the old mark is fully gone, the Python parity and the measured edges (re-run harness:factions -- --python and the tuner's edge command).`, { label: 'review:sim', phase: 'Review', schema: FIND, model: 'sonnet' }),
  () => agent(REVIEW + `\nFocus: CLIENT. The pips, icons, counter, ring contraction, toasts, card text (no faction/weapon names), overlay and render rules, and the client tests; if feasible run a short browser check on ports 2821/5821 (stop them after).`, { label: 'review:client', phase: 'Review', schema: FIND, model: 'sonnet' }),
])
const findings = reviews.filter(Boolean).flatMap(r => r.findings).filter(f => f.severity !== 'low')
const lows = reviews.filter(Boolean).flatMap(r => r.findings).filter(f => f.severity === 'low')
log(`${findings.length} high/medium findings, ${lows.length} low`)

phase('Fix')
let fixed = 'nothing to fix'
if (findings.length > 0) {
  fixed = await agent(RULES + DECISIONS + `\nFix these review findings on claude/sentenced-redesign (contract ${CONTRACT}). Verify each is real first; fix real ones with a test that fails before the fix; skip and explain the rest. Re-run typecheck, build, npm test, test_rpsls.py and harness:factions -- --python, then commit.\nFINDINGS:\n${JSON.stringify(findings, null, 1)}\nReturn what you fixed and skipped, gate results, commit sha.`, { label: 'fix:sentenced', phase: 'Fix', model: 'sonnet' })
}

phase('Release')
const release = await agent(RULES + `
You are RELEASING the finished branch claude/sentenced-redesign (worktree ${X}) to main and the live site. Stop without pushing if a gate genuinely fails.
Paths: MM = ${MM} (branch main checked out, at c977910; the owner's local game runs from here), SL = ${SL} (detached; the live site builds and serves from here), S = ${S}.
1. In ${X}: git status clean (commit leftovers only if clearly part of the feature). Run npm run typecheck, env -u VITE_SERVER_URL npm run build, npm test and python3 testing/test_rpsls.py there; re-run a failing test file alone once (timing tests flake under load); a second failure = STOP and report.
2. In MM: git status clean and HEAD c977910; git -C ${MM} -c user.name=Nevanyte -c user.email=34900448+Nevanyte@users.noreply.github.com merge --no-ff claude/sentenced-redesign -m "Merge the Sentenced redesign: a tiered mark that deals % max-HP true damage, taxes fast attackers, suppresses output and blocks executes, kill-stacks, Trial retuned, five mark cards, and the UI for it"; then git -C ${MM} push origin main.
3. Live: git -C ${SL} checkout -q --detach <main's new sha>; if package-lock.json changed since c977910 run npm ci in SL; cd ${SL} && env -u VITE_SERVER_URL npm run build. Restart port 2600: P=$(lsof -nP -iTCP:2600 -sTCP:LISTEN -t | head -1); kill $P; poll each second up to 15 s until 2600 is free and $HOME/.rougehalla/playtest-profiles.json.lock is gone; then cd ${SL} && NODE_ENV=production CLIENT_DIR=${SL}/packages/client/dist RAID_PORT=2600 STASH_FILE=$HOME/.rougehalla/playtest-profiles.json nohup node --import tsx ${S}/site-live-server.mjs > ${S}/live-server.log 2>&1 & disown; wait about 6 s; get the new PID on 2600; nohup caffeinate -ims -w <PID> >/dev/null 2>&1 & disown. Verify curl -s localhost:2600/api/health and curl -s https://play.roguehalla.com/api/health print {"ok":true} and the assets/index-*.js served by https://play.roguehalla.com/ equals the one in ${SL}/packages/client/dist/assets. Never touch the cloudflared process.
4. Local: kill the PID on 2567, wait until free, then cd ${MM}/packages/server && LOBBY_SECONDS=10 nohup node --import tsx ${S}/owner-play-server.mjs > ${S}/local-server.log 2>&1 & disown; verify localhost:2567/api/health is {"ok":true} and localhost:5173/ returns 200 (never touch 5173's process).
5. After a successful push: git -C ${MM} worktree remove --force ${X}.
Return: gate results, the pushed range, live health, the served bundle, the new server PIDs, anything unusual.`, { label: 'release:main+live', phase: 'Release', model: 'sonnet' })

return { core, client, tune, reviews: reviews.filter(Boolean).map(r => r.summary), findings, lows, fixed, release }
