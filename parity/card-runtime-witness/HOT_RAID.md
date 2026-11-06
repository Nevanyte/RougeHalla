# Raid-start caller audit

Read-only audit of original source at64052f09212ea857b2aa6327cf996b1860deb91b. No hot lobby or expected card state was constructed.

Production startRaid callers are:

- sim/step.ts135 defines startRaid; updateLobby at175 invokes it only while stepping the lobby when planning is disabled.
- sim/planning.ts102–112 receives the startRaid callback from step and invokes it when the one planning phase finishes. The next tick is Active.
- rooms/RaidRoom.ts453 calls it for the first training join. Training rooms are private with maxClients1 (283–285).

RaidRoom.onAuth at426 rejects a fresh join once its built world leaves Lobby, including training; reconnection uses onReconnect at482
and does not call startRaid. Source sim has no Active/Ended→Lobby transition or restart action. Therefore one ordinary world has one cold raid start.
The exported startRaid function itself is callable by tests/diagnostics, but that does not make repeated starts an ordinary input admission.

Training is separate: sim/training.ts114–122 validates training-only train actions. trainClear at335–346 clears build, fired/HoT/card memory,
boosts/camps/barrier and practice content through its own producer; it never calls startRaid. trainingSettle at50–70 revives the player and
resets weapons/history/slide without restarting the raid. These are real future training-card prerequisites, not evidence of a hot arena reset.

Source cardHooks.resetAll at75 clears all players' rt.cards and deletes pending/bleeds when the actual raidStarted hook fires. The65-case corpus
captures the normal fresh constructor/raid boundary. Nonempty resetAll could be a specifically labeled actual-hook diagnostic later if necessary;
it is not claimed ordinarily reachable here. No additional hot-reset capture or training campaign was added.

The companion source input SHA inventory adds RaidRoom.ts to the frozen132 original module/package pins, so these caller findings are attributable.
