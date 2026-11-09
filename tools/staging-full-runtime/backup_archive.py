#!/usr/bin/env python3
"""Pure local restore precheck/extractor; called before PostgreSQL mutation. No secret values printed."""
import hashlib
import json
import shutil
from pathlib import Path, PurePosixPath
import sys
import tarfile


def extract(root):
    with tarfile.open(root / 'plaintext.tar') as archive:
        members = archive.getmembers()
        names = [m.name.rstrip('/') for m in members]
        if len(set(names)) != len(names):
            raise ValueError('duplicate backup members')
        for member in members:
            p = PurePosixPath(member.name)
            if p.is_absolute() or '..' in p.parts or not (member.isfile() or member.isdir()):
                raise ValueError('unsafe backup member')
            if not p.parts or p.parts[0] not in ('database.dump', 'spool-source', 'manifest.json'):
                raise ValueError('unknown backup root')
            if member.name in ('database.dump', 'manifest.json') and not member.isfile():
                raise ValueError('required backup file has wrong kind')
        manifest = json.load(archive.extractfile('manifest.json'))
        if manifest.get('format') != 'rh-staging-cold-backup/1' or manifest.get('quiesced') is not True:
            raise ValueError('backup format')
        rows = manifest['files']
        paths = [r['path'] for r in rows]
        actual = {m.name for m in members if m.isfile() and m.name != 'manifest.json'}
        if len(set(paths)) != len(paths) or set(paths) != actual or 'database.dump' not in paths:
            raise ValueError('backup completeness')
        if 'spool-source' not in names:
            raise ValueError('pending spool directory missing')
        for row in rows:
            h = hashlib.sha256()
            with archive.extractfile(row['path']) as f:
                for chunk in iter(lambda: f.read(1024 * 1024), b''): h.update(chunk)
            if h.hexdigest() != row['sha256']:
                raise ValueError('backup hash mismatch')
        for member in members:
            dest = root / member.name
            if member.isdir():
                dest.mkdir(parents=True, exist_ok=True)
            else:
                dest.parent.mkdir(parents=True, exist_ok=True)
                with dest.open('xb') as f, archive.extractfile(member) as source:
                    shutil.copyfileobj(source, f, 1024 * 1024)


if __name__ == '__main__':
    try:
        if len(sys.argv) != 2:
            raise ValueError()
        extract(Path(sys.argv[1]))
    except Exception:
        raise SystemExit('backup refused before database mutation; private diagnosis required') from None
