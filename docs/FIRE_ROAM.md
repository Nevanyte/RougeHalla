# Fire roaming charge

Fire builds roaming charge while alive in an active run and out of combat. The meter fills linearly for 20 seconds; its movement bonus rises from 1× to 1.5× with that meter. Positive damage dealt or taken resets the movement meter and its speed bonus immediately. A missed or blocked attack does not count as damage.

Reaching full charge arms one magic burst for Fire's next landed direct weapon auto. The armed burst stays ready through combat and movement-charge resets, and is consumed only by a landed direct hit. It cannot trigger from a block, miss, damage-over-time tick, signature, passive, or derived splash. Multi-target attacks can consume the arm only once.

The burst deals `50 + 0.4 × AP` raw magic damage. It is a derived hit, so it does not repeat on-hit effects; normal victim mitigation, PvP scaling, and applicable outgoing damage rows still apply. The server queues the burst for the next ledger tick so one swing hitting multiple targets cannot duplicate it.

`PlayerState.roamCharge` is the synchronized movement meter in 0..1000. `PlayerState.roamReady` is the independent armed-burst flag; it remains true after charge resets until a qualifying auto lands.
