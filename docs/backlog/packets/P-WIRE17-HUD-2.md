# P-WIRE17-HUD-2: protocol 17 carries the champion panel values and weapon scaling terms

- **Serves:** not in the plan: owner approval 2026-11-10 (MIGRATION checkpoint, decision 3: the Unity HUD presents what
  the legacy HUD presents; bottom-left damage panel)
- **Implementer tier:** implementer-opus (wire format, observation, cross-crate)
- **Reviewer:** reviewer-opus
- **Integration base:** feature/unity-rework
- **D-rules touched:** D1 loose proof (owner direction 2026-11-10: read the legacy code, one sanity test for numbers);
  golden vectors required for a wire change · D2 n/a · D5/D6/D9 none
- **Status:** brief only; needs `oracle-author` before an implementer (no oracle yet).

## 1. ID and outcome
Split from P-WIRE17-HUD-1 (size). Still protocol 17, `v17.json` regenerated:
- The owner build summary (State key 13, added by HUD-1) gains the champion panel values from
  `packages/client/src/ui/championCombatModel.ts:91-216`: held-weapon per-hit damage split (physical, magic, true) and
  attacks per second; the faction passive's numbers (Frost chill, execute share, mark pulse, Holy lifesteal fraction as
  the model shows them); the Fire roam charge.
- The Welcome weapon table (`crates/rh-protocol/src/weapon.rs`) carries each weapon's scaling terms from
  `DEFINITION.weapon_scaling` (`crates/rh-sim/src/modifiers/rules.rs`).

## 2. Dependencies
- P-WIRE17-HUD-1 merged (key 13 and its quantization, `HUD_QUANTUM` = 1e-4, exist; same decoders: strictly serial).

## 3. Relevant legacy paths
- `packages/client/src/ui/championCombatModel.ts:91-216` (rows and formulas); weapon scaling as the panel and tooltips
  use it.

## 5. Exclusive write scope
- `crates/rh-sim/src/build_summary.rs` (panel values beside the GAINED values), `crates/rh-sim/src/observe.rs`
  (`SummaryView` fields; `OBSERVATION_VERSION` 25 -> 26)
- `crates/rh-protocol/src/state.rs` (key 13 payload appended: append-only after the mob rows), `weapon.rs`, `samples.rs`
- `crates/rh-policy/src/delivery/` (projection; `POLICY_CONTRACT_VERSION` 19 -> 20)
- `client-unity/RoguehallaNet/Protocol/`, `Net/Collections.cs`, `Views.cs`, the synced copy; `crates/rh-server/web/probe.html`,
  `tools/protocol-js/`; `protocol/fixtures/v17.json`

## 6. Contracts and references
- Ingredients: `modifiers::packet` and `hit_mult` (`crates/rh-sim/src/modifiers/mod.rs`), `content::attack_interval`,
  `frost_chill`, `execute_share`, `mark_pulse`, `holy_lifesteal_fraction`, `fire_roam::charge`
  (`crates/rh-sim/src/systems/fire_roam.rs`).
- C-OBS: panel values are owner-only (inside key 13). Weapon scaling is public content (Welcome).
- R-AUTH: Unity shows these numbers; it never computes them.

## 8. Acceptance checks (for the oracle author to make executable)
- Round trip of key 13 with the panel block and of a Welcome weapon row with scaling terms; refusal of out-of-range codes.
- One sanity test: a known Holy and a known Fire build's panel values within one quantum of the legacy formulas worked by
  hand from `championCombatModel.ts`.
- Values that change every tick (hp-dependent leech, roam charge) are quantized so deltas stay small.

## 10. Risk and suggested model tier
Opus: observation, wire and three decoders; panel formulas cross several modifier folds.
