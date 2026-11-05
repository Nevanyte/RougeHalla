#!/usr/bin/env bash
# Tears down everything the staging IaC (hosting/infra/fleet/*.cfn.yaml) and the rollout script can create, in dependency order,
# in the chosen Regions, for one experiment id. Primary path: delete the CloudFormation stacks. Then a sweep by name prefix and
# tag removes anything a failed or partial stack left behind (and anything created with the CLI, e.g. a ca-central-1 home fleet).
#
#   hosting/scripts/teardown.sh --experiment stg1 --dry-run                       # prints the AWS CLI calls, makes none
#   AWS_PROFILE=rh-sandbox hosting/scripts/teardown.sh --experiment stg1 --yes    # real; refuses without BOTH
#
# Afterwards run verify-no-billable.sh: only it, not this script's exit code, is the evidence that billing stopped.
# Flags other than the gamelift ones were written from the CLI reference by memory (UNVERIFIED): read the --dry-run output first.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=lib/guard.sh
. "$here/lib/guard.sh"

exp="" regions="us-west-2,ca-central-1" budget_region="us-east-1"
while [ $# -gt 0 ]; do
  case "$1" in
    --experiment) exp="${2:?}"; shift ;;
    --regions) regions="${2:?}"; shift ;;
    --budget-region) budget_region="${2:?}"; shift ;;
    -h|--help) sed -n '2,12p' "$0"; exit 0 ;;
    *) rh_flag "$1" || rh_die "unknown argument: $1" ;;
  esac
  shift
done
[[ "$exp" =~ ^[a-z][a-z0-9-]{2,20}$ ]] || rh_die "--experiment must match [a-z][a-z0-9-]{2,20}"
rh_ready

prefix="rougehalla-infra-$exp"
IFS=',' read -r -a region_list <<<"$regions"

each() { # each <jq filter> <fn> -- <list call...>: runs fn on every item the list call yields (dry run prints the shape).
  local filter="$1" fn="$2"; shift 3
  if [ "$RH_DRY" = 1 ]; then
    aws_out "$@"; rh_note "for each item ($filter): $fn <item>"; "$fn" "<item>"
  else
    local item listed selected
    listed="$(aws_out "$@" --output json)" || return 1
    selected="$(printf '%s' "$listed" | jq -r "$filter")" || return 1
    while IFS= read -r item; do
      if [ -n "$item" ]; then "$fn" "$item" || return 1; fi
    done <<< "$selected"
  fi
  return 0
}

for r in "${region_list[@]}"; do
  echo "== region $r ==" >&2
  # 1. CloudFormation stacks of this experiment (the fleet stack); deleting the stack removes fleet, group definition,
  #    repository (EmptyOnDelete), log group, alarms, topic and the fleet role in the right order.
  del_stack() { aws_ --region "$r" cloudformation delete-stack --stack-name "$1" || return 1; aws_ --region "$r" cloudformation wait stack-delete-complete --stack-name "$1"; }
  each '.StackSummaries[]|select(.StackName=="'"$prefix"'-fleet" or .StackName=="'"$prefix"'-budget")|.StackName' del_stack -- \
    --region "$r" cloudformation list-stacks --stack-status-filter CREATE_COMPLETE UPDATE_COMPLETE ROLLBACK_COMPLETE CREATE_FAILED ROLLBACK_FAILED DELETE_FAILED UPDATE_ROLLBACK_COMPLETE

  # 2. Sweep: container fleets (scale to zero first, stop auto scaling so it cannot scale back up, then delete) ...
  del_fleet() {
    if [ "$RH_DRY" = 0 ]; then
      if rh_fleet_owned "$r" "$1" "$exp"; then :; else
        local identity_status=$?
        [ "$identity_status" = 1 ] || return 1
        echo "skip fleet $1: different experiment/account/region" >&2; return 0
      fi
    else
      rh_note "only fleets with exact Project=rougehalla-infra and Experiment=$exp tags, verified by ARN in this account/region"
    fi
    aws_ --region "$r" gamelift stop-fleet-actions --fleet-id "$1" --actions AUTO_SCALING || return 1
    aws_ --region "$r" gamelift update-fleet-capacity --fleet-id "$1" --desired-instances 0 --min-size 0 --max-size 0 || return 1
    if [ "$RH_DRY" = 1 ]; then
      rh_note "same update-fleet-capacity with --location <L> for every remote location of the fleet (describe-fleet-location-attributes)"
    else
      aws --profile "$AWS_PROFILE" --region "$r" gamelift describe-fleet-location-attributes --fleet-id "$1" --output json 2>/dev/null \
        | jq -r '.LocationAttributes[]?.LocationState.Location' | while read -r loc; do
            [ "$loc" = "$r" ] || aws_ --region "$r" gamelift update-fleet-capacity --fleet-id "$1" --location "$loc" --desired-instances 0 --min-size 0 --max-size 0 || return 1
          done || return 1
    fi
    aws_ --region "$r" gamelift delete-container-fleet --fleet-id "$1" || return 1
    if [ "$RH_DRY" = 0 ]; then # wait until the fleet is gone (deleting is asynchronous); at most 20 minutes
      local gone=0
      for _ in $(seq 1 120); do
        aws --profile "$AWS_PROFILE" --region "$r" gamelift list-container-fleets --output json | jq -e --arg f "$1" '[.ContainerFleetList[]?|select(.FleetId==$f)]|length==0' >/dev/null && { gone=1; break; }
        sleep 10
      done
      [ "$gone" = 1 ] || return 1
    fi
  }
  # Every fleet is inspected read-only; only exact experiment tags authorize deletion.
  each '.ContainerFleetList[]?|.FleetId' del_fleet -- --region "$r" gamelift list-container-fleets
  # ... container group definitions (all versions) ...
  del_cgd() { aws_ --region "$r" gamelift delete-container-group-definition --name "$1"; }
  each '.ContainerGroupDefinitions[]?|select(.Name=="rougehalla-'"$exp"'-match")|.Name' del_cgd -- --region "$r" gamelift list-container-group-definitions
  # ... image repositories (--force deletes the images in them) ...
  del_repo() { aws_ --region "$r" ecr delete-repository --repository-name "$1" --force; }
  each '.repositories[]?|select(.repositoryName|startswith("rougehalla-infra/'"$exp"'/"))|.repositoryName' del_repo -- --region "$r" ecr describe-repositories
  # ... alarms, log groups, topics.
  del_alarms() { aws_ --region "$r" cloudwatch delete-alarms --alarm-names "$1"; }
  each '.MetricAlarms[]?|.AlarmName|select(. as $name | ["'"$prefix"'-instances-at-cap","'"$prefix"'-low-available-sessions","'"$prefix"'-server-process-abnormal-termination","'"$prefix"'-unhealthy-server-processes","'"$prefix"'-container-cpu-high","'"$prefix"'-container-memory-high","'"$prefix"'-idle-instances-billing"]|index($name))' del_alarms -- --region "$r" cloudwatch describe-alarms --alarm-name-prefix "$prefix-"
  del_lg() { aws_ --region "$r" logs delete-log-group --log-group-name "$1"; }
  each '.logGroups[]?|.logGroupName' del_lg -- --region "$r" logs describe-log-groups --log-group-name-prefix "gamelift-rougehalla-infra/$exp/"
  del_topic() { aws_ --region "$r" sns delete-topic --topic-arn "$1"; }
  each '.Topics[]?|.TopicArn|select(.=="arn:aws:sns:'"$r"':'"$RH_EXPECT_ACCOUNT"':'"$prefix"'-alarms")' del_topic -- --region "$r" sns list-topics
done

# 2b. The budget stack lives in the budget Region.
r="$budget_region"
each '.StackSummaries[]|select(.StackName=="'"$prefix"'-fleet" or .StackName=="'"$prefix"'-budget")|.StackName' del_stack -- \
  --region "$r" cloudformation list-stacks --stack-status-filter CREATE_COMPLETE UPDATE_COMPLETE ROLLBACK_COMPLETE CREATE_FAILED ROLLBACK_FAILED DELETE_FAILED UPDATE_ROLLBACK_COMPLETE

# 3. Account-level pieces: the budget (and its action), the fleet roles and the budget-action policy/role (IAM and Budgets are
#    not per Region; the budget lives in $budget_region).
echo "== account level ($budget_region) ==" >&2
acct_id() { if [ "$RH_DRY" = 1 ]; then echo '<account-id>'; else echo "$RH_EXPECT_ACCOUNT"; fi; }
del_budget_action() { aws_ --region "$budget_region" budgets delete-budget --account-id "$(acct_id)" --budget-name "$1"; }
each '.Budgets[]?|select(.BudgetName=="'"$prefix"'")|.BudgetName' del_budget_action -- --region "$budget_region" budgets describe-budgets --account-id "$(acct_id)"
del_role() {
  if [ "$RH_DRY" = 0 ]; then
    aws --profile "$AWS_PROFILE" iam list-attached-role-policies --role-name "$1" --output json | jq -r '.AttachedPolicies[]?.PolicyArn' | while read -r p; do aws_ iam detach-role-policy --role-name "$1" --policy-arn "$p" || exit 1; done || return 1
    aws --profile "$AWS_PROFILE" iam list-role-policies --role-name "$1" --output json | jq -r '.PolicyNames[]?' | while read -r p; do aws_ iam delete-role-policy --role-name "$1" --policy-name "$p"; done || return 1
  else
    rh_note "detach every managed policy and delete every inline policy of the role first"
  fi
  aws_ iam delete-role --role-name "$1"
}
each '.Roles[]?|select(.RoleName=="'"$prefix"'-fleet-us-west-2" or .RoleName=="'"$prefix"'-fleet-ca-central-1")|.RoleName' del_role -- iam list-roles
del_policy() { aws_ iam delete-policy --policy-arn "$1"; }
each '.Policies[]?|select(.PolicyName=="'"$prefix"'-deny-new-billable")|.Arn' del_policy -- iam list-policies --scope Local

echo "teardown $([ "$RH_DRY" = 1 ] && echo planned || echo finished) for experiment $exp. Now run: hosting/scripts/verify-no-billable.sh --experiment $exp --yes" >&2
