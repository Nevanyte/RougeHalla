# Sourced by teardown.sh, verify-no-billable.sh and rollout.sh. Not executable on its own.
#
# The rules every AWS-touching script here obeys (docs/hosting/RUNBOOKS.md section 7):
#   * `--dry-run` prints every AWS CLI call it WOULD make and makes none (it does not even need `aws` or a profile).
#   * A real run needs BOTH `--yes` and an explicit AWS_PROFILE; with neither it exits 2 before any call.
#   * Static credentials in the environment are refused (a named profile only), the profile is passed on every call
#     (`aws --profile ...`), and the first real call is `sts get-caller-identity`: the account must equal RH_EXPECT_ACCOUNT
#     (pinned to 961470857356, the sandbox account named in docs/backlog/packets/P-CLAUDE-INFRA-1.md), otherwise exit 2.
#   * Never touches production: names are prefixed rougehalla-infra and every call is scoped by --region.
RH_DRY=0
RH_YES=0
RH_EXPECT_ACCOUNT="961470857356"
export AWS_PAGER=""

rh_die() { printf 'error: %s\n' "$*" >&2; exit 2; }

# rh_flag <flag>: consumes the shared flags; returns 0 when it handled the flag.
rh_flag() {
  case "$1" in
    --dry-run) RH_DRY=1; return 0 ;;
    --yes) RH_YES=1; return 0 ;;
  esac
  return 1
}

# rh_ready: call after parsing. In a real run enforces --yes, AWS_PROFILE, no static keys, the account check.
rh_ready() {
  if [ "$RH_DRY" = 1 ]; then
    [ "$RH_YES" = 1 ] && rh_die "--dry-run and --yes together: choose one"
    return 0
  fi
  [ "$RH_YES" = 1 ] || rh_die "refusing to run without --yes (use --dry-run to see the AWS calls)"
  [ -n "${AWS_PROFILE:-}" ] || rh_die "refusing to run without an explicit AWS_PROFILE"
  [ -z "${AWS_ACCESS_KEY_ID:-}${AWS_SECRET_ACCESS_KEY:-}${AWS_SESSION_TOKEN:-}" ] || rh_die "static credentials in the environment are not accepted; use a named profile"
  command -v aws >/dev/null 2>&1 || rh_die "aws CLI not found"
  command -v jq >/dev/null 2>&1 || rh_die "jq not found"
  local acct
  acct="$(aws --profile "$AWS_PROFILE" sts get-caller-identity --query Account --output text)" || rh_die "sts get-caller-identity failed"
  [ "$acct" = "$RH_EXPECT_ACCOUNT" ] || rh_die "profile $AWS_PROFILE is account $acct, expected $RH_EXPECT_ACCOUNT (RH_EXPECT_ACCOUNT); nothing was changed"
  printf 'account %s via profile %s\n' "$acct" "$AWS_PROFILE" >&2
}

# aws_ <args...>: a call that mutates or reads; printed with a leading "+", executed only in a real run.
aws_() {
  printf '+ aws --profile %s %s\n' "${AWS_PROFILE:-<AWS_PROFILE>}" "$*" >&2
  [ "$RH_DRY" = 1 ] && return 0
  aws --profile "$AWS_PROFILE" "$@"
}

# aws_out <args...>: a read whose output is used. Dry run prints the call and yields nothing (the loop that consumes it is
# printed by plan_each instead).
aws_out() {
  printf '+ aws --profile %s %s\n' "${AWS_PROFILE:-<AWS_PROFILE>}" "$*" >&2
  [ "$RH_DRY" = 1 ] && return 0
  aws --profile "$AWS_PROFILE" "$@"
}

# plan_each <label> -- <list call...>: not used directly; scripts print "for each <label>:" lines through rh_note in dry-run.
rh_note() { [ "$RH_DRY" = 1 ] && printf '  # %s\n' "$*" >&2; return 0; }

# Fleet ids are opaque: names/description substrings do not establish ownership.
# The exact Project + Experiment tag pair is required before any mutation.
rh_fleet_owned() {
  local region="$1" fleet="$2" experiment="$3" arn tags
  arn="$(aws_out --region "$region" gamelift describe-container-fleet --fleet-id "$fleet" --output json | jq -er '.ContainerFleet.FleetArn')" || return 2
  case "$arn" in "arn:aws:gamelift:$region:$RH_EXPECT_ACCOUNT:containerfleet/"*) ;; *) return 1 ;; esac
  tags="$(aws_out --region "$region" gamelift list-tags-for-resource --resource-arn "$arn" --output json)" || return 2
  printf '%s' "$tags" | jq -e 'type=="object" and (.Tags|type=="array")' >/dev/null || return 2
  printf '%s' "$tags" | jq -e --arg exp "$experiment" '[.Tags[]? | select(.Key=="Project" and .Value=="rougehalla-infra")]|length==1' >/dev/null || return 1
  printf '%s' "$tags" | jq -e --arg exp "$experiment" '[.Tags[]? | select(.Key=="Experiment" and .Value==$exp)]|length==1' >/dev/null
}
