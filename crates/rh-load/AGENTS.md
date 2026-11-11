# rh-load: local rules

Load and soak harness for `rh-server`: scripted WebSocket sessions through the `rh-protocol` library. Usage:
[README.md](README.md) (its protocol-version mention is stale; the library carries the current one).

- Target only a local server or a host the packet names with the owner's approval.
- Its unit and smoke tests run in the workspace suite; real load runs are manual and labelled with what they measure.
