# Frost slow-resistance fixtures (P-FROST-RESISTANCE-1)

Pinned linux/amd64 Node22.23.4 actual-source witnesses for the native player Frost correction: source
packages/server/src/sim/factions.ts updateChill applies resistSlow(m, slowResistOf(victim)) to the attack chill and to
the near/ranged movement result before movement quantization. The old native after_damage applied neither, although Iron
Will was already offerable and its folded slowResist + status_runtime::resist_slow existed.

The capture uses the unmodified legacy sim through the existing producers only:
- real grantCard (packages/server/src/sim/chests.ts, real stat folding) for Iron Will;
- real client messages (attack/release/target) validated and submitted by the ordinary 50 ms step;
- real removePlayer for the departed-source case;
- trusted declared starting positions/map/seed/config and starting cards; no expected chill/cooldown/movement value is
enqueued or written into the world.

parity/frost-resistance/source.json (format rh-frost-resistance-source/1) records, per case, the full input tape and the
actual source frost state per tick (chill, chillers, exposure/lastNear, rangedUntil, decoded move, slowResist, readyAt,
bufferedUntil, drawStartedAt, draw action). Cases: attack baseline / Iron Will victim / Iron Will source; near; ranged;
near thaw + departed source + episode reset; buffered-melee clocks; bow-draw clocks; mid-run real grantCard resistance
change; plus no-card baseline counterparts for the thaw and clock cases. The source witnesses include the documented
examples (attack 0.68 -> 0.808, initial near movement 0.70 -> 0.82, ranged 0.85 -> 0.91 for resistance 0.4) as evidence,
not as inputs.

Run (pinned image already used by the other capture tools):

    bash tools/frost-resistance-fixtures/capture.sh            # write parity/frost-resistance/source.json
    bash tools/frost-resistance-fixtures/capture.sh --check    # byte-identical check

The tool refuses any runtime other than v22.23.4 linux x64, records immutable source/tool/package-lock/image hashes, and
runs every case twice to assert a deterministic source replay. Consumers live only in the allowed crates/rh-sim/src/systems/frost.rs test module: the two
source_witnesses_* tests check provenance and the witness relations through resistSlow + quantization (thaw/departure/
reset, clock witnesses, resistance change); the runtime/restore/replay and trusted-fold tests are the other new tests
there.
