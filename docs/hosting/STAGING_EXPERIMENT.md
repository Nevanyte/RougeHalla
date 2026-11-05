# GameLift container fleet staging experiment

> **Corrected 2026-11-05 (P-CLAUDE-INFRA-1).** The `/internal/*` names and the `matchd` stub of the first draft are replaced by the
> contract in [CONTROL_API.md](CONTROL_API.md) (`/control/*`) and by the real `rh-server` + `glbridge` image built from
> `hosting/Dockerfile` (`hosting/README.md`). One server process hosts one game session (GAMELIFT_VERIFIED.md section 3), so
> the density step varies container groups per instance, each with `--max-rooms 1`. Facts: [GAMELIFT_VERIFIED.md](GAMELIFT_VERIFIED.md).
> The Rust side of the control API is not implemented yet; do not start this experiment until it is and a local run of the image
> against the real server passes. Still NOT RUN; no command here is authorised.

STATUS: **NOT RUN.** Written 2026-11-04 with no AWS access. Every command below is unexecuted. Command and parameter names were checked against the AWS CLI/API reference pages cited in `GAMELIFT_EVALUATION.md`; items marked `[verify: aws gamelift <cmd> help]` were not confirmed from a doc page and must be checked against `aws gamelift help` before use.
Nothing here authorizes spending. Run only in a dedicated sandbox account after the owner approves the budget in section 1.

Goal: prove, on a throwaway fleet, that a Rust match process behind a Go SDK bridge can be allocated, admitted, reconnected, completed, replaced and drained on GameLift managed containers, reachable from a browser over valid `wss://`.

## 0. Test artifacts to prepare (before any AWS call)
- `rh-server` with the loopback control API of CONTROL_API.md (`/control/session`, `/admit`, `/rooms`, `/leave`, `/end`, `/drain`, `/health`) and `--max-rooms 1 --require-admit`; serves WSS on the container port with its own certificate. The match ends by the normal game rules (or `POST /control/end` from the bridge), there is no echo stub.
- `glbridge`: Go supervisor (`hosting/glbridge/`) using the official Go server SDK `github.com/amazon-gamelift/amazon-gamelift-servers-go-server-sdk/v5` at `v5.6.0` (pinned in go.mod; pure Go, no cgo). Build the image for `linux/arm64` and `linux/amd64` (two images, tags `-arm64`, `-amd64`) from `hosting/Dockerfile`.
- Entrypoint `glbridge`, stdout logging. Image architecture must match the instance type or the deployment fails.
- A throwaway domain `play-test.<your-domain>` in Route 53, a wildcard cert for `*.usw2.play-test.<your-domain>` (ACME DNS-01) stored in Secrets Manager.
- A static page + HTTPS ping endpoint per Region (Lambda Function URL returning 204 with CORS) for step 11.

## 1. Prerequisites
### 1.1 Account and budget guard
```bash
export AWS_PROFILE=gl-staging         # sandbox account only
export HOME_REGION=us-west-2
export REMOTE_REGION=ca-central-1
aws sts get-caller-identity           # confirm the account id is the sandbox
aws budgets create-budget --account-id "$ACCT" --budget '{
  "BudgetName":"gl-staging","BudgetLimit":{"Amount":"150","Unit":"USD"},
  "TimeUnit":"MONTHLY","BudgetType":"COST"}' \
  --notifications-with-subscribers '[{"Notification":{"NotificationType":"ACTUAL","ComparisonOperator":"GREATER_THAN","Threshold":50,"ThresholdType":"PERCENTAGE"},"Subscribers":[{"SubscriptionType":"EMAIL","Address":"you@example.com"}]}]'
```
Hard limits for the run: fleet `--max-size` 3 per location in `update-fleet-capacity`; one Region pair; tear down within 24 h (section 14). Expected cost of the whole experiment is a few dollars to tens of dollars (a handful of `.large` instance-hours at about $0.09-0.12 each, see evaluation 5); the $150 budget is a ceiling, not an estimate.

### 1.2 Region opt-in and quotas
```bash
aws ec2 describe-regions --all-regions --query "Regions[?RegionName=='ca-central-1']"
aws service-quotas list-service-quotas --service-code gamelift --region $HOME_REGION
aws service-quotas list-service-quotas --service-code ec2 --region $HOME_REGION \
  --query "Quotas[?contains(QuotaName,'Standard (A, C, D, H, I, M, R, T, Z)')]"
aws gamelift list-locations --region $HOME_REGION          # expect ca-central-1 present, ca-west-1 absent
```
Need: room for 6+ vCPU of Standard On-Demand in both Regions; note the GameLift container-fleet/CGD quotas (not in the public table) and request increases if default is below 2 fleets and 5 CGDs. `ec2:DescribeRegions` is required by the admin policy for non-default Regions.

### 1.3 IAM permissions for the operator (sandbox admin policy sketch)
- `gamelift:*` on the sandbox (or at least: CreateContainerGroupDefinition, UpdateContainerGroupDefinition, DescribeContainerGroupDefinition, ListContainerGroupDefinitions, Delete*, CreateContainerFleet, UpdateContainerFleet, DescribeContainerFleet, ListContainerFleets, DeleteContainerFleet, CreateGameSessionQueue, DeleteGameSessionQueue, StartGameSessionPlacement, DescribeGameSessionPlacement, StopGameSessionPlacement, CreatePlayerSession, DescribePlayerSessions, DescribeGameSessions, TerminateGameSession, UpdateGameSession, UpdateFleetCapacity, DescribeFleetCapacity, DescribeFleetLocationCapacity, PutScalingPolicy, DescribeScalingPolicies, DescribeCompute, ListCompute, GetComputeAccess, DescribeFleetEvents, DescribeFleetDeployment, ListLocations, DescribeContainerGroupPortMappings, TagResource)
- `ecr:CreateRepository`, `ecr:GetAuthorizationToken`, `ecr:BatchCheckLayerAvailability`, `ecr:InitiateLayerUpload`, `ecr:UploadLayerPart`, `ecr:CompleteLayerUpload`, `ecr:PutImage`, `ecr:DeleteRepository`
- `iam:CreateRole`, `iam:AttachRolePolicy`, `iam:PassRole` (for the fleet role), `iam:DeleteRole`, `iam:DetachRolePolicy`
- `logs:CreateLogGroup`, `logs:DescribeLogStreams`, `logs:GetLogEvents`, `logs:DeleteLogGroup`
- `sns:CreateTopic`, `sns:Subscribe`, `sns:DeleteTopic`
- `route53:ChangeResourceRecordSets`, `route53:ListResourceRecordSets` (zone scoped)
- `secretsmanager:CreateSecret`, `secretsmanager:GetSecretValue`, `secretsmanager:DeleteSecret`
- `cloudwatch:GetMetricData`, `budgets:*` (sandbox only), `service-quotas:*` read, `ec2:DescribeRegions`
### 1.4 Fleet service role
The fleet role needs the managed policy `GameLiftContainerFleetPolicy` ([API CreateContainerFleet](https://docs.aws.amazon.com/gameliftservers/latest/apireference/API_CreateContainerFleet.html)); the trust policy principals are in [setting-up-role](https://docs.aws.amazon.com/gamelift/latest/developerguide/setting-up-role.html) `[verify against that page; do not guess]`. Add a read grant on the cert secret if glbridge fetches it via `GetFleetRoleCredentials`.
```bash
aws iam create-role --role-name gl-staging-fleet --assume-role-policy-document file://trust.json
aws iam attach-role-policy --role-name gl-staging-fleet \
  --policy-arn arn:aws:iam::aws:policy/GameLiftContainerFleetPolicy   # [verify exact ARN in console]
export FLEET_ROLE_ARN=$(aws iam get-role --role-name gl-staging-fleet --query Role.Arn --output text)
```

## 2. Image push (per Region that hosts a fleet)
CGDs and ECR images are Region resources; create the CGD in the fleet's home Region ([regions doc](https://docs.aws.amazon.com/gameliftservers/latest/developerguide/gamelift-regions.html)).
```bash
aws ecr create-repository --repository-name rh-match --region $HOME_REGION
aws ecr get-login-password --region $HOME_REGION | docker login --username AWS --password-stdin $ACCT.dkr.ecr.$HOME_REGION.amazonaws.com
docker buildx build --platform linux/arm64 -f hosting/Dockerfile --build-arg RH_BUILD=$(git rev-parse --short=12 HEAD) -t $ACCT.dkr.ecr.$HOME_REGION.amazonaws.com/rh-match:s1-arm64 --push .
docker buildx build --platform linux/amd64 -f hosting/Dockerfile --build-arg RH_BUILD=$(git rev-parse --short=12 HEAD) -t $ACCT.dkr.ecr.$HOME_REGION.amazonaws.com/rh-match:s1-amd64 --push .
```
Expect: images visible; each single-architecture.

## 3. Step 1 - Container group definition and fleet (allocation)
```bash
aws gamelift create-container-group-definition --region $HOME_REGION \
  --name rh-match-s1 --container-group-type GAME_SERVER \
  --operating-system AMAZON_LINUX_2023 \
  --total-memory-limit-mebibytes 3000 --total-vcpu-limit 1.0 \
  --game-server-container-definition '{
     "ContainerName":"rh-match",
     "ImageUri":"'$ACCT'.dkr.ecr.'$HOME_REGION'.amazonaws.com/rh-match:s1-arm64",
     "ServerSdkVersion":"5.6.0",
     "Vcpu":0.25,
     "PortConfiguration":{"ContainerPortRanges":[{"FromPort":35000,"ToPort":35000,"Protocol":"TCP"}]},
     "EnvironmentOverride":[{"Name":"MATCHD_MODE","Value":"staging"}]}' \
  --version-description "s1"
aws gamelift describe-container-group-definition --name rh-match-s1 --region $HOME_REGION   # wait for Status READY
```
`ServerSdkVersion` must be the Go SDK version actually vendored (`5.6.0`, go.mod). The TCP protocol on the container port is the first thing to confirm; the doc example response shows TCP while its request shows UDP.

Fleet. Ports: default inbound is UDP, so set both ranges manually (TCP). 8 groups/instance x 1 port, doubled = 16 ports.
```bash
aws gamelift create-container-fleet --region $HOME_REGION \
  --description "rh staging s1" --fleet-role-arn $FLEET_ROLE_ARN \
  --game-server-container-group-definition-name rh-match-s1 \
  --game-server-container-groups-per-instance 8 \
  --instance-type c7g.large --billing-type ON_DEMAND \
  --new-game-session-protection-policy FullProtection \
  --instance-connection-port-range FromPort=4200,ToPort=4215 \
  --instance-inbound-permissions 'FromPort=4200,ToPort=4215,IpRange=0.0.0.0/0,Protocol=TCP' \
  --locations Location=us-west-2 Location=ca-central-1 \
  --log-configuration LogDestination=CLOUDWATCH,LogGroupArn=arn:aws:logs:$HOME_REGION:$ACCT:log-group:/rh/staging \
  --tags Key=env,Value=staging
export FLEET_ID=<containerfleet-... from output>
watch -n 15 "aws gamelift describe-container-fleet --fleet-id $FLEET_ID --region $HOME_REGION --query 'ContainerFleet.[Status,GameServerContainerGroupsPerInstance,MaximumGameServerContainerGroupsPerInstance,LocationAttributes]'"
```
Create the log group first (`aws logs create-log-group --log-group-name /rh/staging`). If the CLI rejects the shorthand, use `--cli-input-json`.
Observations expected: Status `PENDING` -> `ACTIVE`; `Maximum...PerInstance` printed; desired capacity 1 per location. Record: time to ACTIVE, whether `GameServerContainerGroupsPerInstance` 8 is honored (if capped below, record why: memory, vCPU or ports).
**Branches to record (home-region test):** repeat `create-container-fleet --region ca-central-1` (home = Montreal) with its own CGD/ECR. Expected possible outcome: `UnsupportedRegionException` or `InvalidRequestException` (docs hint that home must be a multi-location home Region). Result decides the topology in evaluation 4.1.
Also repeat with `--instance-type c6i.large` and an `-amd64` CGD version to compare architectures.
Port mapping check: `aws gamelift describe-container-group-port-mappings ...` `[verify: aws gamelift describe-container-group-port-mappings help]`. Expect each replica to show container port 35000 mapped to a distinct connection port in 4200-4215.

## 4. Step 2 - Readiness and health
```bash
aws gamelift list-compute --fleet-id $FLEET_ID --location us-west-2 --region $HOME_REGION   # [verify]
aws gamelift describe-compute --fleet-id $FLEET_ID --compute-name <name> --region $HOME_REGION
aws gamelift describe-fleet-location-capacity --fleet-id $FLEET_ID --location us-west-2 --region $HOME_REGION
aws gamelift describe-fleet-events --fleet-id $FLEET_ID --region $HOME_REGION
aws logs tail /rh/staging --follow --region $HOME_REGION
```
Expect: compute `ACTIVE` with `DnsName` and `IpAddress`; capacity shows 8 idle groups (server processes reached `ProcessReady`); glbridge logs `InitSDK ok`, `ProcessReady port=35000`. Record the `DnsName` format (needed for step 9).
Health negative test: make glbridge's `OnHealthCheck` return false (env flag via a new CGD version) and observe the group replaced after repeated failures, and a `SERVER_PROCESS_*` fleet event. Expected per [SDK doc](https://docs.aws.amazon.com/gameliftservers/latest/developerguide/gamelift-sdk-server-api.html): three consecutive unhealthy or no responses.

## 5. Step 3 - Queue and placement (allocation under a queue)
```bash
aws sns create-topic --name rh-placement --region $HOME_REGION
aws gamelift create-game-session-queue --region $HOME_REGION --name rh-q-na \
  --timeout-in-seconds 60 \
  --destinations DestinationArn=arn:aws:gamelift:$HOME_REGION:$ACCT:containerfleet/$FLEET_ID \
  --player-latency-policies 'MaximumIndividualPlayerLatencyMilliseconds=80,PolicyDurationSeconds=20' 'MaximumIndividualPlayerLatencyMilliseconds=150' \
  --priority-configuration 'PriorityOrder=LATENCY,LOCATION,LocationOrder=us-west-2,ca-central-1' \
  --notification-target arn:aws:sns:$HOME_REGION:$ACCT:rh-placement
```
The destination ARN format for container fleets: `[verify]` take it from `describe-container-fleet` `FleetArn` rather than constructing it.
Placement with latency data (player in Calgary, hypothetical ms):
```bash
aws gamelift start-game-session-placement --region $HOME_REGION \
  --placement-id place-s1-$(date +%s) --game-session-queue-name rh-q-na \
  --maximum-player-session-count 8 \
  --desired-player-sessions PlayerId=p1,PlayerData=t PlayerId=p2,PlayerData=t \
  --player-latencies PlayerId=p1,RegionIdentifier=us-west-2,LatencyInMilliseconds=28 \
                     PlayerId=p1,RegionIdentifier=ca-central-1,LatencyInMilliseconds=62 \
  --game-session-data '{"matchId":"m1","seedHint":"x"}' \
  --game-properties Key=mode,Value=standard
aws gamelift describe-game-session-placement --placement-id <id> --region $HOME_REGION
```
Expect: `PENDING` -> `FULFILLED`; `GameSessionRegion=us-west-2` (lowest latency); result has `IpAddress`, `DnsName`, `Port`, and two `PlacedPlayerSessions`; SNS message on fulfillment. glbridge log shows `OnStartGameSession` with the `GameSessionData`, `/control/session` answered, `ActivateGameSession` OK; game session status `ACTIVE` (`aws gamelift describe-game-sessions --fleet-id $FLEET_ID --region $HOME_REGION`). Record placement latency (request to FULFILLED).
Repeat with latencies reversed (ca-central-1 lower) and expect `GameSessionRegion=ca-central-1`. Repeat with `--priority-configuration-override` `[verify parameter name in CLI: aws gamelift start-game-session-placement help]` = manual region selection; note it cannot be combined with `--player-latencies`.
Repeat with a latency over the 80 ms cap for us-west-2 and see it skipped during the first 20 s (sliding policy).

## 6. Step 4 - Admission (player session)
Connect with a WSS client carrying the player-session id from `PlacedPlayerSessions` (use `websocat` or Node `ws` after step 9 is done, or plain `ws://` against the IP/port first):
```bash
aws gamelift describe-player-sessions --game-session-id <gsid> --region $HOME_REGION
```
Expect: sessions `RESERVED` -> `ACTIVE` after the bridge's `/control/admit` and the server's `seated` report -> `AcceptPlayerSession`; record the delay between FULFILLED and the first accepted Hello (the bridge polls `DescribePlayerSessions` every second, so one refused-and-retried connect is expected). Negative tests: bogus id rejected; reuse of an id from another game session rejected; wait 60 s with no connect and observe the reservation time out; 9th player rejected by `MaximumPlayerSessionCount`.

## 7. Step 5 - Reconnect
1. Kill the client socket; reconnect within rh-server's grace window (10 s) using the 16-byte resume token with the same player-session id.
2. Expect-either: (a) `AcceptPlayerSession` succeeds again; or (b) it errors because the session is already ACTIVE. Record which. If (b), design: glbridge skips the second Accept (rh-server keeps its own reconnect token; this is what the bridge already does) and calls `RemovePlayerSession` only on grace expiry.
3. Let the grace expire and verify `RemovePlayerSession` frees the slot (`describe-player-sessions` shows `COMPLETED`/removed, `describe-game-sessions` current player count drops).
4. Browser tab-sleep case: hold a socket idle 90 s and confirm the proxy path keeps it alive.

## 8. Step 6 - Completion and replacement
Let the match end (or `POST /control/end` from inside the container for a forced end) -> `/control/rooms` shows the room `closed` -> glbridge drains, `ProcessEnding()` + `Destroy()` + exit 0.
Expect: game session `TERMINATED`; a fresh group reaches `ProcessReady` (capacity returns to 8 idle) within seconds-to-minutes (record). Crash test: `kill -9` rh-server inside the container (via `aws gamelift get-compute-access` + SSM/exec only if supported `[verify]`, otherwise start a test image whose rh-server exits non-zero on a debug command): expect the game server container (essential) to restart the group and a fleet event; the session ends abnormally. Record that clients see a socket close and that the backend learns via SNS/`describe-game-sessions` (not instantly).

## 9. Step 7 - TLS and DNS reachable from a browser (the blocker test)
Test A - GameLift-issued cert on containers:
```bash
# Expect to fail: CreateContainerFleet has no CertificateConfiguration. Document the exact error if you try:
aws gamelift create-container-fleet ... --certificate-configuration CertificateType=GENERATED   # expect parameter rejected
```
Then in glbridge call `GetComputeCertificate()` (Go SDK) and log the result. Expect an error (re:Post reports Bad Request on container fleets). If it returns files, record the paths, the cert subject/SAN (`openssl x509 -in certificate.pem -noout -subject -ext subjectAltName`) and test whether the SAN matches `Compute.DnsName`; if yes the browser test below can use `wss://<DnsName>:<port>`.
Test B - own cert + Route 53:
```bash
aws route53 change-resource-record-sets --hosted-zone-id $ZONE --change-batch '{
 "Changes":[{"Action":"UPSERT","ResourceRecordSet":{"Name":"m-place-s1.usw2.play-test.<your-domain>","Type":"A","TTL":30,"ResourceRecords":[{"Value":"<IpAddress from placement>"}]}}]}'
dig +short m-place-s1.usw2.play-test.<your-domain>
openssl s_client -connect m-place-s1.usw2.play-test.<your-domain>:<Port> -servername m-place-s1.usw2.play-test.<your-domain> </dev/null | openssl x509 -noout -subject -dates
```
Expect: rh-server serves the wildcard cert (`--tls-cert/--tls-key`, passed through `GLBRIDGE_TLS_CERT/KEY`) on the container port (fetched from Secrets Manager); a Chrome tab on `https://app-test.<your-domain>/` opens `new WebSocket("wss://m-place-s1.usw2.play-test.<your-domain>:<Port>/ws")` with no certificate warning, mixed-content or CSP error, and completes a Hello/Welcome with a real profile token. Run in Chrome, Firefox and Safari (Safari stricter on cert chains). Record: DNS propagation to first successful handshake (target under 10 s after FULFILLED), TLS handshake time, whether a non-443 port is blocked on a corporate/school network test (compare to 443 only if you can expose 443: the connection range may include 443 `[verify allowed]`).
Test C (only if A and B both fail): front with a regional proxy. Out of scope for this run; note and stop.

## 10. Step 8 - Draining and scale-in protection
Preconditions: fleet `NewGameSessionProtectionPolicy FullProtection` (set in step 1); target policy:
```bash
aws gamelift update-fleet-capacity --fleet-id $FLEET_ID --location us-west-2 --min-size 1 --max-size 3 --desired-instances 2 --region $HOME_REGION
aws gamelift put-scaling-policy --fleet-id $FLEET_ID --name rh-target --policy-type TargetBased \
  --metric-name PercentAvailableGameSessions --target-configuration TargetValue=25 --region $HOME_REGION
```
Tests:
1. Fill the fleet: start 17 placements (8 per instance x 2 + 1) with a slow, never-ending match. Expect `PercentAvailableGameSessions` to fall below target and a third instance to be added (max 3). Record scale-up time (instance launch + image pull + ProcessReady).
2. Pin one match as the only session on instance B, end all others, then lower desired to 1. Expect GameLift **not to** terminate the protected instance; instance count stays until that match ends; record which instance GameLift chooses (the emptiest or not) over three repetitions.
3. Override: `aws gamelift update-game-session --game-session-id <id> --protection-policy NoProtection` `[verify]`, repeat step 2 and expect `onProcessTerminate` at scale-down: glbridge must POST `/control/drain`, rh-server refuses new admissions and the match finishes, `GetTerminationTime()` is logged. Record the allowed shutdown time.
4. Fleet deployment under load: with 3 live matches on separate instances, publish CGD version 2 and
```bash
aws gamelift update-container-fleet --fleet-id $FLEET_ID --region $HOME_REGION \
  --game-server-container-group-definition-name rh-match-s1 \
  --deployment-configuration ProtectionStrategy=WITH_PROTECTION,MinimumHealthyPercentage=75,ImpairmentStrategy=ROLLBACK
aws gamelift describe-fleet-deployment --fleet-id $FLEET_ID --region $HOME_REGION
```
Expect: status `UPDATING`; protected instances replaced only after their matches end; new placements land on updated capacity; a deliberately broken image triggers `ROLLBACK`. Record total rollout time with a 15-minute match (the rollout waits for matches).
5. Spot interruption cannot be tested safely; skip. Note `BillingType` is immutable.

## 11. Step 9 - Browser latency probes
Deploy `https://ping.<region-code>.play-test.<your-domain>/p` (204, CORS `*`) in us-west-2 and ca-central-1. From a browser in Calgary/Vancouver/Montreal (use VPN-free real connections), run 1 warm-up and 10 timed fetches per Region on a reused connection; send the medians as `PlayerLatencies`. Compare against measured WSS ping to the sessions placed in each Region (offset and ranking agreement). Record RTT numbers: this is the only real answer to "is us-west-2 OK for western Canada" and whether ca-central-1 or Denver (`us-west-2-den-1`, requires opt-in and a fleet location) is worth adding.

## 12. Step 10 - Density benchmark (cost input)
Raise `GameServerContainerGroupsPerInstance` through 4, 8, 12, 16 (deployment each time; each group is one `--max-rooms 1` process, GAMELIFT_VERIFIED.md section 3.3) with real Rust match load (8 bot clients, 20 Hz) using the P-LOAD-1 harness. Also record per-group RSS and the 50 MiB log router cost. Record per-instance CPU, memory, tick p99, and whether GameLift refuses the value above the calculated maximum (`MaximumGameServerContainerGroupsPerInstance`). Feed the winning density into the cost table in `GAMELIFT_EVALUATION.md` section 5.3 and replace the estimates.

## 13. Pass / fail summary table (fill in when run)
| # | Question | Pass condition | Result |
|---|---|---|---|
| 1 | Container fleet ACTIVE with 8 groups/instance, TCP ports | all replicas ProcessReady | not run |
| 1b | Fleet home in ca-central-1 | succeeds, else record error | not run |
| 2 | Health failure replaces group | within minutes | not run |
| 3 | Queue places by latency / manual override | expected Region | not run |
| 4 | AcceptPlayerSession gates join | bogus ids rejected | not run |
| 5 | Reconnect semantics | documented behaviour | not run |
| 6 | Completion -> new group ready | idle capacity restored | not run |
| 7 | Valid wss:// from Chrome/Firefox/Safari | no warning, echo OK | not run |
| 8 | FullProtection blocks scale-in; rollout waits | protected match survives | not run |
| 9 | HTTPS probe ranks Regions like WSS RTT | same order | not run |
| 10 | Density sweep | chosen N with p99 tick headroom | not run |
Abort and choose ECS if 7 fails with no workable alternative, or 1 fails with TCP ports, or 8 shows protected sessions being killed.

## 14. Teardown and rollback (run even on abort)
Order matters: queue before fleet, fleet before CGD.
```bash
# stop in-flight placements/sessions
aws gamelift describe-game-sessions --fleet-id $FLEET_ID --region $HOME_REGION --query 'GameSessions[].GameSessionId' --output text | \
  xargs -n1 -I{} aws gamelift terminate-game-session --game-session-id {} --termination-mode FORCE_TERMINATE --region $HOME_REGION  # [verify mode names]
aws gamelift delete-scaling-policy --fleet-id $FLEET_ID --name rh-target --region $HOME_REGION
aws gamelift delete-game-session-queue --name rh-q-na --region $HOME_REGION
aws gamelift update-fleet-capacity --fleet-id $FLEET_ID --location us-west-2 --min-size 0 --desired-instances 0 --region $HOME_REGION
aws gamelift update-fleet-capacity --fleet-id $FLEET_ID --location ca-central-1 --min-size 0 --desired-instances 0 --region $HOME_REGION
aws gamelift delete-container-fleet --fleet-id $FLEET_ID --region $HOME_REGION
aws gamelift list-container-group-definition-versions --name rh-match-s1 --region $HOME_REGION
aws gamelift delete-container-group-definition --name rh-match-s1 --region $HOME_REGION   # [verify: version-number-to-delete]
aws ecr delete-repository --repository-name rh-match --force --region $HOME_REGION
aws logs delete-log-group --log-group-name /rh/staging --region $HOME_REGION
aws sns delete-topic --topic-arn arn:aws:sns:$HOME_REGION:$ACCT:rh-placement --region $HOME_REGION
aws route53 change-resource-record-sets --hosted-zone-id $ZONE --change-batch file://delete-records.json
aws secretsmanager delete-secret --secret-id rh/staging/wildcard --force-delete-without-recovery
aws iam detach-role-policy --role-name gl-staging-fleet --policy-arn arn:aws:iam::aws:policy/GameLiftContainerFleetPolicy
aws iam delete-role --role-name gl-staging-fleet
aws budgets delete-budget --account-id $ACCT --budget-name gl-staging
```
Verify nothing remains: `aws gamelift list-container-fleets`, `list-container-group-definitions`, `aws ec2 describe-instances --filters Name=instance-state-name,Values=running` in both Regions, and next-day Cost Explorer for GameLift and EC2.
Rollback of a bad fleet deployment: `ImpairmentStrategy=ROLLBACK` handles automatic revert; manually, `update-container-fleet` pointing back at the previous CGD ARN with its version suffix (`...:1`).
Because the AMI cannot be updated in place and AWS recommends replacing fleets every 30 days, also rehearse a blue/green swap: create fleet B, add it as a second queue destination, set fleet A `desired-instances` to 0 after drain, delete A.
