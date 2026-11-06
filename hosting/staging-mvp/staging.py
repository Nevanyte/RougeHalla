#!/usr/bin/env python3
"""One disposable Calgary host. Separate local plan, cloud preparation, execution and cleanup."""
import argparse
import datetime as dt
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import secrets
import subprocess
import sys
import tarfile
import time

HERE = Path(__file__).resolve().parent
REGION = "ca-west-1"
ACCOUNT = "048226733033"
AMI_PARAMETER = "/aws/service/canonical/ubuntu/server/24.04/stable/current/arm64/hvm/ebs-gp3/ami-id"
OWNER = "099720109477"
LIFETIME = 4 * 3600 + 30 * 60


def fail(message):
    raise RuntimeError(message)


def sha256(path):
    h = hashlib.sha256()
    with Path(path).open("rb") as handle:
        for part in iter(lambda: handle.read(1024 * 1024), b""):
            h.update(part)
    return h.hexdigest()


def private_json(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    with os.fdopen(os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600), "w") as handle:
        json.dump(data, handle, indent=2)
        handle.write("\n")
    path.chmod(0o600)


class Aws:
    def __init__(self, binary, profile):
        self.binary, self.profile = binary, profile

    def call(self, service, operation, *args, text=False, missing=False, untagged=False):
        command = [self.binary, service, operation, *map(str, args), "--profile", self.profile,
                   "--region", REGION, "--no-cli-pager", "--output", "text" if text else "json",
                   "--cli-connect-timeout", "10", "--cli-read-timeout", "30"]
        result = subprocess.run(command, capture_output=True, text=True)
        if result.returncode:
            if untagged and "NoSuchTagSet" in result.stderr:
                return {"TagSet": []}
            if missing and any(x in result.stderr for x in ("does not exist", "NoSuchBucket", "NotFound")):
                return None
            # AWS errors may contain request details. Preserve them privately; never print presigned inputs.
            fail(service + ":" + operation + " failed: " + re.sub(r"https://\S+", "[redacted URL]", result.stderr.strip()))
        if text:
            return result.stdout.strip()
        return json.loads(result.stdout) if result.stdout.strip() else {}

    def identity(self):
        identity = self.call("sts", "get-caller-identity")
        if identity.get("Account") != ACCOUNT:
            fail("wrong AWS account; refusing all operations")
        return identity


def render():
    template = json.loads((HERE / "stack.base.json").read_text())
    template["Resources"]["Host"]["Properties"]["UserData"] = {
        "Fn::Base64": {"Fn::Sub": (HERE / "bootstrap.sh.in").read_text()}}
    return template


def validate_bundle(path):
    required = {"bin/rh-server", "bin/caddy", "web/index.html"}
    with tarfile.open(path, "r:gz") as archive:
        found = set()
        size = 0
        for item in archive:
            name = PurePosixPath(item.name)
            if name.is_absolute() or ".." in name.parts or not (item.isfile() or item.isdir()):
                fail("bundle contains an unsafe path, link or special file")
            size += item.size
            found.add(str(name))
            if str(name) in {"bin/rh-server", "bin/caddy"} and not item.mode & 0o111:
                fail("bundle binary is not executable")
        if not required <= found or size > 1024 * 1024 * 1024:
            fail("bundle is incomplete or larger than the disposable host allowance")


def load_state(directory):
    state = json.loads((directory / "ownership.json").read_text())
    run = state.get("run_id", "")
    if not re.fullmatch(r"[0-9]{8}t[0-9]{6}z-[a-f0-9]{6}", run):
        fail("invalid ownership run ID")
    expected = {"account": ACCOUNT, "region": REGION, "stack": "rougehalla-mvp-" + run,
                "bucket": "rougehalla-mvp-" + ACCOUNT + "-" + run, "key": "release.tar.gz"}
    if any(state.get(k) != v for k, v in expected.items()):
        fail("ownership manifest does not match this dedicated account/run")
    return state


def verify_stack(aws, state, missing=False):
    # Exclude Parameters: even NoEcho capabilities do not belong in status/review output.
    result = aws.call("cloudformation", "describe-stacks", "--stack-name", state["stack"], "--query",
                      "{Stacks:Stacks[].{StackName:StackName,StackId:StackId,StackStatus:StackStatus,Tags:Tags,Outputs:Outputs}}",
                      missing=missing)
    if result is None:
        return None
    stacks = result.get("Stacks", [])
    if len(stacks) != 1:
        fail("expected exactly one owned stack")
    stack = stacks[0]
    expected_arn = "arn:aws:cloudformation:" + REGION + ":" + ACCOUNT + ":stack/" + state["stack"] + "/"
    if stack.get("StackName") != state["stack"] or not stack.get("StackId", "").startswith(expected_arn):
        fail("stack name/account/region identity mismatch")
    if stack.get("StackStatus") == "REVIEW_IN_PROGRESS":
        # New CREATE stacks expose no stack tags until execution. The pending change set owns those tags.
        change = aws.call("cloudformation", "describe-change-set", "--stack-name", state["stack"],
                          "--change-set-name", state.get("change_set", "first-playable"), "--query",
                          "{StackName:StackName,StackId:StackId,Tags:Tags}")
        tags = {x["Key"]: x["Value"] for x in change.get("Tags", [])}
        if (state.get("change_set_type") != "CREATE" or change.get("StackId") != stack["StackId"]
                or change.get("StackName") != state["stack"] or tags.get("RoguehallaRun") != state["run_id"]
                or tags.get("Purpose") != "DisposableFirstPlayable"):
            fail("review change set ownership mismatch")
    elif {x["Key"]: x["Value"] for x in stack.get("Tags", [])}.get("RoguehallaRun") != state["run_id"]:
        fail("stack ownership tag mismatch")
    return stack


def prepare(aws, args):
    if not args.apply:
        fail("prepare writes private S3 objects and creates a non-executed change set; pass --apply only after review")
    if not args.bundle or not args.source_manifest:
        fail("prepare requires --bundle and --source-manifest")
    if args.state_dir.exists():
        fail("state directory already exists; never overwrite a run’s cleanup manifest")
    validate_bundle(args.bundle)
    now = dt.datetime.now(dt.timezone.utc)
    run = now.strftime("%Y%m%dt%H%M%Sz") + "-" + secrets.token_hex(3)
    state = {"run_id": run, "account": ACCOUNT, "region": REGION, "stack": "rougehalla-mvp-" + run,
             "bucket": "rougehalla-mvp-" + ACCOUNT + "-" + run, "key": "release.tar.gz",
             "created_at": now.isoformat(), "deadline_unix": int(now.timestamp()) + LIFETIME,
             "change_set_type": "CREATE",
             "bundle_sha256": sha256(args.bundle), "source_manifest_sha256": sha256(args.source_manifest)}
    ami = aws.call("ssm", "get-parameter", "--name", AMI_PARAMETER)["Parameter"]["Value"]
    images = aws.call("ec2", "describe-images", "--image-ids", ami, "--owners", OWNER).get("Images", [])
    if len(images) != 1 or images[0].get("Architecture") != "arm64" or images[0].get("State") != "available" or images[0].get("ProductCodes"):
        fail("AMI is not an available official non-Marketplace arm64 Ubuntu image")
    state["ami"] = ami
    args.state_dir.mkdir(mode=0o700, parents=True)
    args.state_dir.chmod(0o700)
    private_json(args.state_dir / "ownership.json", state)  # Written before the first mutation for partial-failure cleanup.
    private_json(args.state_dir / "template.json", render())
    aws.call("cloudformation", "validate-template", "--template-body", "file://" + str(args.state_dir / "template.json"))
    aws.call("s3api", "create-bucket", "--bucket", state["bucket"], "--create-bucket-configuration", "LocationConstraint=" + REGION)
    state["bucket_created"] = True
    private_json(args.state_dir / "ownership.json", state)
    tags = {"TagSet": [{"Key": "RoguehallaRun", "Value": run}, {"Key": "Purpose", "Value": "DisposableFirstPlayable"}]}
    aws.call("s3api", "put-bucket-tagging", "--bucket", state["bucket"], "--tagging", json.dumps(tags))
    aws.call("s3api", "put-public-access-block", "--bucket", state["bucket"], "--public-access-block-configuration",
             "BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true")
    aws.call("s3api", "put-bucket-encryption", "--bucket", state["bucket"], "--server-side-encryption-configuration",
             json.dumps({"Rules": [{"ApplyServerSideEncryptionByDefault": {"SSEAlgorithm": "AES256"}}]}))
    aws.call("s3api", "put-bucket-lifecycle-configuration", "--bucket", state["bucket"], "--lifecycle-configuration",
             json.dumps({"Rules": [{"ID": "ExpireDisposableRelease", "Status": "Enabled", "Filter": {"Prefix": ""}, "Expiration": {"Days": 1}, "AbortIncompleteMultipartUpload": {"DaysAfterInitiation": 1}}]}))
    aws.call("s3api", "put-object", "--bucket", state["bucket"], "--key", state["key"], "--body", str(args.bundle),
             "--server-side-encryption", "AES256", "--metadata", "sha256=" + state["bundle_sha256"])
    url = aws.call("s3", "presign", "s3://" + state["bucket"] + "/" + state["key"], "--expires-in", "3600", text=True)
    params = [{"ParameterKey": k, "ParameterValue": v} for k, v in {
        "AmiId": ami, "BundleUrl": url, "BundleSha256": state["bundle_sha256"],
        "DeadlineUnix": str(state["deadline_unix"]), "RunId": run}.items()]
    private_json(args.state_dir / "parameters.private.json", params)
    response = aws.call("cloudformation", "create-change-set", "--stack-name", state["stack"], "--change-set-name", "first-playable",
                        "--change-set-type", "CREATE", "--template-body", "file://" + str(args.state_dir / "template.json"),
                        "--parameters", "file://" + str(args.state_dir / "parameters.private.json"),
                        "--tags", "Key=RoguehallaRun,Value=" + run, "Key=Purpose,Value=DisposableFirstPlayable")
    state["change_set"] = response["Id"]
    private_json(args.state_dir / "ownership.json", state)
    print(json.dumps({"prepared": True, "executed": False, "stack": state["stack"], "deadline_unix": state["deadline_unix"],
                      "bundle_sha256": state["bundle_sha256"], "state_dir": str(args.state_dir)}, indent=2))


def execute(aws, args, state):
    if not args.apply:
        fail("execute provisions the host; --apply required after reviewing the exact change set")
    if int(state["deadline_unix"]) - time.time() < 900:
        fail("fixed deadline too close; clean up this run and prepare a fresh reviewed one")
    if time.time() - dt.datetime.fromisoformat(state["created_at"]).timestamp() > 1800:
        fail("bundle capability is too old; clean up and prepare fresh parameters before launch")
    stack = verify_stack(aws, state)
    if stack["StackStatus"] != "REVIEW_IN_PROGRESS":
        fail("only a new reviewed stack can execute; updates/replacements are unsupported")
    change = aws.call("cloudformation", "describe-change-set", "--change-set-name", state["change_set"], "--query",
                      "{StackId:StackId,Status:Status,ExecutionStatus:ExecutionStatus,Changes:Changes}")
    if change.get("Status") != "CREATE_COMPLETE" or change.get("ExecutionStatus") != "AVAILABLE" or state.get("change_set_type") != "CREATE":
        fail("change set is not an available CREATE; inspect its status and validation events")
    changes = change.get("Changes", [])
    if change.get("StackId") != stack["StackId"] or not changes or any(c.get("ResourceChange", {}).get("Action") != "Add" for c in changes):
        fail("new disposable stack unexpectedly modifies existing resources")
    events = aws.call("cloudformation", "describe-events", "--change-set-name", state["change_set"])
    private_json(args.state_dir / "pre-deploy-events.json", events)
    failures = [e for e in events.get("OperationEvents", [])
                if e.get("ValidationStatus") == "FAILED" or e.get("EventType") in
                {"VALIDATION_ERROR", "PROVISIONING_ERROR", "HOOK_INVOCATION_ERROR"}]
    if failures:
        fail("pre-deployment validation findings require review; see private pre-deploy-events.json")
    aws.call("cloudformation", "execute-change-set", "--change-set-name", state["change_set"])
    print("Creation started; inspect status, then set practice-only DNS and verify real trusted HTTPS/WSS. Cleanup remains required.")


def cleanup(aws, args, state):
    if not args.apply:
        fail("cleanup deletes only this disposable run’s stack and artifact object/bucket; --apply required")
    stack = verify_stack(aws, state, missing=True)
    if stack:
        aws.call("cloudformation", "delete-stack", "--stack-name", state["stack"])
        # Wait is a separate CLI process; its time does not consume interactive tool polling.
        aws.call("cloudformation", "wait", "stack-delete-complete", "--stack-name", state["stack"])
    bucket = aws.call("s3api", "get-bucket-tagging", "--bucket", state["bucket"], "--expected-bucket-owner", ACCOUNT, missing=True, untagged=True)
    if bucket is not None:
        tags = {x["Key"]: x["Value"] for x in bucket.get("TagSet", [])}
        if tags.get("RoguehallaRun") != state["run_id"] and not (not tags and state.get("bucket_created") is True):
            fail("bucket ownership tag mismatch; refusing object deletion")
        objects = aws.call("s3api", "list-objects-v2", "--bucket", state["bucket"])
        keys = [x["Key"] for x in objects.get("Contents", [])]
        if any(k != state["key"] for k in keys):
            fail("unexpected bucket objects; refusing recursive deletion")
        if keys:
            aws.call("s3api", "delete-object", "--bucket", state["bucket"], "--key", state["key"])
        aws.call("s3api", "delete-bucket", "--bucket", state["bucket"])
    (args.state_dir / "parameters.private.json").unlink(missing_ok=True)
    state["cleaned_at"] = dt.datetime.now(dt.timezone.utc).isoformat()
    private_json(args.state_dir / "ownership.json", state)
    print("Disposable stack and artifact bucket deleted. Remove only this run’s marked practice DNS record separately; verify EC2 volume/IP cleanup.")


def main():
    os.umask(0o077)
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=["render", "prepare", "execute", "status", "cleanup"])
    parser.add_argument("--state-dir", type=Path, required=True)
    parser.add_argument("--aws", default=os.environ.get("RH_AWS", "aws"))
    parser.add_argument("--profile", default="rougehalla-staging")
    parser.add_argument("--bundle", type=Path)
    parser.add_argument("--source-manifest", type=Path)
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    args.state_dir = args.state_dir.resolve()
    if args.action == "render":
        private_json(args.state_dir / "template.json", render())
        print(args.state_dir / "template.json")
        return
    aws = Aws(args.aws, args.profile)
    aws.identity()
    if args.action == "prepare":
        prepare(aws, args)
        return
    state = load_state(args.state_dir)
    if args.action == "execute":
        execute(aws, args, state)
    elif args.action == "cleanup":
        cleanup(aws, args, state)
    else:
        stack = verify_stack(aws, state, missing=True)
        print(json.dumps({"stack": state["stack"], "status": stack["StackStatus"] if stack else "ABSENT",
                          "deadline_unix": state["deadline_unix"], "outputs": stack.get("Outputs", []) if stack else []}, indent=2))


if __name__ == "__main__":
    try:
        main()
    except (RuntimeError, OSError, ValueError, tarfile.TarError) as error:
        print("staging: " + str(error), file=sys.stderr)
        sys.exit(1)
