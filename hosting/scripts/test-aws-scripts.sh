#!/usr/bin/env bash
# Tests teardown.sh and verify-no-billable.sh against a STUB `aws` on PATH (no real AWS CLI is ever called, none is installed on
# the development machine). Proves: refusal without --yes / AWS_PROFILE / the right account; --dry-run makes zero calls; the order of
# the destructive calls; --force on the repository; every call carries --profile; verify fails while resources remain and passes
# after the stubbed teardown. The stub keeps its state in a call log: a resource "exists" until its delete call was logged.
set -uo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
work="$(mktemp -d "${TMPDIR:-/tmp}/rh-aws-test.XXXXXX")"
trap 'rm -rf "$work"' EXIT
mkdir "$work/bin"
cat >"$work/bin/aws" <<'STUB'
#!/usr/bin/env bash
echo "$*" >>"$STUB_LOG"
args=" $* "
has() { grep -q -- "$1" "$STUB_LOG"; }
dirty() { [ "${STUB_MODE:-dirty}" = dirty ]; }
case "$args" in
  *" sts get-caller-identity "*) echo "${STUB_ACCOUNT:-961470857356}" ;;
  *" cloudformation list-stacks "*) if dirty && ! has "delete-stack"; then echo '{"StackSummaries":[{"StackName":"rougehalla-infra-stg1-fleet"}]}'; else echo '{"StackSummaries":[]}'; fi ;;
  *" gamelift list-container-fleets "*) if dirty && ! has "delete-container-fleet"; then echo '{"ContainerFleetList":[{"FleetId":"containerfleet-aaa","Description":"RougeHalla stg1 (staging)"}]}'; else echo '{"ContainerFleetList":[]}'; fi ;;
  *" gamelift list-container-group-definitions "*) if dirty && ! has "delete-container-group-definition"; then echo '{"ContainerGroupDefinitions":[{"Name":"rougehalla-stg1-match"}]}'; else echo '{"ContainerGroupDefinitions":[]}'; fi ;;
  *" ecr describe-repositories "*) if dirty && ! has "delete-repository"; then echo '{"repositories":[{"repositoryName":"rougehalla-infra/stg1/rh-match"}]}'; else echo '{"repositories":[]}'; fi ;;
  *" cloudwatch describe-alarms --state-value ALARM "*) echo '{"MetricAlarms":[]}' ;;
  *" ecr describe-images "*) echo '{}' ;;
  *" gamelift describe-container-fleet "*) echo '{"ContainerFleet":{"GameServerContainerGroupDefinitionArn":"arn:aws:gamelift:us-west-2:961470857356:containergroupdefinition/rougehalla-stg1-match:3"}}' ;;
  *" gamelift update-container-group-definition "*) echo '{"ContainerGroupDefinition":{"ContainerGroupDefinitionArn":"arn:aws:gamelift:us-west-2:961470857356:containergroupdefinition/rougehalla-stg1-match:4"}}' ;;
  *" gamelift describe-container-group-definition "*) echo '{"ContainerGroupDefinition":{"Status":"READY"}}' ;;
  *" gamelift describe-fleet-deployment "*) echo "{\"FleetDeployment\":{\"DeploymentStatus\":\"${STUB_DEPLOY:-COMPLETE}\"}}" ;;
  *" cloudwatch describe-alarms "*) if dirty && ! has "delete-alarms"; then echo '{"MetricAlarms":[{"AlarmName":"rougehalla-infra-stg1-instances-at-cap"}]}'; else echo '{"MetricAlarms":[]}'; fi ;;
  *" logs describe-log-groups "*) if dirty && ! has "delete-log-group"; then echo '{"logGroups":[{"logGroupName":"/rougehalla-infra/stg1/fleet"}]}'; else echo '{"logGroups":[]}'; fi ;;
  *" sns list-topics "*) if dirty && ! has "delete-topic"; then echo '{"Topics":[{"TopicArn":"arn:aws:sns:us-west-2:961470857356:rougehalla-infra-stg1-alarms"}]}'; else echo '{"Topics":[]}'; fi ;;
  *" budgets describe-budgets "*) if dirty && ! has "delete-budget"; then echo '{"Budgets":[{"BudgetName":"rougehalla-infra-stg1"}]}'; else echo '{"Budgets":[]}'; fi ;;
  *" iam list-roles "*) if dirty && ! has "delete-role"; then echo '{"Roles":[{"RoleName":"rougehalla-infra-stg1-fleet-us-west-2"}]}'; else echo '{"Roles":[]}'; fi ;;
  *" resourcegroupstaggingapi get-resources "*) if dirty && ! has "delete-container-fleet"; then echo '{"ResourceTagMappingList":[{"ResourceARN":"arn:aws:gamelift:us-west-2:961470857356:containerfleet/containerfleet-aaa"}]}'; else echo '{"ResourceTagMappingList":[]}'; fi ;;
  *) echo '{}' ;;
esac
STUB
chmod +x "$work/bin/aws"
export STUB_LOG="$work/calls.log"
pass=0 failn=0
ok() { pass=$((pass + 1)); printf 'PASS  %s\n' "$1"; }
bad() { failn=$((failn + 1)); printf 'FAIL  %s\n' "$1"; }
t() { # t <name> <expected exit> <expect no calls: 1|0> -- command...
  local name="$1" want="$2" nocalls="$3"; shift 4
  : >"$STUB_LOG"
  out="$("$@" 2>&1)"; rc=$?
  if [ "$rc" != "$want" ]; then bad "$name (exit $rc, wanted $want): $(printf '%s' "$out" | tail -2 | tr '\n' ' ')"; return; fi
  if [ "$nocalls" = 1 ] && [ -s "$STUB_LOG" ]; then bad "$name (made AWS calls: $(head -1 "$STUB_LOG"))"; return; fi
  ok "$name"
}
tear="$here/teardown.sh" ver="$here/verify-no-billable.sh"
PATHSTUB="$work/bin:$PATH"

t "teardown with no flags refuses" 2 1 -- env PATH="$PATHSTUB" "$tear" --experiment stg1
t "teardown --yes without AWS_PROFILE refuses" 2 1 -- env -u AWS_PROFILE PATH="$PATHSTUB" "$tear" --experiment stg1 --yes
t "teardown AWS_PROFILE without --yes refuses" 2 1 -- env AWS_PROFILE=rh-test PATH="$PATHSTUB" "$tear" --experiment stg1
t "teardown --dry-run and --yes together refuse" 2 1 -- env AWS_PROFILE=rh-test PATH="$PATHSTUB" "$tear" --experiment stg1 --dry-run --yes
t "teardown rejects a bad experiment id" 2 1 -- env AWS_PROFILE=rh-test PATH="$PATHSTUB" "$tear" --experiment 'Bad;id' --yes
t "teardown refuses static credentials" 2 1 -- env AWS_PROFILE=rh-test AWS_ACCESS_KEY_ID=x PATH="$PATHSTUB" "$tear" --experiment stg1 --yes
t "teardown --dry-run makes no call and needs no profile" 0 1 -- env -u AWS_PROFILE PATH="$PATHSTUB" "$tear" --experiment stg1 --dry-run
: >"$STUB_LOG"
out="$(env -u AWS_PROFILE PATH="$PATHSTUB" "$tear" --experiment stg1 --dry-run 2>&1)"
case "$out" in *'delete-container-fleet'*) ok "teardown --dry-run prints the delete-container-fleet call" ;; *) bad "teardown --dry-run output lacks delete-container-fleet" ;; esac
t "verify --dry-run makes no call" 0 1 -- env -u AWS_PROFILE PATH="$PATHSTUB" "$ver" --experiment stg1 --dry-run
t "verify without --yes refuses" 2 1 -- env AWS_PROFILE=rh-test PATH="$PATHSTUB" "$ver" --experiment stg1

: >"$STUB_LOG"
out="$(env AWS_PROFILE=rh-test STUB_ACCOUNT=111111111111 PATH="$PATHSTUB" "$tear" --experiment stg1 --yes 2>&1)"; rc=$?
{ [ "$rc" = 2 ] && [ "$(wc -l <"$STUB_LOG")" -eq 1 ] && grep -q 'sts get-caller-identity' "$STUB_LOG" && ! grep -q delete "$STUB_LOG"; } && ok "teardown in the wrong account stops after the identity call" || bad "wrong account was not stopped (rc=$rc)"

t "verify FAILS while resources remain" 1 0 -- env AWS_PROFILE=rh-test STUB_MODE=dirty PATH="$PATHSTUB" "$ver" --experiment stg1 --yes
: >"$STUB_LOG"
out="$(env AWS_PROFILE=rh-test STUB_MODE=dirty PATH="$PATHSTUB" "$ver" --experiment stg1 --yes 2>&1)"
case "$out" in *'FOUND GameLift container fleets'*) ok "verify names the leftover fleet" ;; *) bad "verify did not name the fleet" ;; esac

: >"$STUB_LOG"
env AWS_PROFILE=rh-test STUB_MODE=dirty PATH="$PATHSTUB" "$tear" --experiment stg1 --yes >"$work/tear.out" 2>&1; rc=$?
[ "$rc" = 0 ] && ok "teardown (stub, dirty) exits 0" || { bad "teardown (stub) exit $rc"; tail -5 "$work/tear.out"; }
ln() { grep -n -- "$1" "$STUB_LOG" | head -1 | cut -d: -f1; }
a=$(ln 'stop-fleet-actions'); b=$(ln 'update-fleet-capacity'); c=$(ln 'delete-container-fleet'); d=$(ln 'delete-container-group-definition'); e=$(ln 'delete-repository')
[ -n "$a" ] && [ -n "$b" ] && [ -n "$c" ] && [ -n "$d" ] && [ "$a" -lt "$b" ] && [ "$b" -lt "$c" ] && [ "$c" -lt "$d" ] && ok "order: stop auto scaling, scale to 0, delete fleet, then group definition" || bad "destructive call order wrong ($a $b $c $d)"
grep -q 'delete-repository .*--force' "$STUB_LOG" && ok "repository deleted with --force" || bad "repository delete lacks --force"
grep -q 'update-fleet-capacity .*--desired-instances 0 --min-size 0 --max-size 0' "$STUB_LOG" && ok "capacity set to zero before delete" || bad "capacity not zeroed"
[ -z "$(grep -v -- '--profile rh-test' "$STUB_LOG" | grep -v '^--profile')" ] && ok "every call carried --profile" || bad "a call lacked --profile: $(grep -v -- '--profile rh-test' "$STUB_LOG" | head -1)"
# No reset of the call log here: the stub keeps its state in it, so this verify sees the world after the stubbed teardown.
env AWS_PROFILE=rh-test STUB_MODE=dirty PATH="$PATHSTUB" "$ver" --experiment stg1 --yes >"$work/ver.out" 2>&1; rc=$?
[ "$rc" = 0 ] && ok "verify PASSES after the stubbed teardown" || { bad "verify after teardown exit $rc"; grep FOUND -A2 "$work/ver.out" | head; }
t "verify PASSES on a clean account" 0 0 -- env AWS_PROFILE=rh-test STUB_MODE=clean PATH="$PATHSTUB" "$ver" --experiment stg1 --yes

# ---- rollout.sh ----
roll="$here/rollout.sh"
rargs=(--region us-west-2 --experiment stg1 --fleet-id containerfleet-abcdef12 --image-tag build-abc123)
t "rollout refuses the tag latest" 2 1 -- env AWS_PROFILE=rh-test PATH="$PATHSTUB" "$roll" --region us-west-2 --experiment stg1 --fleet-id containerfleet-abcdef12 --image-tag latest --yes
t "rollout refuses a production-looking Region" 2 1 -- env AWS_PROFILE=rh-test PATH="$PATHSTUB" "$roll" --region eu-west-1 --experiment stg1 --fleet-id containerfleet-abcdef12 --image-tag build-abc123 --yes
t "rollout without --yes refuses" 2 1 -- env AWS_PROFILE=rh-test PATH="$PATHSTUB" "$roll" "${rargs[@]}"
t "rollout --dry-run makes no call" 0 1 -- env -u AWS_PROFILE PATH="$PATHSTUB" "$roll" "${rargs[@]}" --dry-run
t "rollout passes when the deployment is COMPLETE and no alarm fires" 0 0 -- env AWS_PROFILE=rh-test STUB_DEPLOY=COMPLETE PATH="$PATHSTUB" "$roll" "${rargs[@]}" --yes --gate-wait-secs 0
grep -q 'update-container-fleet .*WITH_PROTECTION.*ROLLBACK' "$STUB_LOG" && ok "rollout used the protected, auto-rollback deployment configuration" || bad "rollout deployment configuration missing"
: >"$STUB_LOG"
env AWS_PROFILE=rh-test STUB_DEPLOY=IMPAIRED PATH="$PATHSTUB" "$roll" "${rargs[@]}" --yes --gate-wait-secs 0 >"$work/roll.out" 2>&1; rc=$?
[ "$rc" = 1 ] && ok "rollout fails the gate on an IMPAIRED deployment" || bad "rollout exit $rc on IMPAIRED"
last="$(grep 'update-container-fleet' "$STUB_LOG" | tail -1)"
case "$last" in *containergroupdefinition/rougehalla-stg1-match:3*) ok "rollout pointed the fleet back at the remembered version (:3)" ;; *) bad "rollback target wrong: $last" ;; esac

printf '\n%d passed, %d failed\n' "$pass" "$failn"
[ "$failn" = 0 ]
