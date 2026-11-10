#!/usr/bin/env python3
"""Offline review renderer. No AWS client, subprocess, login, upload or deployment command."""
import argparse
import datetime as dt
from decimal import Decimal, InvalidOperation
import hashlib
import json
from pathlib import Path, PurePosixPath
import re

HERE = Path(__file__).resolve().parent
# Explicitly reviewed native candidate; advancing this also invalidates older artifact receipts.
BASE = '3253da04905dd80c545dba824ab1b502a1dc15f7'
ACCOUNT = '048226733033'
REGION = 'ca-west-1'
UTC = dt.timezone.utc


class Refused(ValueError):
    pass


def require(ok, message):
    if not ok:
        raise Refused(message)


def stamp(value):
    try:
        t = dt.datetime.fromisoformat(value.replace('Z', '+00:00'))
        require(t.tzinfo is not None and t.utcoffset() == dt.timedelta(), 'timestamps must be UTC')
        return t
    except (ValueError, TypeError, AttributeError):
        raise Refused('missing or malformed UTC timestamp') from None


def money(value):
    try:
        require(isinstance(value, str), 'monetary values must be decimal strings')
        d = Decimal(value)
        require(d.is_finite() and d >= 0, 'nonfinite or negative cost')
        return d
    except InvalidOperation:
        raise Refused('invalid decimal cost') from None


def fresh(value, now, age):
    return dt.timedelta() <= now - stamp(value) <= dt.timedelta(seconds=age)


def verified_artifact(value, root):
    """Public artifacts only; error text never echoes file contents or arbitrary input."""
    require(isinstance(value, dict) and set(value) == {'path', 'sha256'}, 'artifact descriptor shape')
    p = PurePosixPath(value['path'])
    require(not p.is_absolute() and p.parts and '..' not in p.parts, 'unsafe artifact path')
    root = root.resolve(strict=True)
    candidate = root / str(p)
    require(not any(x.is_symlink() for x in [candidate, *list(candidate.parents)[:len(p.parts) - 1]]), 'artifact symlink refused')
    require(candidate.is_file(), 'required public artifact missing')
    digest = hashlib.sha256()
    with candidate.open('rb') as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b''):
            digest.update(chunk)
    digest = digest.hexdigest()
    require(re.fullmatch('[0-9a-f]{64}', value['sha256']) and digest == value['sha256'], 'artifact SHA mismatch')
    return candidate


def validate(plan, root, now):
    require(plan.get('format') == 'rh-calgary-preparation/1', 'plan format')
    require(plan.get('account') == ACCOUNT and plan.get('region') == REGION, 'wrong account or region')
    require(plan.get('domain') == 'rougehalla.com', 'practice domain only')
    require(plan.get('source_commit') == BASE, 'native source is not the frozen base')
    require(re.fullmatch(r'[0-9]{8}t[0-9]{6}z-[0-9a-f]{6}', plan.get('run_id', '')), 'run ownership marker')
    identity = plan.get('identity', {})
    require(identity.get('account') == ACCOUNT and identity.get('region') == REGION
            and fresh(identity.get('checked_at'), now, 3600), 'fresh correct-account/region identity required')
    inventory = plan.get('resource_plan', {})
    require(inventory.get('account') == ACCOUNT and inventory.get('region') == REGION
            and fresh(inventory.get('checked_at'), now, 3600)
            and inventory.get('reviewed_empty_or_owned') is True
            and bool(inventory.get('receipt_sha256')) and bool(inventory.get('cleanup_owner'))
            and bool(inventory.get('cleanup_plan_sha256')), 'fresh scoped resource+owned cleanup plan required')
    budget = plan.get('budget', {})
    require(fresh(budget.get('checked_at'), now, 86400), 'fresh gross cost/FX/currency evidence required')
    require(budget.get('account') == ACCOUNT and budget.get('currency') == 'CAD'
            and budget.get('credits_expand_cap') is False
            and bool(budget.get('cost_receipt_sha256')) and bool(budget.get('fx_source')),
            'CAD gross-cost evidence required; credits cannot expand cap')
    gross_usd = money(budget.get('existing_gross_usd'))
    usd_reserve = money(budget.get('new_all_in_usd_reserve'))
    require(usd_reserve > 0, 'positive conservative all-in reserve required')
    fx = money(budget.get('cad_per_usd'))
    require(fx > 0 and fresh(budget.get('fx_checked_at'), now, 86400), 'verified current conversion required')
    total = (gross_usd + usd_reserve) * fx + money(budget.get('other_staging_gross_cad')) + money(budget.get('tax_and_lag_margin_cad'))
    require(money(budget.get('authorized_total_cad')) == Decimal('20') and total <= Decimal('20'), 'CAD20 TOTAL exceeded')
    require(set(budget.get('priced_components', [])) == {'compute', 'ipv4', 'root_ebs', 'data_ebs_retention',
            'egress', 'artifact_requests_storage', 'backup_requests_versions_storage', 'cleanup_margin'}, 'cost coverage incomplete')
    compute = plan.get('compute', {})
    require(re.fullmatch(r'ami-[0-9a-f]{8,17}', compute.get('ami_id', '')), 'verified AMI required')
    require(compute.get('architecture') == 'arm64' and compute.get('ami_owner') == '099720109477'
            and compute.get('cpu_credits') == 'standard', 'AMI architecture/owner or CPU credits not pinned')
    require(re.fullmatch(r'ca-west-1[a-z]', compute.get('availability_zone', '')), 'verified Calgary AZ required')
    require(re.fullmatch(r't4g\.[a-z0-9]+', compute.get('instance_type', '')), 'reviewed ARM T-class size required')
    require(compute.get('sizing_receipt_sha256') and compute.get('price_receipt_sha256')
            and fresh(compute.get('price_checked_at'), now, 86400)
            and fresh(compute.get('sizing_checked_at'), now, 86400), 'fresh size/price review required')
    for key in ('root_gib', 'data_gib'):
        require(type(compute.get(key)) is int and compute[key] > 0, 'explicit positive storage quantities required')
    start = stamp(plan.get('prepared_at'))
    deadline = stamp(plan.get('host_expires_at'))
    retention = stamp(plan.get('data_delete_by'))
    require(fresh(plan.get('prepared_at'), now, 1800) and now < deadline
            and dt.timedelta(seconds=181) < deadline - start <= dt.timedelta(hours=4.5), 'absolute bounded host deadline required')
    require(deadline < retention and retention - start <= dt.timedelta(days=7), 'finite data retention (max7d) required')
    require(type(plan.get('runtime_seconds')) is int and plan['runtime_seconds'] > 0
            and plan['runtime_seconds'] + 180 <= (deadline - now).total_seconds(), 'runtime+drain exceeds fixed host deadline')
    backup = plan.get('backup', {})
    require(backup.get('encryption') == 'age' and re.fullmatch(r'age1[0-9a-z]{58}', backup.get('public_recipient', '')),
            'offhost public encryption recipient required')
    require(backup.get('restore_receipt_sha256') and backup.get('transfer_plan_sha256')
            and backup.get('owner') and stamp(backup.get('delete_by')) <= retention
            and stamp(backup.get('delete_by')) > deadline, 'bounded offhost backup+restore+owner plan required')
    require(type(backup.get('lifecycle_days')) is int and 1 <= backup['lifecycle_days'] <= 6
            and retention >= deadline + dt.timedelta(days=backup['lifecycle_days'] + 1),
            'price current+noncurrent backup retention and explicit operator cleanup; lifecycle is not a hard stop')
    artifacts = plan.get('artifacts', {})
    require(set(artifacts) == {'server', 'caddy', 'source_map', 'web_manifest', 'native_validation'}, 'immutable artifact set required')
    paths = {k: verified_artifact(v, root) for k, v in artifacts.items()}
    for key in ('server', 'caddy'):
        with paths[key].open('rb') as f:
            elf = f.read(20)
        require(len(elf) == 20 and elf[:6] == b'\x7fELF\x02\x01' and elf[18:20] == b'\xb7\x00', 'artifact is not ARM64 ELF')
    native = json.loads(paths['native_validation'].read_text())
    require(native.get('source_commit') == BASE and native.get('postgres_feature') is True
            and native.get('server_sha256') == artifacts['server']['sha256']
            and native.get('source_map_sha256') == artifacts['source_map']['sha256']
            and native.get('source_map_validated_by_actual_binary') is True
            and native.get('training_one_human_no_fill_no_results') is True,
            'binary/map/runtime proof does not bind the frozen artifacts')
    exported = json.loads(paths['source_map'].read_text())
    require(exported.get('format') == 'rh-map/2' and 'coliseum' in exported.get('map', {}), 'complete source map export required')
    web = json.loads(paths['web_manifest'].read_text())
    require(web.get('source_commit') == BASE and web.get('default_ws_path') == '/ws'
            and web.get('training_ws_path') == '/training/ws' and web.get('account_origin') == 'https://rougehalla.com', 'Web runtime/account binding required')
    require(web.get('files') and len({x['path'] for x in web['files']}) == len(web['files']), 'empty/duplicate Web manifest')
    for value in web['files']:
        verified_artifact(value, root)
    return {'reviewed_total_reserve_cad': str(total), 'artifact_sha256': {k: v['sha256'] for k, v in artifacts.items()}}


def template():
    """Review-only schema, zero IAM. Host bootstrap intentionally refuses until a separately reviewed installer exists."""
    ref = lambda k: {'Ref': k}
    tags = [{'Key': 'RoguehallaRun', 'Value': ref('RunId')}, {'Key': 'Purpose', 'Value': 'DualRuntimePreparation'}]
    t = {'AWSTemplateFormatVersion': '2010-09-09', 'Description': 'PREPARATION ONLY: Calgary dual runtime; bootstrap is held; no deployment authorization',
         'Parameters': {
             'AmiId': {'Type': 'AWS::EC2::Image::Id'},
             'InstanceType': {'Type': 'String', 'AllowedPattern': 't4g\\.[a-z0-9]+'},
             'AvailabilityZone': {'Type': 'AWS::EC2::AvailabilityZone::Name'},
             'RootGiB': {'Type': 'Number', 'MinValue': 1}, 'DataGiB': {'Type': 'Number', 'MinValue': 1},
             'BackupRetentionDays': {'Type': 'Number', 'MinValue': 1, 'MaxValue': 7},
             'DataDeleteBy': {'Type': 'String', 'AllowedPattern': '[0-9TZ:+.\\-]+'},
             'RunId': {'Type': 'String', 'AllowedPattern': '[0-9]{8}t[0-9]{6}z-[0-9a-f]{6}'}},
         'Rules': {'CorrectScope': {'Assertions': [{'Assert': {'Fn::Equals': [ref('AWS::AccountId'), ACCOUNT]}, 'AssertDescription': 'Dedicated staging account only'},
                                                 {'Assert': {'Fn::Equals': [ref('AWS::Region'), REGION]}, 'AssertDescription': 'Calgary only'}]}}, 'Resources': {}, 'Outputs': {}}
    r = t['Resources']
    r['Vpc'] = {'Type': 'AWS::EC2::VPC', 'Properties': {'CidrBlock': '10.70.0.0/24', 'EnableDnsSupport': True, 'EnableDnsHostnames': True, 'Tags': tags}}
    r['Gateway'] = {'Type': 'AWS::EC2::InternetGateway', 'Properties': {'Tags': tags}}
    r['GatewayAttachment'] = {'Type': 'AWS::EC2::VPCGatewayAttachment', 'Properties': {'VpcId': ref('Vpc'), 'InternetGatewayId': ref('Gateway')}}
    r['Subnet'] = {'Type': 'AWS::EC2::Subnet', 'Properties': {'VpcId': ref('Vpc'), 'AvailabilityZone': ref('AvailabilityZone'), 'CidrBlock': '10.70.0.0/28', 'MapPublicIpOnLaunch': True, 'Tags': tags}}
    r['Routes'] = {'Type': 'AWS::EC2::RouteTable', 'Properties': {'VpcId': ref('Vpc'), 'Tags': tags}}
    r['InternetRoute'] = {'Type': 'AWS::EC2::Route', 'DependsOn': 'GatewayAttachment', 'Properties': {'RouteTableId': ref('Routes'), 'DestinationCidrBlock': '0.0.0.0/0', 'GatewayId': ref('Gateway')}}
    r['SubnetRoutes'] = {'Type': 'AWS::EC2::SubnetRouteTableAssociation', 'Properties': {'SubnetId': ref('Subnet'), 'RouteTableId': ref('Routes')}}
    r['WebSecurityGroup'] = {'Type': 'AWS::EC2::SecurityGroup', 'Properties': {'VpcId': ref('Vpc'), 'GroupDescription': 'Practice HTTPS and ACME only; no DB, SSH or game/control ports',
        'SecurityGroupIngress': [{'IpProtocol': 'tcp', 'FromPort': n, 'ToPort': n, 'CidrIp': '0.0.0.0/0'} for n in (80, 443)],
        'SecurityGroupEgress': [{'IpProtocol': 'tcp', 'FromPort': n, 'ToPort': n, 'CidrIp': '0.0.0.0/0'} for n in (80, 443)], 'Tags': tags}}
    r['Host'] = {'Type': 'AWS::EC2::Instance', 'DependsOn': ['InternetRoute', 'SubnetRoutes'], 'Properties': {
        'ImageId': ref('AmiId'), 'InstanceType': ref('InstanceType'), 'AvailabilityZone': ref('AvailabilityZone'), 'SubnetId': ref('Subnet'),
        'SecurityGroupIds': [ref('WebSecurityGroup')], 'CreditSpecification': {'CPUCredits': 'standard'}, 'Monitoring': False,
        'MetadataOptions': {'HttpEndpoint': 'enabled', 'HttpTokens': 'required', 'HttpPutResponseHopLimit': 1},
        'InstanceInitiatedShutdownBehavior': 'terminate', 'Tags': tags,
        'BlockDeviceMappings': [{'DeviceName': '/dev/sda1', 'Ebs': {'VolumeType': 'gp3', 'VolumeSize': ref('RootGiB'), 'Encrypted': True, 'DeleteOnTermination': True}}],
        'UserData': {'Fn::Base64': '#!/bin/bash\n# Review-only refusal, NOT a full-runtime installer. No credentials or artifact capabilities.\nsystemctl poweroff\nexit 78\n'}}}
    r['DataVolume'] = {'Type': 'AWS::EC2::Volume', 'DeletionPolicy': 'Retain', 'UpdateReplacePolicy': 'Retain',
        'Properties': {'AvailabilityZone': ref('AvailabilityZone'), 'Size': ref('DataGiB'), 'VolumeType': 'gp3', 'Encrypted': True,
                       'Tags': tags + [{'Key': 'DeleteBy', 'Value': ref('DataDeleteBy')}]}}
    r['DataAttachment'] = {'Type': 'AWS::EC2::VolumeAttachment', 'Properties': {'InstanceId': ref('Host'), 'VolumeId': ref('DataVolume'), 'Device': '/dev/sdf'}}
    r['BackupBucket'] = {'Type': 'AWS::S3::Bucket', 'DeletionPolicy': 'Retain', 'UpdateReplacePolicy': 'Retain', 'Properties': {
        'PublicAccessBlockConfiguration': {'BlockPublicAcls': True, 'IgnorePublicAcls': True, 'BlockPublicPolicy': True, 'RestrictPublicBuckets': True},
        'BucketEncryption': {'ServerSideEncryptionConfiguration': [{'ServerSideEncryptionByDefault': {'SSEAlgorithm': 'AES256'}}]},
        'VersioningConfiguration': {'Status': 'Enabled'}, 'OwnershipControls': {'Rules': [{'ObjectOwnership': 'BucketOwnerEnforced'}]},
        'LifecycleConfiguration': {'Rules': [{'Id': 'BoundedBackupVersions', 'Status': 'Enabled', 'ExpirationInDays': ref('BackupRetentionDays'),
            'NoncurrentVersionExpiration': {'NoncurrentDays': 1}, 'AbortIncompleteMultipartUpload': {'DaysAfterInitiation': 1}}]},
        'Tags': tags + [{'Key': 'DeleteBy', 'Value': ref('DataDeleteBy')}]}}
    for k, value in [('HostId', ref('Host')), ('DataVolumeId', ref('DataVolume')), ('BackupBucketName', ref('BackupBucket'))]:
        t['Outputs'][k] = {'Value': value, 'Description': 'Owned resource metadata only; retention and explicit cleanup remain required'}
    return t


def render(destination, runtime_seconds=None):
    destination.mkdir(parents=True, exist_ok=False)
    (destination / 'template.review-only.json').write_text(json.dumps(template(), indent=2) + '\n')
    for p in HERE.iterdir():
        if p.name.endswith(('.conf', '.service.in')) or p.name in ('Caddyfile', 'run-runtime.py', 'init-runtime-secrets.py', 'backup.sh', 'restore.sh', 'backup_archive.py'):
            body = p.read_text()
            if runtime_seconds is not None:
                body = body.replace('@RUNTIME_SECONDS@', str(runtime_seconds))
            (destination / p.name.removesuffix('.in')).write_text(body)
    (destination / 'ACTIVATION-HOLD.json').write_text(json.dumps({'preparation_only': True, 'deployable': False,
        'blocked': ['fresh account/inventory/gross CAD cost and reviewed capacity', 'verified AMI/AZ/pinned PostgreSQL+age toolchain',
                    'reviewed runtime secret/role initialization and retained-volume mount installer',
                    'absolute host expiry+egress guard installed before public serving',
                    'root-approved artifact delivery and bounded offhost backup capability',
                    'actual dual-runtime routing/account/results/restore proof', 'separate Root deployment authorization']}, indent=2) + '\n')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest='mode', required=True)
    p = sub.add_parser('render-review'); p.add_argument('--out', type=Path, required=True)
    p = sub.add_parser('preflight'); p.add_argument('--plan', type=Path, required=True); p.add_argument('--artifacts-root', type=Path, required=True)
    p.add_argument('--out', type=Path, help='optional NEW local review directory; never provisions')
    args = parser.parse_args()
    try:
        if args.mode == 'render-review':
            render(args.out)
            print('review files only; activation HOLD; no AWS operation')
        else:
            plan = json.loads(args.plan.read_text())
            result = validate(plan, args.artifacts_root, dt.datetime.now(UTC))
            if args.out:
                render(args.out, plan['runtime_seconds'])
                c = plan['compute']
                values = {'AmiId': c['ami_id'], 'InstanceType': c['instance_type'], 'AvailabilityZone': c['availability_zone'],
                          'RootGiB': c['root_gib'], 'DataGiB': c['data_gib'], 'DataDeleteBy': plan['data_delete_by'],
                          'BackupRetentionDays': plan['backup']['lifecycle_days'], 'RunId': plan['run_id']}
                (args.out / 'parameters.review-only.json').write_text(json.dumps([
                    {'ParameterKey': k, 'ParameterValue': str(v)} for k, v in values.items()], indent=2) + '\n')
            print(json.dumps({'local_input_checks': result, 'deployable': False, 'activation': 'HOLD: installer/live review and Root authorization remain required'}))
    except (Refused, KeyError, TypeError, ValueError, OSError):
        # Never print untrusted input/file contents; plans/artifacts must not contain credentials.
        parser.exit(2, 'preparation refused: missing, stale, invalid or unsupported review inputs; see the documented contract\n')


if __name__ == '__main__':
    main()
