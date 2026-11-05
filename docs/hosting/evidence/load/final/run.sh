#!/bin/sh
cd "$(dirname "$0")/../../.."
ulimit -n 65536
B="./target/release/rh-load run --server-bin target/release/rh-server --out-dir target/load/final --hardware-label 'Apple M5 Pro 18-core 64 GB'"
eval $B --matches 2 --duration 15 --label smoke-ws
eval $B --matches 3 --duration 60 --aggression 0.4 --reconnect-fraction 0.3 --reconnect-every 8 --churn-clients 4 --slow-fraction 0.1 --slow-stall-secs 20 --tls --insecure --label features-wss
eval $B --matches 6 --duration 30 --aggression 0.9 --shutdown-at 15 --shutdown-mode sigterm --drain-wait 240 --label shutdown-sigterm
eval $B --matches 4 --duration 30 --aggression 0.9 --shutdown-at 15 --shutdown-mode drain --drain-wait 240 --label shutdown-drain
eval $B --matches 6 --duration 20 --max-rooms 4 --label overload-maxrooms4
echo ALLDONE > target/load/final/done.txt
