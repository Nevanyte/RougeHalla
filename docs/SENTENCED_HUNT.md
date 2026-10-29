# Sentenced hunt

During an active, non-training run, a living Sentenced player can select one other living player from the hunt HUD. The server validates each selection. A living target cannot be replaced; the hunter can choose again after that target dies or leaves. A real target death grants one hunt stack to each living Sentenced hunter tracking them, regardless of who dealt the killing blow. A disconnect or other MIA removal clears the target but grants no stack. A hunter's own death clears their selection.

The selected rival is continuously visible to that hunter as an actor and on the map, even beyond normal fog. This is an actor-specific exception: it does not reveal terrain or other actors near the rival. Existing hidden and untargetable rules still prevent attacks on a concealed target.

When the hunter has an active target and their next route leg points clearly toward it (direction dot product above 0.3), movement speed is multiplied by 1.05. Standing still, moving away, and moving across the target's direction do not receive the bonus. The comparison uses the next path waypoint on both server and client prediction.

Each completed hunt permanently multiplies the Sentenced mark strength by `1 + 0.02 × huntStacks`; the reward has no gameplay stack cap. Fresh players retain the existing mark baseline. Shared constants and helpers live in `packages/shared/src/sentencedHunt.ts`; server selection, movement, and death handling live in `packages/server/src/sim/sentencedHunt.ts`.
