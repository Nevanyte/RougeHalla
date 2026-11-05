#!/usr/bin/env bash
# One staged, health-gated release of a build to a staging container fleet (docs/hosting/DEPLOYMENT.md section 3). Never touches
# production, never builds or pushes an image (the image tag must already be in ECR; tags are immutable).
#
#   hosting/scripts/rollout.sh --region us-west-2 --experiment stg1 --fleet-id containerfleet-... --image-tag <RH_BUILD> --dry-run
#   AWS_PROFILE=rh-sandbox hosting/scripts/rollout.sh ... --yes
#
# Steps: (1) the tag exists in ECR; (2) remember the fleet's current group-definition version (the rollback target); (3) create a
# new group-definition version from it with the new image and wait for READY; (4) point the fleet at it with the protected,
# auto-rollback deployment configuration; (5) poll the deployment and the alarms until COMPLETE, a rollback, or the time limit;
# (6) on any failed gate, point the fleet back at the remembered version. Exit 0 only for COMPLETE with no alarm in ALARM.
# CLI flag spellings other than the gamelift command names are from memory (UNVERIFIED): read the --dry-run output first.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=lib/guard.sh
. "$here/lib/guard.sh"

region="" exp="" fleet="" tag="" max_wait=1800 gate_wait=300
while [ $# -gt 0 ]; do
  case "$1" in
    --region) region="${2:?}"; shift ;;
    --experiment) exp="${2:?}"; shift ;;
    --fleet-id) fleet="${2:?}"; shift ;;
    --image-tag) tag="${2:?}"; shift ;;
    --max-wait-secs) max_wait="${2:?}"; shift ;;
    --gate-wait-secs) gate_wait="${2:?}"; shift ;;
    -h|--help) sed -n '2,14p' "$0"; exit 0 ;;
    *) rh_flag "$1" || rh_die "unknown argument: $1" ;;
  esac
  shift
done
[[ "$exp" =~ ^[a-z][a-z0-9-]{2,20}$ ]] || rh_die "--experiment must match [a-z][a-z0-9-]{2,20}"
[[ "$region" =~ ^(us-west-2|ca-central-1)$ ]] || rh_die "--region must be one of the staging Regions: us-west-2, ca-central-1"
[[ "$fleet" =~ ^[A-Za-z0-9-]{8,64}$ ]] || rh_die "--fleet-id is required"
[[ "$tag" =~ ^[A-Za-z0-9_.-]{4,64}$ ]] && [ "$tag" != latest ] || rh_die "--image-tag must be an immutable build tag (RH_BUILD), never 'latest'"
rh_ready
name="rougehalla-$exp-match"
repo="rougehalla-infra/$exp/rh-match"

# 1. the image exists (tags are immutable, so this is also the identity of what will run)
aws_ --region "$region" ecr describe-images --repository-name "$repo" --image-ids "imageTag=$tag" >/dev/null
# 2. rollback target: the group definition version the fleet runs now
prev="<current-group-definition-arn>"
if [ "$RH_DRY" = 0 ]; then
  prev="$(aws_out --region "$region" gamelift describe-container-fleet --fleet-id "$fleet" --output json | jq -r '.ContainerFleet.GameServerContainerGroupDefinitionArn')"
  [ -n "$prev" ] && [ "$prev" != null ] || rh_die "cannot read the fleet's current group definition"
  echo "rollback target: $prev" >&2
else
  aws_out --region "$region" gamelift describe-container-fleet --fleet-id "$fleet"; rh_note "rollback target = .ContainerFleet.GameServerContainerGroupDefinitionArn"
fi
# 3. a new version with the new image
ecr_uri="<account>.dkr.ecr.$region.amazonaws.com/$repo:$tag"
[ "$RH_DRY" = 1 ] || ecr_uri="${RH_EXPECT_ACCOUNT}.dkr.ecr.$region.amazonaws.com/$repo:$tag"
newarn="<new-version-arn>"
if [ "$RH_DRY" = 0 ]; then
  newarn="$(aws_ --region "$region" gamelift update-container-group-definition --name "$name" \
    --game-server-container-definition "ImageUri=$ecr_uri" --version-description "RH_BUILD $tag" --output json | jq -r '.ContainerGroupDefinition.ContainerGroupDefinitionArn')"
  for _ in $(seq 1 60); do # COPYING -> READY (GameLift copies the image into its own store first)
    st="$(aws --profile "$AWS_PROFILE" --region "$region" gamelift describe-container-group-definition --name "$newarn" --output json | jq -r '.ContainerGroupDefinition.Status')"
    [ "$st" = READY ] && break
    [ "$st" = FAILED ] && { echo "new version FAILED to copy; fleet untouched" >&2; exit 1; }
    sleep 10
  done
  [ "$st" = READY ] || { echo "new version not READY in time; fleet untouched" >&2; exit 1; }
else
  aws_ --region "$region" gamelift update-container-group-definition --name "$name" --game-server-container-definition "ImageUri=$ecr_uri" --version-description "RH_BUILD $tag"
  aws_out --region "$region" gamelift describe-container-group-definition --name "$newarn"; rh_note "repeat until .ContainerGroupDefinition.Status == READY (FAILED: stop, fleet untouched)"
fi
# 4. the protected, auto-rollback deployment
point() { aws_ --region "$region" gamelift update-container-fleet --fleet-id "$fleet" --game-server-container-group-definition-name "$1" \
  --deployment-configuration "ProtectionStrategy=WITH_PROTECTION,MinimumHealthyPercentage=75,ImpairmentStrategy=ROLLBACK"; }
point "$newarn"
# 5. gates
if [ "$RH_DRY" = 1 ]; then
  aws_out --region "$region" gamelift describe-fleet-deployment --fleet-id "$fleet"; rh_note "poll every 15 s up to $max_wait s until .FleetDeployment.DeploymentStatus is COMPLETE (pass) or IMPAIRED / ROLLBACK_* / CANCELLED (fail)"
  aws_out --region "$region" cloudwatch describe-alarms --state-value ALARM --alarm-name-prefix "rougehalla-infra-$exp"; rh_note "any alarm in ALARM during the gate window ($gate_wait s) fails the gate"
  aws_ --region "$region" gamelift update-container-fleet --fleet-id "$fleet" --game-server-container-group-definition-name "$prev"; rh_note "on a failed gate: point the fleet back at the remembered version"
  echo "dry run: nothing was called" >&2; exit 0
fi
start=$SECONDS status=""
while [ $((SECONDS - start)) -lt "$max_wait" ]; do
  status="$(aws --profile "$AWS_PROFILE" --region "$region" gamelift describe-fleet-deployment --fleet-id "$fleet" --output json | jq -r '.FleetDeployment.DeploymentStatus')"
  echo "deployment status: $status" >&2
  case "$status" in COMPLETE|IMPAIRED|ROLLBACK_IN_PROGRESS|ROLLBACK_COMPLETE|ROLLBACK_IN_COMPLETE|CANCELLED) break ;; esac
  sleep 15
done
alarms=""
if [ "$status" = COMPLETE ]; then
  g0=$SECONDS
  while [ $((SECONDS - g0)) -lt "$gate_wait" ]; do
    alarms="$(aws --profile "$AWS_PROFILE" --region "$region" cloudwatch describe-alarms --state-value ALARM --alarm-name-prefix "rougehalla-infra-$exp" --output json | jq -r '.MetricAlarms[]?.AlarmName')"
    [ -n "$alarms" ] && break
    sleep 15
  done
fi
if [ "$status" = COMPLETE ] && [ -z "$alarms" ]; then echo "PASS: $tag is live on $fleet; rollback target kept: $prev" >&2; exit 0; fi
echo "GATE FAILED (deployment=$status alarms=${alarms:-none}); pointing the fleet back at $prev" >&2
case "$status" in ROLLBACK_IN_PROGRESS|ROLLBACK_COMPLETE|ROLLBACK_IN_COMPLETE) echo "GameLift already rolled back" >&2 ;; *) point "$prev" ;; esac
exit 1
