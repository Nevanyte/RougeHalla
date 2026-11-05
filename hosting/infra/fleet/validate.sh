#!/usr/bin/env bash
# Validates the prepared infrastructure with NO AWS access, in pinned Docker images (python:3.12.8-slim; cfn-lint 1.59.0,
# parliament 1.6.4 + setuptools 75.8.0 for the IAM JSON). `aws cloudformation validate-template` needs credentials and is deliberately not used.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
docker run --rm -v "$here":/work:ro -w /work python:3.12.8-slim sh -ec '
  pip install --quiet --disable-pip-version-check cfn-lint==1.59.0 parliament==1.6.4 setuptools==75.8.0 >/dev/null 2>&1
  cfn-lint --version
  cfn-lint --regions us-west-2 --include-checks W -- fleet.cfn.yaml
  ca_status=0
  cfn-lint --format json --regions ca-central-1 --include-checks W -- fleet.cfn.yaml > /tmp/ca-findings.json || ca_status=$?
  python check-regional-lint.py /tmp/ca-findings.json "$ca_status"
  cfn-lint --regions us-east-1 --include-checks W -- budget.cfn.yaml
  echo "cfn-lint: both templates clean"
  for f in iam/*.json; do
    python -c "import json,sys; json.load(open(sys.argv[1]))" "$f"
    python -c "from parliament import analyze_policy_string; import sys; p=analyze_policy_string(open(sys.argv[1]).read()); [print(f) for f in p.findings]; sys.exit(bool(p.findings))" "$f"
    echo "parliament ok: $f"
  done
'
