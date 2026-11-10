# Calgary public game-socket measurement

One ordinary three-player Source match on **https://play.rougehalla.com**, frozen public P14/content7c6a633f68c2cc72,48×40 map, completed one30.000175-second stationary window. The unchanged protocol helper made its normal1Hz Ping/Pong; there were no additional pings, attacks, rewards farming, privileged inputs, browser or Unity operations.

| Application RTT (90 matched samples) | Result |
|---|---:|
| Minimum | 7.87ms |
| Median | 10.72ms |
| p95 | 21.54ms |
| Maximum | 24.60ms |

Each socket contributed30 Ping/Pong matches. Nonce and the exact echoed client timestamp both match; only send AND receive events within the window count. RTT uses the same local monotonic clock at both ends of the client observation. It includes WSS transport, server queues and endpoint event dispatch; it is not one-way latency, clock offset or input-to-visible delay. Quantiles use floor((n−1)p), with sparse correlated samples over a single scene.

| Client | Received application payload | Sent application payload |
|---|---:|---:|
| 1 | 3891.5B/s | 13.0B/s |
| 2 | 3681.6B/s | 13.0B/s |
| 3 | 5988.2B/s | 13.0B/s |
| Total | 13561.4B/s | 39.0B/s |

Received rates include all application messages in the actual window, including Ping/Pong, and vary with legitimate observer contents. Sent traffic in this stationary window is heartbeat-only; it is not active combat/input bandwidth. Counts exclude admission, Hello/Welcome/map, setup and Leave, as well as TCP/TLS/WebSocket framing, retransmissions and WebSocket control messages. No raw frame bodies or tokens were retained. This is the Node protocol client's link measurement, not Unity/browser performance or a full-map/combat/legacy bandwidth comparison.

All three owners remained Active/alive, each advanced600 observed ticks/30000 serverMs, all owned sockets closed normally, and Root confirmed NodePID43969 absent after actual tool exit0. The immediate finalInfo caught asynchronous retirement (players1/results5); Root's independent settled HTTPSread confirms rooms0/players0/resultsOk6/resultsFailed0/resultsRefused0, up3 successful results from the initial count3. No server/services were restarted or cloud resources added. Original expiry03:50:21UTC remains unchanged.

The controller reuses unchanged pinned helper/probe/vector bytes from the isolated optimization_port checkout. A fixed virtual-origin dependency adapter routes only each owned profile GET, /info and /ws to the exact approved HTTPS/WSS domain; it creates no localhost listener/proxy, permits no arbitrary destinations, and refuses redirects. Native TLS verification remains enabled. Existing v14goldens are decoded before the first network operation; the reviewed script additionally requires exact13B Ping/21B Pong frames. See raw report, reviewed script, cleanup/settled receipts and manifest. The original unreviewed preparation script remains UNRUN outsideGit; no favorable retake followed.

The focused independent review confirms all reported arithmetic, nonce uniqueness, frame/tag totals and owner-clock deltas. Window membership follows the reviewed live meter guards; the raw report does not retain its monotonic windowStart scalar, so a second offline boundary reconstruction/payload recount is not claimed. Message bodies were deliberately not retained. Original measurements were not repeated.
