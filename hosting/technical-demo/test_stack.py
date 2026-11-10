"""Local structural/security controls only; not CloudFormation or host execution."""
import base64
import copy
import gzip
from pathlib import Path
import unittest
import yaml


class CfnLoader(yaml.SafeLoader):
    pass


def intrinsic(loader, suffix, node):
    value = (loader.construct_sequence(node) if isinstance(node, yaml.SequenceNode)
             else loader.construct_mapping(node) if isinstance(node, yaml.MappingNode)
             else loader.construct_scalar(node))
    return {suffix if suffix == 'Ref' else 'Fn::' + suffix: value}


CfnLoader.add_multi_constructor('!', intrinsic)
TEMPLATE = yaml.load(Path(__file__).with_name('stack.yaml').read_text(), Loader=CfnLoader)


def security_contract(t):
    r = t['Resources']
    allowed = {'AWS::S3::Bucket', 'AWS::S3::BucketPolicy', 'AWS::IAM::Role',
               'AWS::IAM::InstanceProfile', 'AWS::EC2::SecurityGroup',
               'AWS::EC2::Instance', 'AWS::Scheduler::Schedule'}
    assert all(v['Type'] in allowed for v in r.values())
    assert sum(v['Type'] == 'AWS::EC2::Instance' for v in r.values()) == 1
    host = r['DemoHost']['Properties']
    assert host['InstanceType'] == 't3.small'
    assert host['CreditSpecification']['CPUCredits'] == 'standard'
    assert host['InstanceInitiatedShutdownBehavior'] == 'terminate'
    assert 'KeyName' not in host
    assert host['MetadataOptions']['HttpTokens'] == 'required'
    assert host['MetadataOptions']['HttpPutResponseHopLimit'] == 1
    assert host['BlockDeviceMappings'] == [{
        'DeviceName': '/dev/sda1', 'Ebs': {'VolumeSize': 8, 'VolumeType': 'gp3',
                                        'Encrypted': True, 'DeleteOnTermination': True}}]
    ingress = r['HostSecurityGroup']['Properties']['SecurityGroupIngress']
    assert {(v['IpProtocol'], v['FromPort'], v['ToPort']) for v in ingress} == {
        ('tcp', 80, 80), ('tcp', 443, 443)}
    assert len(ingress) == 2
    policy = r['ExpiryRole']['Properties']['Policies'][0]['PolicyDocument']['Statement']
    assert len(policy) == 1 and policy[0]['Action'] == 'ec2:TerminateInstances'
    assert policy[0]['Resource'] == {'Fn::Sub':
        'arn:${AWS::Partition}:ec2:${AWS::Region}:${AWS::AccountId}:instance/${DemoHost}'}
    trust = r['ExpiryRole']['Properties']['AssumeRolePolicyDocument']['Statement'][0]
    assert trust['Principal'] == {'Service': 'scheduler.amazonaws.com'}
    assert trust['Condition']['StringEquals'] == {
        'aws:SourceAccount': {'Ref': 'AWS::AccountId'},
        'aws:SourceArn': {'Fn::Sub':
            'arn:${AWS::Partition}:scheduler:${AWS::Region}:${AWS::AccountId}:schedule-group/default'}}
    s3 = r['HostRole']['Properties']['Policies'][0]['PolicyDocument']['Statement']
    assert s3[0] == {'Effect': 'Allow', 'Action': 's3:GetObject',
                     'Resource': {'Fn::Sub': '${BundleBucket.Arn}/${BundleKey}'}}
    assert s3[1]['Effect'] == 'Deny' and s3[1]['Resource'] == '*'
    assert set(s3[1]['Action']) == {'ssm:GetParameter', 'ssm:GetParameters', 'ssm:GetParametersByPath'}


class StackTests(unittest.TestCase):
    def test_security_contract(self):
        security_contract(TEMPLATE)

    def test_wide_instance_permission_and_extra_public_port_are_refused(self):
        for change in ('wildcard', 'ssh'):
            t = copy.deepcopy(TEMPLATE)
            if change == 'wildcard':
                t['Resources']['ExpiryRole']['Properties']['Policies'][0]['PolicyDocument']['Statement'][0]['Resource'] = '*'
            else:
                t['Resources']['HostSecurityGroup']['Properties']['SecurityGroupIngress'].append(
                    {'IpProtocol': 'tcp', 'FromPort': 22, 'ToPort': 22})
            with self.assertRaises(AssertionError):
                security_contract(t)

    def test_bundle_bucket_is_private_encrypted_and_disposable(self):
        b = TEMPLATE['Resources']['BundleBucket']
        p = b['Properties']
        self.assertTrue(all(p['PublicAccessBlockConfiguration'].values()))
        self.assertEqual(len(p['PublicAccessBlockConfiguration']), 4)
        self.assertEqual(p['BucketEncryption']['ServerSideEncryptionConfiguration'][0]
                         ['ServerSideEncryptionByDefault']['SSEAlgorithm'], 'AES256')
        self.assertEqual(p['LifecycleConfiguration']['Rules'][0]['ExpirationInDays'], 1)
        self.assertEqual((b['DeletionPolicy'], b['UpdateReplacePolicy']), ('Delete', 'Delete'))

    def test_encoded_gzip_larger_than_one_parameter_roundtrips_without_double_encoding(self):
        # Synthetic incompressible payload, not the bootstrap or an executed script.
        import random
        raw = random.Random(84).randbytes(12000)
        packed = gzip.compress(raw, mtime=0)
        encoded = base64.b64encode(packed).decode('ascii')
        self.assertGreater(len(encoded), 4096)
        self.assertLessEqual(len(encoded), 16384)
        chunks = [encoded[i:i + 4096] for i in range(0, len(encoded), 4096)]
        chunks += [''] * (4 - len(chunks))
        supplied = {'EncodedGzipUserData' + str(i + 1): v for i, v in enumerate(chunks)}
        join = TEMPLATE['Resources']['DemoHost']['Properties']['UserData']
        self.assertEqual(set(join), {'Fn::Join'})
        sep, refs = join['Fn::Join']
        reconstructed = sep.join(supplied[x['Ref']] for x in refs)
        self.assertEqual(gzip.decompress(base64.b64decode(reconstructed, validate=True)), raw)
        for name, v in supplied.items():
            self.assertLessEqual(len(v), TEMPLATE['Parameters'][name]['MaxLength'])

    def test_bucket_only_stage_cannot_launch_host_or_scheduler(self):
        self.assertEqual(TEMPLATE['Parameters']['LaunchHost']['Default'], 'false')
        for name, r in TEMPLATE['Resources'].items():
            if name not in ('BundleBucket', 'BundleTransportPolicy', 'HostRole', 'HostProfile', 'HostSecurityGroup'):
                self.assertEqual(r.get('Condition'), 'RunHost', name)
        self.assertEqual(TEMPLATE['Conditions']['RunHost'],
                         {'Fn::Equals': [{'Ref': 'LaunchHost'}, 'true']})

    def test_absolute_expiry_targets_same_instance_with_finite_retries(self):
        p = TEMPLATE['Resources']['ExpirySchedule']['Properties']
        self.assertEqual(p['ScheduleExpression'], {'Fn::Sub': 'at(${ExpiresAt})'})
        self.assertEqual(p['ScheduleExpressionTimezone'], 'UTC')
        self.assertEqual(p['FlexibleTimeWindow'], {'Mode': 'OFF'})
        self.assertEqual(p['Target']['Input'], {'Fn::Sub': '{"InstanceIds":["${DemoHost}"]}'})
        self.assertEqual(p['Target']['RetryPolicy'],
                         {'MaximumEventAgeInSeconds': 300, 'MaximumRetryAttempts': 2})
        # Unsupported CFN property must not masquerade as automatic deletion.
        self.assertNotIn('ActionAfterCompletion', p)
        self.assertIn('CFN Schedule currently lacks ActionAfterCompletion',
                      Path(__file__).with_name('stack.yaml').read_text())

    def test_only_approved_account_region_ami_and_outputs(self):
        self.assertEqual(TEMPLATE['Parameters']['ImageId']['AllowedValues'], ['ami-0534b90585e73fdb1'])
        assertions = TEMPLATE['Rules']['ApprovedBoundary']['Assertions']
        self.assertEqual([x['Assert'] for x in assertions], [
            {'Fn::Equals': [{'Ref': 'AWS::AccountId'}, '048226733033']},
            {'Fn::Equals': [{'Ref': 'AWS::Region'}, 'ca-west-1']}])
        self.assertEqual(set(TEMPLATE['Outputs']), {'InstanceId', 'PublicIp', 'ArtifactBucket'})


if __name__ == '__main__':
    unittest.main()
