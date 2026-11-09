# `parity/overkill-producer` — actual-source Overkill producer corpus

`source.json` — `rh-overkill-producer-source/1`, 5 cases, 96,844 bytes, SHA256
`916a1cc143b09addeab92ecd0b84fa4e87e78d3b4ddfd51a42ee2938f90c4577`. Captured from unmodified source by
`tools/overkill-producer-fixtures/capture.mts` in the pinned linux/amd64 Node 22.23.4 image.

Declared profile: real `createGameWorld` generated map seed1, four seats (Holy a0, Holy a1, Fire victim, Plague seat3),
`mobs:false, signatures:true, quests:false`, ordinary queued attacks/50 ms steps. Cases: lethal no barrier; genuinely
earned Second Skin barrier absorbing with no HP damage; barrier plus lethal HP damage; two real contributions in one
pass; and an actual Embers-tile arena contribution alongside an ordinary attack. Frames carry pre/post hp/barrier, tick/
time, read-only per-frame hook order/args, `hitLanded`/ledger rows, the complete `staggered` rows, and the full `overkilled` argument rows. No native world/hash
equality is claimed.
