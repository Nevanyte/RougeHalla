# Delivered-cue source batch

The lead has admitted this source/Editor-validated batch through `f16bca0d`. [Admission evidence](evidence/source-cues/ADMISSION.md)
maps its original commits and limits; the runtime campaign remains deferred.

The coordinator assigned a bounded draft from proposal `88dbc5cf`. Prop draft `4e51582b3f7662cfae0f885c232661012994bf24` and signature draft `8de291337bef904ec8c86baeb54dab05a25c5ba5` are separate reviewable commits; preview selector draft `01ce403d19b6fe405b652a1404bc29c7ead57a9d` is also included in the validated source head. The prop scope excludes Body/Corpse changes, readiness clocks and extra labels. Source head `04d8de08561007239dcf7ef57ab9cafd751b8393` compiled in Unity `6000.0.85f2`; all 42 filtered EditMode tests passed, including the 14 new cue regressions. Portable run details and raw hashes are in [source-cue evidence](evidence/source-cues/summary.json).

No Player/Web build, browser proof, profile/performance, visual, or accessibility campaign was run for these drafts. The served runtime remains `4f37e9f0`; its evidence does not validate the new source. The camp-stock follow-up `289a01e2` remains source/Editor verified and is also absent from that served build. Remaining checks include the .NET network C# suite, source-copy checks, staged and live gameplay-scale/CVD inspection, and the next coordinator-approved client/public-flow Web batch. Check signature-row crowding and the new prop silhouettes in that batch; their readability and cost are not established by Editor tests.

The proposal below is retained as scope context. Rust and public-flow integration retain priority. Creative reuse of the existing art family is permitted; bespoke assets for every archetype are not a prerequisite.

## Concrete omissions in served runtime `4f37e9f0`

- `ArenaView.PresentCollections` renders Ground, WindEmblem and Cannon through the same generic rune, although the public view supplies distinct kinds and Ground weapon IDs. The repair census witnesses kinds 1/2/3/5/6 and Ground weapons 0–4. Chest `Open` is also delivered but not presented.
- `SpriteActorPresenter.Present` renders every nonzero signature through one generic rune colored by the victim's faction. The repair census witnesses signature values 2 and 4. Rust `constants.rs` defines these as burning and disease; the presentation inventory requires distinct persistent cues.

These are missing distinctions in delivered gameplay facts, not reasons to acquire more skins. Evidence is scoped by socket/Welcome in `evidence/repair/summary.json`; presence is not exhaustive coverage or proof that a prop was on screen.

## Proposed presentation changes

- Use the existing weapon glyphs for Ground `Weapon` values 0–4. A missing or unsupported value keeps a neutral cue rather than borrowing a weapon identity.
- Give WindEmblem and Cannon distinguishable silhouettes using the current catalog or existing shape vocabulary. Keep positions, focus rings, sorting, ground contact and observer-owned pooling intact.
- Present the delivered Chest `Open` boolean without inferring contents, ownership or eligibility. A neutral reused death pose may distinguish Body/Corpse if the coordinator includes that improvement; it must not imply an actor identity or faction.
- Give known delivered signature bits separate persistent, unlit geometry: chilled 1, burning 2, diseased 4, execute 8 and execute-blocked 64. Preserve an unknown-bit fallback. Follow the latest delivered mask; do not infer a source, amount, duration or application moment, and do not replay one-shot bursts from persistent bits.
- Keep essential signature cues at all quality tiers and in reduced motion. Hide them with their actor root on removal, timeline reset or pooling, and preserve current dead/MIA handling. Keep faction marks, weapons and HP unobscured.

`ReadyAt` is a server-time deadline. This proposal does not add a readiness countdown or use local time to infer cannon eligibility. That would require a separately approved clock basis. No protocol, gameplay, prediction, active-light budget, pipeline quality, acquisition or deployment change is proposed.

## Candidate write scope

`ArenaView.cs`, `SpriteActorPresenter.cs`, a small presentation-only cue helper if useful, focused Editor regressions, and revision-specific art evidence. Reuse the current imported/generated sprites; any new asset or authoring scope needs explicit coordinator inclusion.

## Verification to include in the assigned packet

1. Actual presenter tests for Ground weapon identities, distinct prop kinds, chest-open transitions and clearing/removal. Preserve focused interaction and reset pooled transforms/materials.
2. Actual actor tests for masks 2, 4, 2|4, zero and unknown bits, plus the other known bits as fixtures; ensure no stale or hidden cue survives eviction. Check lower tiers and reduced motion.
3. Inspect staged fixtures and actual delivered cues at gameplay scale, including grayscale/CVD views and the 1.50 text setting where labels change. Fixtures remain explicitly separate from live evidence.
4. Include this work and camp stock in the next coordinator-approved client/public-flow Web batch. Run the required flow proof and any performance checks the coordinator assigns for the final world-rendering change; do not repeat an unchanged campaign by default.
5. Pin source/build identities, portable evidence and raw hashes. Native 144 Hz, allocation throughput, total-memory limitations and remaining full-plan requirements stay open until separately demonstrated.

Earlier unrun source-only handoff notes in this proposal are historical; the bounded compile and Editor result above supersedes them. Runtime validation and further measurement campaigns remain deferred.
