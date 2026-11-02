# Plague corpse harvest

A real player death during an active raid leaves one separate green corpse marker at the death position. MIA/disconnects and training revivals leave none. The corpse lasts 90 seconds and does not replace or alter the ordinary weapon-loot body.

Only living Plague players see corpse coordinates on the held Tab map and minimap. Corpse visibility is public and ignores terrain fog; it reveals only the corpse position, not the dead player's teammates or other hidden actors.

A Plague player can consume a corpse within 70 world units with F or by right-clicking it in the world. Right-clicking from farther away walks toward it; the server still checks the range when consumption is requested. The server removes the corpse before paying the reward, so simultaneous attempts have one winner. A successful harvest permanently adds 3% of Plague's base health to max health, heals once for 3% of base health through the normal heal rules, and adds one corpse stack. Each stack increases Plague's disease damage by 2%; it does not change execute damage. The zombie has 55% of Plague's current max health, hits for 2% of it once a second (both multiplied by `1 + 0.10 × (bodies − 1)`), and regenerates 1.5% of its max health per second in 0.5 s steps, at a quarter of that rate for 4 s after being hit. The numbers are in `plagueCorpses.ts`.

Corpses expire on the server and disappear from both maps.
