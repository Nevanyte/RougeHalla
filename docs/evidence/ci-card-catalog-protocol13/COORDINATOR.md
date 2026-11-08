# Coordinator follow-up to protocol13 CI

[Run42517747299](https://github.com/Nevanyte/RougeHalla/actions/runs/42517747299) at70579162 failed two checks.
This is a failed integration run, not a green full-workspace claim. Card-runtime-source and C# jobs passed; latency
checks passed separately in42517747437. The remaining backend job passed its earlier workspace/PG/parity/source
steps but stopped at the card-catalog bytecheck. Simulation stopped after668passed/one existing ignore on the stale
training version assertion; later integration targets were not reached. Do not sum these overlapping counts.

The training test correctly compared its observation to the exported version, then incorrectly pinned the old18.
The owner-only Trophy observer explicitly moved to19. The coordinator updates that literal to19, retaining the strict
version guard and both training/arena flag assertions. All13 focused training tests pass with trusted-status-probes;
other targets were filtered, not newly executed. No production behavior or identity changes.

The independent catalog repair refreshes exactly one protected metadata pin for the protocol13 JS checker. All409
case inputs/outcomes/inventory,78 source pins and5 harness pins are unchanged. Its actual pinned recapture, exact
recursive old/new comparison and expected-value negative control are in README.md/receipt.json. No gameplay expected
value is rewritten, ignored or bypassed. Subsequent CI validates the repaired commit.

Raw failed CI output is preserved locally as return-cleanup-2026-11-08/ci-42517747299-failures.log; the focused training
receipt is ci-training-obs19-root.log in that same archive. These fixes leave the accepted frozen runtime/Web source
and its successful real browser proof intact. A new full-game, cloud or performance acceptance is not implied.
