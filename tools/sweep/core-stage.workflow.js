// Reusable Claude Code workflow for one stage of the core sweep (docs/sweep/README.md). Invoke with the Workflow tool:
// scriptPath tools/sweep/core-stage.workflow.js, args {scratch: <a writable temp dir for review worktrees>, base: <sha>,
// packages: [{id, title, spec, resume?, resume_note?}]} (specs: docs/sweep/PACKAGES.md): independent packages in parallel,
// all on one base. Or args {scratch, base, chains: [[pkg, pkg, ...], ...]}: chains run in parallel; inside a chain each
// package is STACKED on the previous package's final branch (its fix branch if it had one), so a dependent package starts
// without waiting for the coordinator's merge; a chain stops if a package is still blocked after its fix and re-review.
// args.split_review (or pkg.split_review) splits each review over three Opus agents (contracts, proofs, safety).
// Optional args.audit overrides the audit record path. Implementers and fixers run on Sonnet (a package may set model/effort for
// a consequential design), reviewers on Opus (owner policy).
export const meta = {
  name: 'core-stage',
  description: 'Implement one stage of the core improvement plan: packages in isolated worktrees, independent review, fixes',
  phases: [
    { title: 'Implement', detail: 'one Sonnet engineer per package, in its own git worktree and branch', model: 'sonnet' },
    { title: 'Review', detail: 'independent Opus review of each branch against its spec and the contracts', model: 'opus' },
    { title: 'Fix', detail: 'Sonnet engineer addresses blocking review findings on a follow-up branch', model: 'sonnet' },
  ],
}

const SP = args.scratch
const brief = (BASE) => `Repository: the Roguehalla monorepo (your cwd is an isolated git worktree of it). Main branch of this effort: optimization_port. Base revision for this stage: ${BASE} (verify with git log -1; if your worktree HEAD differs, run git checkout --detach ${BASE} before anything else). If the base is a package branch that is not merged into optimization_port yet, that is intended (stacked packages): build on it. Roguehalla is being ported from a TypeScript game (packages/, legacy, keep it untouched and runnable) to a Rust authoritative server (crates/) and a Unity client (client-unity/). docs/MIGRATION.md, docs/CONTRACTS.md, docs/adr/ and docs/backlog/ describe the state.

THE GOAL (owner, verbatim): "do a final optimization sweep, and make provable improvements to the architecture as this will be the core for the rest of the project. The architecture should NOT be 1:1 as legacy version but in new languages but should also be substantially improved." Gameplay must stay identical to legacy: the parity harness keeps matching exactly. Non-negotiables: rh-sim stays pure (no I/O, clock, entropy, HashMap iteration); fixed 20 Hz step; the legacy ORDER of tick systems is never changed (C-TICK); every actor acts only through validate + Sim::submit (C-INPUT); observations never leak hidden state (C-OBS); secrets never leave the server (C-RNG); f64 operation order and A* tie-breaking stay exactly as they are (bit-identical results); any wire change bumps PROTOCOL_VERSION, regenerates the golden vectors and the C# mirror must pass. No ML of any kind. No model identifiers in commits, code or docs.

THE PLAN: a measured audit produced an ordered plan. The full record is ${args.audit || 'docs/sweep/audit_result.json'} (relative to the repository root): keys "architect" (summary, target_architecture, harness, packages[], rejected[], bugs[]), "critic" (issues[] per package, missing[]), and "audit:<lens>" (each with proposals[] carrying the detailed designs by id, e.g. SA1, SH2, OW1, SD5, SE6, LC2, and baseline_measurements). READ your package's entry in architect.packages (its id may be the unsplit parent, e.g. P2 for P2a), every proposal it includes (find them by id in the audits), and every critic issue for it. The coordinator's amendments in your assignment below OVERRIDE the plan where they differ. Verify claims against the code before relying on them.

WORKING RULES:
- First: git checkout -b pkg/<your package id> (e.g. pkg/P1). Commit your work there (several commits are fine). Do NOT push, do NOT touch other branches, do NOT merge.
- Stay inside your write scope. If you truly must touch a file outside it, keep the change minimal and list it under deviations.
- Do not edit the shared status records: the checkpoint and tables in docs/MIGRATION.md and the status table in docs/CONTRACTS.md. Propose their text in contract_text_proposals instead. Do not add dependencies or change Cargo.lock unless your assignment authorizes it.
- Keep every existing test passing and add the tests your package needs. Prefer small, reviewable commits. Every commit message ends with exactly these two lines:
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01QQocgaHcm3R5i2ca874umN
- Machine: other packages build in parallel in their own worktrees. Wall-clock timings are noise; prove with deterministic counts (perfproof needs valgrind on Linux: on macOS run it in the Linux container described in docs/sweep/README.md).
- Disk discipline (mandatory): before any cargo command run: export CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=line-tables-only CARGO_PROFILE_TEST_DEBUG=line-tables-only (smaller target dirs; no behaviour change). Run perfproof with --only <the workloads your proofs need> unless you need all, and rm -rf target/perfproof right after. If df -h / shows less than 3 GB free, run cargo clean in your worktree before continuing.

GATES (run all before you finish; report the results honestly, with numbers; a failing gate is reported as failing, never hidden):
1. cargo fmt --all --check
2. cargo clippy --workspace --all-targets --all-features -- -D warnings
3. eval "$(tools/pgtest/start.sh)" (a shared throwaway PostgreSQL is already running; this prints its URL; never stop it) then cargo test --workspace --all-features
4. cargo run -p rh-parity --bin parity-report: its last line must say all MATCH (13 slice scenarios + 1 capture-only and 300 pathfinding queries at the stage-2 base; more if you add fixtures)
5. If you touched client-unity: PATH=$HOME/.dotnet:$PATH DOTNET_CLI_TELEMETRY_OPTOUT=1 dotnet test client-unity/RoguehallaNet.Tests, and bash client-unity/sync-net.sh --check (run bash client-unity/sync-net.sh to sync first)
6. If you touched the wire, the server's frames or observations: cargo build -p rh-server && node tools/browser-proof/proof.mjs (Playwright 1.63.0 and Chromium are preinstalled; if the playwright module is missing in your worktree run npm i --no-save playwright@1.63.0)
7. python3 tools/perfproof/perfproof.py --baseline ${BASE} (read its --help: workloads include sim_*, paths_300, wire_seed1_8bots, headless_*, headless_seed1_recorded and verify_replay, which verifies base-recorded replays on both binaries; gate flags --max-ir-ratio etc.) (deterministic callgrind/DHAT A/B of your working tree vs the base; it builds both into target/perfproof, ~10 min; add workloads with --only if useful). Paste its table into your report. Behaviour fingerprints must be identical unless your package declares the change. Then rm -rf target/perfproof to free disk.
Finally delete your worktree's target/ directory contents only if disk is below 5 GB free (df -h /).

Return the structured report. head_sha must be the final commit of your branch.`

const REPORT = {
  type: 'object',
  properties: {
    package: { type: 'string' }, branch: { type: 'string' }, head_sha: { type: 'string' },
    summary: { type: 'string' },
    changes: { type: 'array', items: { type: 'string' } },
    gates: { type: 'array', items: { type: 'object', properties: { gate: { type: 'string' }, result: { type: 'string' }, pass: { type: 'boolean' } }, required: ['gate', 'result', 'pass'] } },
    perfproof_table: { type: 'string' },
    proofs: { type: 'array', items: { type: 'object', properties: { metric: { type: 'string' }, threshold: { type: 'string' }, result: { type: 'string' }, pass: { type: 'boolean' } }, required: ['metric', 'threshold', 'result', 'pass'] } },
    deviations: { type: 'array', items: { type: 'string' } },
    contract_text_proposals: { type: 'array', items: { type: 'string' } },
    followups: { type: 'array', items: { type: 'string' } },
  },
  required: ['package', 'branch', 'head_sha', 'summary', 'changes', 'gates', 'proofs', 'deviations'],
}
const REVIEW = {
  type: 'object',
  properties: {
    verdict: { type: 'string', enum: ['accept', 'fix-required'] },
    blocking: { type: 'array', items: { type: 'object', properties: { file: { type: 'string' }, line: { type: 'number' }, problem: { type: 'string' }, fix: { type: 'string' } }, required: ['file', 'problem', 'fix'] } },
    nonblocking: { type: 'array', items: { type: 'string' } },
  },
  required: ['verdict', 'blocking', 'nonblocking'],
}

const reviewPrompt = (pkg, rep, BASE, extra, section) => `You are an independent senior reviewer${section ? ` covering ONE SECTION of a review split across three reviewers (the other two cover the other sections; stay inside yours): ${section.focus}` : ''}. Do NOT edit files, commit or switch branches in the main checkout (/home/user/RougeHalla, branch optimization_port). Use read-only git (git diff ${BASE}..${rep.branch}, git show, git log) and read files at that revision with git show ${rep.branch}:<path>. You may create a throwaway worktree under ${SP}/review-${pkg.id} (git worktree add --detach ${SP}/review-${pkg.id}${section ? '-' + section.key : ''} ${rep.branch}) to build and run tests or perfproof there, and must remove it when done (git worktree remove --force).

Context:
${brief(BASE).slice(0, 2700)}

The package spec the engineer was given:
${pkg.title}
${pkg.spec}

The engineer's report (claims to verify, not to trust):
${JSON.stringify(rep)}
${extra || ''}
Review the branch diff for: behaviour changes that would break parity or a contract (f64 operation order, A* tie-breaking, event order, observation contents, hashing/checkpoint coverage, C-TICK/C-INPUT/C-OBS/C-RNG); proofs that are not real (thresholds not met, numbers not reproducible, fingerprints that differ); spec items silently skipped; tests that would not catch a regression; writes outside scope; unsafe or panicking paths introduced; docs that overstate. Re-run the cheap gates that matter for your doubts. Blocking = must be fixed before merge. Be concrete (file:line, fix).`

// A split review (args.split_review or pkg.split_review) spreads one review over three shorter Opus agents, one section
// each, so a container restart or a timeout loses less; their findings are merged and any blocking finding blocks.
const SECTIONS = [
  { key: 'contracts', focus: 'BEHAVIOUR AND CONTRACTS: parity and bit-identity (f64 operation order, A* tie-breaking, event order), observation contents and leaks, hashing/checkpoint coverage, wire compatibility, C-TICK/C-INPUT/C-OBS/C-RNG/C-NET/C-PERSIST.' },
  { key: 'proofs', focus: 'PROOFS AND TESTS: every claimed number and threshold reproduced or shown wrong, fingerprints, spec items silently skipped, tests that would not catch a regression (mutate the code to check the important ones).' },
  { key: 'safety', focus: 'SAFETY AND SCOPE: panics and unbounded growth reachable from untrusted input, concurrency and races, resource limits, writes outside the declared scope, docs that overstate.' },
]
async function review(pkg, rep, BASE, label, extra) {
  if (!(args.split_review || pkg.split_review)) {
    return agent(reviewPrompt(pkg, rep, BASE, extra), { label, phase: 'Review', schema: REVIEW, model: 'opus', effort: 'high' })
  }
  const parts = (await parallel(SECTIONS.map(sec => () => agent(reviewPrompt(pkg, rep, BASE, extra, sec),
    { label: `${label}:${sec.key}`, phase: 'Review', schema: REVIEW, model: 'opus', effort: 'high' })))).filter(Boolean)
  if (parts.length < SECTIONS.length) log(`${label}: ${SECTIONS.length - parts.length} review section(s) returned nothing`)
  if (!parts.length) return null
  const blocking = parts.flatMap(p => p.blocking)
  return { verdict: blocking.length ? 'fix-required' : 'accept', blocking, nonblocking: parts.flatMap(p => p.nonblocking),
    sections_missing: SECTIONS.length - parts.length }
}

async function runPackage(pkg, BASE) {
  const B = brief(BASE)
  const rep = await agent(`${B}\n\nYOUR ASSIGNMENT: package ${pkg.id}: ${pkg.title}\n\n${pkg.resume ? `RESUMING: an earlier engineer started this package and was stopped. Do NOT create pkg/${pkg.id}; instead run git checkout ${pkg.resume} (it is not checked out anywhere else). Its commits so far: ${pkg.resume_note}. Read them (git log -p ${BASE}..HEAD) and the spec, then finish the remaining work, keeping their design unless it is wrong (say so). Your report covers the whole package (branch = ${pkg.resume}).\n\n` : ''}${pkg.spec}`,
    { label: `impl:${pkg.id}`, phase: 'Implement', schema: REPORT, isolation: 'worktree', model: pkg.model || 'sonnet', effort: pkg.effort || 'medium' })
  if (!rep) return null
  const rv = await review(pkg, rep, BASE, `review:${pkg.id}`)
  const x = { rep, rv, base: BASE, final_branch: rep.branch, final_head: rep.head_sha, accepted: !!rv && !rv.sections_missing && (rv.verdict === 'accept' || !rv.blocking.length) }
  if (!rv || x.accepted) return x
  const fix = await agent(`${B}\n\nYOUR ASSIGNMENT: fix the blocking review findings on package ${pkg.id} (${pkg.title}). Instead of creating pkg/${pkg.id}, run: git checkout -b pkg/${pkg.id}-fix ${rep.branch} (the original branch is ${rep.branch} at ${rep.head_sha}). Fix every blocking finding below (or explain precisely why one is wrong, with evidence), re-run all gates, commit, and return the full structured report for the package as it now stands (branch = pkg/${pkg.id}-fix).\n\nPACKAGE SPEC:\n${pkg.spec}\n\nBLOCKING FINDINGS:\n${JSON.stringify(rv.blocking)}\n\nNON-BLOCKING NOTES (address if cheap):\n${JSON.stringify(rv.nonblocking)}`,
    { label: `fix:${pkg.id}`, phase: 'Fix', schema: REPORT, isolation: 'worktree', model: pkg.model || 'sonnet', effort: pkg.effort || 'medium' })
  x.fix = fix
  if (!fix) return x
  x.final_branch = fix.branch; x.final_head = fix.head_sha
  if (args.chains) {
    // Stacked work builds on this branch: confirm the fix before the next package depends on it.
    const rv2 = await review(pkg, fix, BASE, `rereview:${pkg.id}`, `\nThis is a RE-REVIEW after a fix pass. The earlier blocking findings were:\n${JSON.stringify(rv.blocking)}\nCheck each is resolved (or convincingly refuted) and that the fix introduced nothing new.\n`)
    x.rereview = rv2
    x.accepted = !!rv2 && !rv2.sections_missing && (rv2.verdict === 'accept' || !rv2.blocking.length)
  }
  return x
}

if (args.chains) {
  const out = await parallel(args.chains.map((chain, ci) => async () => {
    let base = args.base
    const done = []
    for (const pkg of chain) {
      const r = await runPackage(pkg, pkg.base || base)
      done.push(r ? { id: pkg.id, ...r } : { id: pkg.id, failed: true })
      if (!r || !r.accepted) { log(`chain ${ci}: ${pkg.id} not accepted; stopping this chain`); break }
      base = r.final_head
      log(`chain ${ci}: ${pkg.id} accepted at ${r.final_branch} ${r.final_head}`)
    }
    return done
  }))
  return out
}
const results = await pipeline(args.packages, (pkg) => runPackage(pkg, args.base))
return results
