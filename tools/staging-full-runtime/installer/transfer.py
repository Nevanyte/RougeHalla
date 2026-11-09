"""Build exact future host argv and verify local bytes. Never runs AWS CLI or opens a network connection."""
import base64
import hashlib
import json
from pathlib import Path, PurePosixPath
import re
import stat
import tarfile
from contract import ACCOUNT, REGION, require, strict_json, digest


def get_command(plan):
    item = plan['artifact']
    destination = '/var/lib/rougehalla-installer/'+plan['run_id']+'/public-bundle.tar'
    return ['/opt/rougehalla/aws/bin/aws', '--no-cli-pager', '--no-cli-auto-prompt', '--region', REGION,
            '--endpoint-url', 'https://s3.ca-west-1.amazonaws.com',
            's3api', 'get-object', '--bucket', item['bucket'], '--key', item['key'], '--version-id', item['version_id'],
            '--expected-bucket-owner', ACCOUNT, '--range', 'bytes=0-'+str(item['bytes']-1), destination]


def file_digest(path, maximum):
    info = path.lstat()
    require(stat.S_ISREG(info.st_mode) and info.st_size <= maximum and info.st_nlink == 1, 'bounded private regular file required')
    h = hashlib.sha256()
    with path.open('rb') as stream:
        for data in iter(lambda: stream.read(1024*1024), b''):
            h.update(data)
    return info.st_size, h.hexdigest()


def verify_download(plan, path, metadata):
    item = plan['artifact']; count, checksum = file_digest(Path(path), item['bytes'])
    require(count == item['bytes'] and checksum == item['sha256'], 'download length/hash mismatch')
    require(metadata.get('VersionId') == item['version_id'] and metadata.get('ContentLength') == count and
            metadata.get('ContentRange') == 'bytes 0-'+str(count-1)+'/'+str(count), 'download is not complete pinned version')


def put_ciphertext_command(plan, path, ciphertext_sha256):
    # A .age name is NOT proof of encryption: caller must bind real backup.sh completion, private ownership and this digest.
    path = Path(path)
    digest(ciphertext_sha256)
    require(path.is_absolute() and path.suffix == '.age', 'absolute ciphertext path required')
    count, actual = file_digest(path, plan['backup']['max_bytes'])
    require(count > 0 and actual == ciphertext_sha256, 'ciphertext size/hash mismatch')
    with path.open('rb') as stream:
        require(stream.read(22) == b'age-encryption.org/v1\n', 'age ciphertext envelope required; not producer attestation')
    checksum = base64.b64encode(bytes.fromhex(actual)).decode('ascii')
    return ['/opt/rougehalla/aws/bin/aws', '--no-cli-pager', '--no-cli-auto-prompt', '--region', REGION,
            '--endpoint-url', 'https://s3.ca-west-1.amazonaws.com', 's3api', 'put-object',
            '--bucket', plan['backup']['bucket'], '--key', plan['backup']['key'], '--expected-bucket-owner', ACCOUNT,
            '--if-none-match', '*', '--server-side-encryption', 'AES256', '--checksum-algorithm', 'SHA256', '--checksum-sha256', checksum,
            '--content-type', 'application/octet-stream', '--metadata', 'run_id='+plan['run_id']+',ciphertext_sha256='+actual,
            '--body', str(path)]


def verify_put_response(plan, response, ciphertext_sha256):
    digest(ciphertext_sha256)
    expected = base64.b64encode(bytes.fromhex(ciphertext_sha256)).decode('ascii')
    require(response.get('VersionId') not in (None, '', 'null') and response.get('ChecksumSHA256') == expected,
            'PUT is unconfirmed; no independent offhost restore proof')
    return {'run_id': plan['run_id'], 'bucket': plan['backup']['bucket'], 'key': plan['backup']['key'],
            'version_id': response['VersionId'], 'ciphertext_sha256': ciphertext_sha256, 'offhost_restore_proved': False}


def inspect_bundle(path, run_id):
    """Uncompressed public tar only, no extraction. All declared bytes/hashes checked; links/specials/traversal refused."""
    seen = {}; total = 0
    with tarfile.open(path, 'r:') as archive:
        for member in archive:
            name = PurePosixPath(member.name)
            require(member.isfile() and not member.issparse() and not member.pax_headers and member.name == str(name)
                    and name.parts and not name.is_absolute() and '..' not in name.parts and '.' not in name.parts
                    and '\\' not in member.name and member.name not in seen, 'unsafe/duplicate bundle member')
            require(len(seen) < 4096 and member.size >= 0, 'bundle member limit')
            total += member.size; require(total <= Path(path).stat().st_size, 'bundle expands beyond pinned tar')
            body = archive.extractfile(member)
            if member.name == 'manifest.json':
                require(member.size <= 1024*1024, 'manifest bound')
                raw = body.read(); manifest_raw = raw
                seen[member.name] = (len(raw), hashlib.sha256(raw).hexdigest())
            else:
                h = hashlib.sha256(); count = 0
                for data in iter(lambda: body.read(1024*1024), b''):
                    count += len(data); h.update(data)
                require(count == member.size, 'truncated bundle member')
                seen[member.name] = (count, h.hexdigest())
    require('manifest.json' in seen, 'bundle manifest missing')
    manifest = strict_json(manifest_raw)
    require(set(manifest) == {'format', 'run_id', 'files'} and manifest['format'] == 'rh-installer-public-bundle/1'
            and manifest['run_id'] == run_id and type(manifest['files']) is list, 'bundle is not this run')
    declared = {}
    for item in manifest['files']:
        require(type(item) is dict and set(item) == {'path', 'bytes', 'sha256'} and type(item['path']) is str and item['path'] not in declared
                and type(item['bytes']) is int and type(item['sha256']) is str and re.fullmatch('[0-9a-f]{64}', item['sha256']), 'manifest member shape')
        declared[item['path']] = (item['bytes'], item['sha256'])
    actual = {name: value for name, value in seen.items() if name != 'manifest.json'}
    require(actual == declared and actual, 'bundle missing/unmanifested/substituted bytes')
    return len(actual)
