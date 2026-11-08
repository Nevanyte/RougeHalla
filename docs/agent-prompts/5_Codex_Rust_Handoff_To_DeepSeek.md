# Owner instruction to Codex: Rust gameplay ownership moves to DeepSeek (2026-11-06)

From now on, **DeepSeek owns the Rust gameplay port for its completion run**:
- every remaining `rh-sim` mechanic and its parity;
- headless/policy completeness;
- scripted bots (P-BOTS-*);
- the Rust, protocol and decoder-mirror exposure of what it ports.

It works on `deepseek/rust-completion` and opens one PR per packet to `optimization_port`. It never merges and never
edits the shared status records.

You stay the **coordinator, independent reviewer and integrator**.

## Do now

1. **Do not start any new Rust gameplay packet.** Finish and merge the work already in flight, most likely player
   faction/axe reset (the `signatures/lifecycle.rs` reset, the Teleported link, arena validation, the
   `player-faction-reset` and `player-axe-reset` fixtures), with its normal evidence and CI. If it cannot be finished
   soon, commit it to a parked branch and say so, instead of leaving it half-integrated on `optimization_port`.
2. **Add a short, dated reservation note** to `docs/backlog/README.md`, next to the other external-handoff paragraphs.
   It should say:
   - DeepSeek holds the remaining Rust gameplay backlog;
   - the exact packet ids you are still finishing, if any;
   - Fire roam (P-FACTION-2) is reserved for Kimi if you register P-KIMI-ROAM-1. The draft prompt is
     `3_Kimi_Fire_Roam_Prompt.md` in the owner's main checkout.

   Update the MIGRATION checkpoint to match.
3. **Review DeepSeek's PRs one packet at a time**, as you reviewed the Claude and Kimi handoffs. For each one:
   - re-run the packet's focused tests, parity, restore/no-alloc/hash-coverage and the workspace gate on the integrated
     tree;
   - check that existing fixtures and expectations are unchanged except protocol vectors after a declared version bump;
   - check that `packages/**` is untouched;
   - apply its proposed `Cargo.lock` hunks yourself.

   Reject anything whose evidence does not hold. Also reject anything that hard-codes one ability, card or status in
   system code instead of expressing it as a definition row run by the shared verb interpreter. The owner requires that
   new content be data, not code: see section 6A of the DeepSeek prompt. DeepSeek's first packet, P-CONTENT-1, converts
   the five Wishes to rows and must leave every ability parity output byte-identical.
4. **Keep doing everything that is not Rust gameplay:** Unity, hosting and cloud, persistence and placement integration,
   CI, shared status, the protocol governance review. You also merge DeepSeek's protocol bumps one at a time.

Nothing else changes: the CAD20 cloud cap, the no-ML rule and the existing contracts still apply.
