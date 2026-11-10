# Claude handoff: finish the competitive netcode checkpoint

Finish the existing `claude/peaceful-babbage-rtsgq6` task before adding another wave.
Reviewed checkpoint: `1f7c5460c22af9907f1cfec4aeffaaa6abf0c489`, based on
`aef6da2c532874c52125545c4ee2a0fc42d1097d`. This is a WIP review, not merge admission.
Root owns integration into `optimization_port`. The live protocol14 demo at
**play.rougehalla.com** must remain available; **play.roguehalla.com** is production.
Do not deploy, merge main, access credentials or modify either hosted service.

The owner explicitly approves intentional speed-related departures from earlier
parity/prediction constraints. Resolve actual correctness, interoperability and
privacy problems; an old-rule disagreement alone is not a reason to revert work.
Preserve Root's stale-echo repair and current Resume/session/retirement guards.
Use an isolated branch/worktree and preserve all existing worker changes.

## One deliverable

Return a complete, reviewable version of the existing checkpoint, including its
cross-language protocol15 consumers. Do not start unrelated gameplay/content work
or create another benchmarking framework. Reuse the existing codec, vector and
latency tools. Keep runtime code and evidence clearly distinguishable.

Reproduce and resolve these bounded source-review findings:

1. `OwnAttackCue.Update` adopts a cooldown jump before checking death, stun,
   weapon changes and timeout. Test each blocker combined with a ready-time jump;
   reject a different/invalid action while retaining genuine late server effects.
2. `Session` resets its clock on a source cut without clearing `RemoteDraw`'s
   timestamp-keyed walk cache. Cover equal-time/backwards epoch cuts followed by
   reused numeric timestamps and a changed direction.
3. Draw-ahead and `AttackTime` do not currently describe the same pose: newest=1000 /
   render=980 can draw1030 but send1000, with additional per-actor follower lag.
   Define and test the bounded aiming policy. Do not claim exact pose/time equality
   if the chosen design deliberately differs.
4. Fresh projectile track allocation omits the identity of its presented owner
   from tied public rows. Reverse private storage/launch order for identical
   geometry from different visible human/NPC owners and require identical exposed
   track bindings and lifecycle. Use presented public identity, not private IDs.
5. Catch-up projectiles skip ball/arrow deletion before recording hits. Exercise a
   crossing ball, arrow and victim at baseline and100/200/300ms added lag. Preserve
   the intended counterplay or return a concrete, measured policy decision for
   Root; do not assume the next sweep can undo damage already recorded.

These are static review findings until their focused controls execute. Also cover
real Wish landing/cancellation and press/burst/release admission at the seat boundary;
CastStarted or client reservation alone does not prove the eventual outcome.

## Success and failure lines

**Success:** Rust, both C# copies and embedded JS agree on15, including actor/delta
windup/position/facing changes, State7 projectile tracks and MoveAt/AttackMoveAt.
Regenerate actual Rust vectors; C#/JS must execute v15 vectors, malformed cases and
stateful chains rather than selecting old14 fixtures. Supply stable Unity metadata
for new scripts, focused regression results, a clear activation choice for
`lag_fairness`, and exact code/evidence SHAs with remaining limits. Root separately
owns actual Unity compilation, final build/identity composition and deployment.

**Failure/stop:** a missing consumer, reproducible unresolved defect, fixture
disagreement, unleased shared-file conflict or unavailable prerequisite. Return the
exact blocker and retain the failing result. Do not call the whole checkpoint ready
because its Rust half passes, silently weaken expected results, replace Root's
current files wholesale, or label synthetic timings as real performance gains.

The protocol14-only client slice is mechanically separable, but is an optional
Root integration choice after its lifecycle/aiming issues are resolved. It is not
a substitute for completing the protocol15 checkpoint you started.
