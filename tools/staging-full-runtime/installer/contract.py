#!/usr/bin/env python3
"""Offline candidate only. No SDK, network, subprocess, deployment, host installation or secret handling."""
import argparse
import datetime as dt
import json
from pathlib import Path
import re
import uuid

ACCOUNT = '048226733033'
REGION = 'ca-west-1'
BASE = '7a13b88aaa104cf2fd18dc2de7eada6c02060485'
PRIMARY_REVIEW = '3c577a97c2f170913a1a6418fa7e7d4efeb1fdec'
UTC = dt.timezone.utc
MAX_OBJECT = 1024 * 1024 * 1024  # Software ceiling, not measured disk/capacity or a paid allocation.


class Refused(ValueError):
    pass


def require(ok, reason):
    if not ok:
        raise Refused(reason)


def strict_json(text):
    def pairs(rows):
        result = {}
        for key, value in rows:
            require(key not in result, 'duplicate JSON field')
            result[key] = value
        return result
    return json.loads(text, object_pairs_hook=pairs)


def shape(value, keys):
    require(type(value) is dict and set(value) == set(keys.split()), 'unexpected/missing plan fields')


def stamp(text):
    require(type(text) is str and re.fullmatch(r'\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z', text), 'canonical absolute UTC time required')
    try:
        return dt.datetime.strptime(text, '%Y-%m-%dT%H:%M:%SZ').replace(tzinfo=UTC)
    except ValueError:
        raise Refused('invalid UTC time') from None


def digest(value):
    require(type(value) is str and re.fullmatch('[0-9a-f]{64}', value), 'SHA256 pin required')


def validate(plan, now):
    shape(plan, 'format account region domain run_id prepared_at host_expires_at mode previous_run_id volume artifact backup toolchain_receipt_sha256 boundary_receipt_sha256 backup_seconds')
    require(plan['format'] == 'rh-staging-installer-candidate/1', 'candidate plan version')
    require((plan['account'], plan['region'], plan['domain']) == (ACCOUNT, REGION, 'rougehalla.com'), 'practice account/region/domain only')
    run = plan['run_id']
    require(type(run) is str and re.fullmatch('[0-9]{8}t[0-9]{6}z-[0-9a-f]{6}', run), 'run ownership identifier')
    start, end = stamp(plan['prepared_at']), stamp(plan['host_expires_at'])
    require(start <= now < end and dt.timedelta(seconds=181) < end-start <= dt.timedelta(hours=4.5), 'fixed bounded host deadline')
    require(type(plan['backup_seconds']) is int and plan['backup_seconds'] > 0 and
            plan['backup_seconds']+180 < (end-now).total_seconds(), 'backup/drain must fit unchanged expiry')
    require(plan['mode'] in ('fresh', 'restore'), 'explicit fresh/restore mode')
    previous = plan['previous_run_id']
    require(previous is None if plan['mode'] == 'fresh' else
            type(previous) is str and previous != run and re.fullmatch('[0-9]{8}t[0-9]{6}z-[0-9a-f]{6}', previous), 'restore ownership continuation required')
    for name in ('toolchain_receipt_sha256', 'boundary_receipt_sha256'):
        digest(plan[name])  # References only, never treated as attestation or deployment approval.
    volume = plan['volume']
    shape(volume, 'id uuid filesystem mountpoint')
    require(type(volume['id']) is str and re.fullmatch('vol-[0-9a-f]{17}', volume['id']), 'exact known EBS ID required')
    require(type(volume['uuid']) is str, 'known filesystem UUID required; blank disks refused')
    try:
        require(str(uuid.UUID(volume['uuid'])) == volume['uuid'], 'canonical filesystem UUID')
    except ValueError:
        raise Refused('canonical filesystem UUID required; never format unknown media') from None
    require(volume['filesystem'] == 'ext4' and volume['mountpoint'] == '/srv/rougehalla-data', 'explicit retained filesystem/mount binding')
    for name in ('artifact', 'backup'):
        item = plan[name]
        shape(item, 'bucket key version_id bytes sha256' if name == 'artifact' else 'bucket key max_bytes')
        bucket = item['bucket']
        require(type(bucket) is str and re.fullmatch('[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]', bucket) and '..' not in bucket,
                'concrete bucket name required')
        require(item['key'] == 'runs/'+run+('/public-bundle.tar' if name == 'artifact' else '/cold-backup.age'), 'exact run-bound immutable key required')
    artifact = plan['artifact']
    require(type(artifact['version_id']) is str and re.fullmatch('[A-Za-z0-9_+.~/=][A-Za-z0-9_+.~/=-]{0,255}', artifact['version_id']) and artifact['version_id'] != 'null', 'pinned nonnull object version required')
    require(type(artifact['bytes']) is int and 0 < artifact['bytes'] <= MAX_OBJECT, 'bounded artifact bytes required')
    digest(artifact['sha256'])
    require(type(plan['backup']['max_bytes']) is int and 0 < plan['backup']['max_bytes'] <= MAX_OBJECT, 'bounded single-PUT ciphertext required')
    return plan


def role_template(plan):
    """Private design fragment. Deliberately no Host/userdata/SG/DNS resource and no operational attachment."""
    artifact, backup = plan['artifact'], plan['backup']
    guard = {'Bool': {'aws:SecureTransport': 'true'}, 'DateLessThan': {'aws:CurrentTime': plan['host_expires_at']},
             'StringEquals': {'s3:ResourceAccount': ACCOUNT}}
    get = json.loads(json.dumps(guard))
    get['StringEquals']['s3:VersionId'] = artifact['version_id']
    put = json.loads(json.dumps(guard))
    put['StringEquals'].update({'s3:x-amz-server-side-encryption': 'AES256', 's3:if-none-match': '*'})
    policy = {'Version': '2012-10-17', 'Statement': [
        {'Sid': 'OnlyPinnedArtifactVersionBeforeExpiry', 'Effect': 'Allow', 'Action': 's3:GetObjectVersion',
         'Resource': 'arn:aws:s3:::'+artifact['bucket']+'/'+artifact['key'], 'Condition': get},
        {'Sid': 'OnlyCreateRunCiphertextBeforeExpiry', 'Effect': 'Allow', 'Action': 's3:PutObject',
         'Resource': 'arn:aws:s3:::'+backup['bucket']+'/'+backup['key'], 'Condition': put}]}
    tags = [{'Key': 'RoguehallaRun', 'Value': plan['run_id']}, {'Key': 'Purpose', 'Value': 'InstallerOfflineCandidate'}]
    return {'AWSTemplateFormatVersion': '2010-09-09', 'Description': 'OFFLINE PRIVATE DESIGN: exact-object role only; NOT an installer/host deployment release',
        'Metadata': {'Deployable': False, 'ActualHostRun': False, 'Base': BASE, 'PrimaryReview': PRIMARY_REVIEW,
                     'RequiredSemanticReview': ['EC2 assume-role supported context keys', 'S3 conditional PutObject key and CLI version', 'actual bucket owner/version/encryption/cost']},
        'Rules': {'CorrectScope': {'Assertions': [
            {'Assert': {'Fn::Equals': [{'Ref': 'AWS::AccountId'}, ACCOUNT]}, 'AssertDescription': 'Dedicated account only'},
            {'Assert': {'Fn::Equals': [{'Ref': 'AWS::Region'}, REGION]}, 'AssertDescription': 'Calgary only'}]}},
        'Resources': {
            'RunTransferRole': {'Type': 'AWS::IAM::Role', 'Properties': {
                'AssumeRolePolicyDocument': {'Version': '2012-10-17', 'Statement': [
                    {'Effect': 'Allow', 'Principal': {'Service': 'ec2.amazonaws.com'}, 'Action': 'sts:AssumeRole'}]},
                'Policies': [{'PolicyName': 'ExactRunObjects', 'PolicyDocument': policy}], 'Tags': tags}},
            'RunTransferProfile': {'Type': 'AWS::IAM::InstanceProfile', 'Properties': {'Roles': [{'Ref': 'RunTransferRole'}]}}},
        'Outputs': {'ProfileName': {'Value': {'Ref': 'RunTransferProfile'}, 'Description': 'Unattached private design; Root must review exact host binding/PassRole'}}}


def expiry_units(plan):
    deadline = stamp(plan['host_expires_at']).strftime('%Y-%m-%d %H:%M:%S UTC')
    return {
        'rougehalla-absolute-expiry.timer': '[Unit]\nDescription=Fixed run expiry '+plan['run_id']+'\n[Timer]\nOnCalendar='+deadline+
            '\nPersistent=true\nAccuracySec=1s\nRandomizedDelaySec=0\nUnit=rougehalla-absolute-expiry.service\n[Install]\nWantedBy=timers.target\n',
        'rougehalla-absolute-expiry.service': '[Unit]\nDescription=Terminate only this host at its immutable deadline\n[Service]\nType=oneshot\nExecStart=/usr/bin/systemctl poweroff\n',
        'deadline.json': json.dumps({'format': 'rh-fixed-host-deadline/1', 'run_id': plan['run_id'], 'expires_at': plan['host_expires_at']}, sort_keys=True)+'\n'}


def render(plan, destination):
    from host_material import material
    destination.mkdir(parents=True, exist_ok=False)
    (destination/'role.review-only.json').write_text(json.dumps(role_template(plan), indent=2)+'\n')
    for name, body in expiry_units(plan).items():
        (destination/name).write_text(body)
    for name, body in material(plan).items():
        (destination/name).write_text(body)
    (destination/'ACTIVATION-HOLD.json').write_text(json.dumps({'deployable': False, 'host_installed': False,
        'stage': 'offline-design-only', 'run_id': plan['run_id'],
        'blocked': ['Root cloud/IAM/cost/identity review', 'trusted expiry-first bootstrap/host executor', 'exact volume + OS/tool pins',
                    'private PostgreSQL/secret provisioning execution', 'egress enforcement and gated real-service probes',
                    'offhost ciphertext verification and independent restore/cleanup']}, indent=2)+'\n')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=['validate', 'render-review'])
    parser.add_argument('--plan', required=True, type=Path)
    parser.add_argument('--out', type=Path)
    args = parser.parse_args()
    try:
        require(args.plan.stat().st_size <= 65536, 'bounded nonsecret plan required')
        plan = validate(strict_json(args.plan.read_text()), dt.datetime.now(UTC))
        if args.command == 'render-review':
            require(args.out is not None, 'NEW review directory required')
            render(plan, args.out)
        print(json.dumps({'deployable': False, 'actual_host_run': False, 'run_id': plan['run_id']}))
    except (Refused, ValueError, OSError, TypeError):
        print('installer candidate refused; no deployment or host action', file=__import__('sys').stderr)
        raise SystemExit(2) from None


if __name__ == '__main__':
    main()
