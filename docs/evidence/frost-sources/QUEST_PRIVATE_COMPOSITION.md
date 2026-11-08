# Private Frost and quest composition

Root stages reviewed Frost sources `2fa23d95` and quest bridge `1e4dd5fd` onto main base `86f03cbd` in
`codex/next-native-integration`. Merge `2977f83e` retains private checkpoint26/replay20, Observation20/policy14 and all
production quest wire omission guards. Public/main identity remains13/25/19/19/13; this is not its replacement gate.
The only textual merge conflict was the training observation assertion19 versus the private successor20.

Focused integration exposed an existing declared quest `regionWipe` fixture producer-batch boundary: it calls real
`mob_life::hurt` outside a collecting ledger pass. Its payouts run inline, but derived mob-death bookkeeping remains.
The future strict payout-settlement assertion correctly rejected the next step at tick83. Production mechanics and the
captured source bytes are unchanged. The fixture now closes that declared batch through the actual `ledger::pay_all`
drainer. It asserts no queued/collecting payout existed, no second event is emitted, the queue is settled, and the
simulation hash is identical before/after. This closes transient bookkeeping rather than installing a gameplay result.
The temporary detailed diagnostic was removed; the strict production assertion is retained.

After repair, the focused quest filter passes37 tests, training filter24 and the Frost-source headless digest3. These
are overlapping revision-scoped filters, not a new full-workspace count. Exact logs remain under the root's external
`return-cleanup-2026-11-08/next-native-integration/` directory. Full Sentenced/group source parity, final identity/tapes,
strict Wish admission, public quest/trade codecs and Unity/browser acceptance remain separate work.
