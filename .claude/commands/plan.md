---
description: Turn requirements or a milestone into routed, oracle-first packets in docs/backlog/packets (Opus)
argument-hint: <requirements text, or a path to a requirements file>
model: opus
effort: high
---
You are planning, not implementing. Requirements:

$ARGUMENTS

1. If that is a path, read it. Read the MIGRATION checkpoint (top section), ORDER_OF_OPERATIONS and the backlog README's
   packet rules. Send every "where is X" question to `scout`.
2. Map each requirement to an ORDER_OF_OPERATIONS phase/item and the contracts it touches. List anything ambiguous, in
   conflict with an Accepted ADR or contract, outside the plan, or inside the design freeze (D5), and ask the owner about
   those before planning around them.
3. Split the work into packets that each cover one area, change about 300 lines and are proven by one failing oracle.
   Order them by dependency; mark which can run in parallel (disjoint write scopes, the backlog's shared-file rule).
4. For each packet write `docs/backlog/packets/<ID>.md` from `docs/agent/PACKET_TEMPLATE.md`, choosing tier and reviewer
   from the routing table in `CLAUDE.md`, and set its backlog row to "Ready packet".
5. Add a short plan section to the packet set's first packet: id, title, area, tier, reviewer, depends on, parallel group.
6. Run `oracle-author` for the first parallel group (at most three at once).
7. Stop and show the owner the plan and the oracle results. `/run` executes it.
