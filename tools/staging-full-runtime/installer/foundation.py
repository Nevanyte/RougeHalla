"""Inert dependency-injected foundation. No host executor exists here; never produces an installed marker."""
import datetime as dt
from contract import require, validate, stamp
from transfer import get_command, verify_download, inspect_bundle


def check_deadline(plan, recorded, now):
    require(recorded == {'format': 'rh-fixed-host-deadline/1', 'run_id': plan['run_id'], 'expires_at': plan['host_expires_at']},
            'deadline/run mismatch; never renew on restart')
    require(now < stamp(plan['host_expires_at']), 'fixed host expiry elapsed')


def check_volume(plan, facts):
    expected = plan['volume']
    require(facts['ebs_serial'] == expected['id'].replace('-', '') and facts['uuid'] == expected['uuid']
            and facts['filesystem'] == expected['filesystem'], 'volume identity mismatch; never format unknown media')
    require(facts['device'] != facts['root_device'] and facts['device'] == facts['mounted_device']
            and facts['mountpoint'] == expected['mountpoint'], 'retained mount is not exact known device')
    require(facts['writable'] is True and facts['owned_run_id'] == (plan['run_id'] if plan['mode'] == 'fresh' else plan['previous_run_id']),
            'retained ownership or mount refused')


def run_foundation(plan, operations, clock):
    """Testable ordering, not attestation. Injected operations/facts do not prove an actual host installed anything."""
    validate(plan, clock())
    # This must persist+arm the SAME absolute timer before downloads, DB or serving. No relative timer/reset allowed.
    recorded = operations.install_fixed_expiry(plan)
    check_deadline(plan, recorded, clock())
    check_volume(plan, operations.inspect_volume())
    check_deadline(plan, recorded, clock())
    operations.lock_stopped_writers(plan)  # Exclusive local lock; old remote writers still require Root fencing proof.
    check_deadline(plan, recorded, clock())
    path, metadata = operations.download_exact_version(get_command(plan))
    check_deadline(plan, recorded, clock())
    verify_download(plan, path, metadata)
    members = inspect_bundle(path, plan['run_id'])
    return {'deployable': False, 'installed': False, 'stage': 'artifact-verified-not-installed',
            'run_id': plan['run_id'], 'bundle_members': members,
            'remaining': 'PG/egress/TLS/service/native-account/restore gates; no marker or activation implementation'}
