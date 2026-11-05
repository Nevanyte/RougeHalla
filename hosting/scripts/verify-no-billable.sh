#!/usr/bin/env bash
# Evidence that billing has stopped: inventories EVERY resource type the staging IaC and rollout can create, in each chosen Region,
# and exits 1 if anything remains. Read-only (list/describe calls only).
#
# Types checked per Region: tagged resources of any kind (resourcegroupstaggingapi, Project=rougehalla-infra), CloudFormation
# stacks, GameLift container fleets (ANY fleet, tagged or not: the sandbox account should hold none) and their instance counts,
# container group definitions, ECR repositories, CloudWatch alarms, dashboards, log groups, SNS topics, EC2 instances tagged
# Project=rougehalla-infra. Account level: the budget, fleet and budget-action roles and policies.
#
#   hosting/scripts/verify-no-billable.sh --experiment stg1 --dry-run
#   AWS_PROFILE=rh-sandbox hosting/scripts/verify-no-billable.sh --experiment stg1 --yes
#
# Billing itself lags by hours: after this passes, also look at Cost Explorer a day later (docs/hosting/COST.md section 8).
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
    -h|--help) sed -n '2,15p' "$0"; exit 0 ;;
    *) rh_flag "$1" || rh_die "unknown argument: $1" ;;
  esac
  shift
done
[[ "$exp" =~ ^[a-z][a-z0-9-]{2,20}$ ]] || rh_die "--experiment must match [a-z][a-z0-9-]{2,20}"
rh_ready
prefix="rougehalla-infra-$exp"
IFS=',' read -r -a region_list <<<"$regions"
found=0

# check <what> <jq filter yielding the leftovers, one per line> -- <aws read call...>
check() {
  local what="$1" filter="$2"; shift 3
  if [ "$RH_DRY" = 1 ]; then aws_out "$@"; rh_note "FAIL if non-empty: $what ($filter)"; return 0; fi
  local out
  out="$(aws_out "$@" --output json | jq -r "$filter")" || { echo "ERROR: could not list $what" >&2; found=1; return 0; }
  if [ -n "$out" ]; then
    echo "FOUND $what:" >&2; printf '  %s\n' $out >&2; found=1
  else
    echo "ok    no $what" >&2
  fi
}

for r in "${region_list[@]}"; do
  echo "== region $r ==" >&2
  check "tagged resources (Project=rougehalla-infra)" '.ResourceTagMappingList[]?.ResourceARN' -- --region "$r" resourcegroupstaggingapi get-resources --tag-filters Key=Project,Values=rougehalla-infra
  check "CloudFormation stacks named $prefix*" '.StackSummaries[]?|select(.StackName|startswith("'"$prefix"'"))|.StackName' -- --region "$r" cloudformation list-stacks --stack-status-filter CREATE_IN_PROGRESS CREATE_COMPLETE CREATE_FAILED ROLLBACK_IN_PROGRESS ROLLBACK_COMPLETE ROLLBACK_FAILED UPDATE_IN_PROGRESS UPDATE_COMPLETE UPDATE_ROLLBACK_COMPLETE UPDATE_ROLLBACK_FAILED DELETE_IN_PROGRESS DELETE_FAILED
  check "GameLift container fleets (any)" '.ContainerFleetList[]?|.FleetId' -- --region "$r" gamelift list-container-fleets
  check "GameLift container group definitions rougehalla-*" '.ContainerGroupDefinitions[]?|select(.Name|startswith("rougehalla-"))|.Name' -- --region "$r" gamelift list-container-group-definitions
  check "ECR repositories rougehalla-infra/*" '.repositories[]?|select(.repositoryName|startswith("rougehalla-infra/"))|.repositoryName' -- --region "$r" ecr describe-repositories
  check "CloudWatch alarms rougehalla-infra-*" '.MetricAlarms[]?|.AlarmName' -- --region "$r" cloudwatch describe-alarms --alarm-name-prefix rougehalla-infra-
  check "CloudWatch dashboards rougehalla-*" '.DashboardEntries[]?|.DashboardName' -- --region "$r" cloudwatch list-dashboards --dashboard-name-prefix rougehalla
  check "CloudWatch log groups gamelift-rougehalla-infra/" '.logGroups[]?|.logGroupName' -- --region "$r" logs describe-log-groups --log-group-name-prefix gamelift-rougehalla-infra/
  check "SNS topics rougehalla-infra-*" '.Topics[]?|.TopicArn|select(contains(":rougehalla-infra-"))' -- --region "$r" sns list-topics
  check "EC2 instances tagged Project=rougehalla-infra (not terminated)" '.Reservations[]?.Instances[]?|select(.State.Name!="terminated")|.InstanceId' -- --region "$r" ec2 describe-instances --filters Name=tag:Project,Values=rougehalla-infra
done
echo "== account level ==" >&2
check "CloudFormation stacks in $budget_region named $prefix*" '.StackSummaries[]?|select(.StackName|startswith("'"$prefix"'"))|.StackName' -- --region "$budget_region" cloudformation list-stacks --stack-status-filter CREATE_IN_PROGRESS CREATE_COMPLETE CREATE_FAILED ROLLBACK_IN_PROGRESS ROLLBACK_COMPLETE ROLLBACK_FAILED UPDATE_IN_PROGRESS UPDATE_COMPLETE UPDATE_ROLLBACK_COMPLETE UPDATE_ROLLBACK_FAILED DELETE_IN_PROGRESS DELETE_FAILED
acct='<account-id>'; [ "$RH_DRY" = 1 ] || acct="$RH_EXPECT_ACCOUNT"
check "budgets rougehalla-infra-*" '.Budgets[]?|select(.BudgetName|startswith("rougehalla-infra-"))|.BudgetName' -- --region "$budget_region" budgets describe-budgets --account-id "$acct"
check "IAM roles rougehalla-infra-*" '.Roles[]?|select(.RoleName|startswith("rougehalla-infra-"))|.RoleName' -- iam list-roles
check "IAM customer policies rougehalla-infra-*" '.Policies[]?|select(.PolicyName|startswith("rougehalla-infra-"))|.Arn' -- iam list-policies --scope Local

if [ "$RH_DRY" = 1 ]; then echo "dry run: nothing was called" >&2; exit 0; fi
if [ "$found" = 0 ]; then echo "PASS: nothing billable remains for experiment $exp in: $regions $budget_region" >&2; exit 0; fi
echo "FAIL: resources remain (see FOUND above); run teardown.sh again and re-verify" >&2
exit 1
