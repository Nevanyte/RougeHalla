#!/usr/bin/env python3
"""Linux/root expiry executor. Must run as the main process of the verified PID1 bootstrap unit.

May write only its fixed deadline/lock/timer/service and arm that timer. Never
downloads, starts application services, activates an installer or calls AWS.
"""
import argparse
import contextlib
import datetime as dt
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import signal
import stat
import subprocess
import sys
import time

from host_device import LinuxProbe

GUARD = 'rougehalla-expiry-bootstrap.service'
TIMER = 'rougehalla-absolute-expiry.timer'
SERVICE = 'rougehalla-absolute-expiry.service'
STATE = 'run-deadline.json'
SC = ('/usr/bin/systemctl', '--system', '--no-pager', '--no-ask-password')
ENABLE = (*SC, '--quiet', 'enable', '--now', TIMER)
TIME_QUERY = ('/usr/bin/timedatectl', '--no-pager', '--no-ask-password', 'show',
              '--property=NTPSynchronized')
POWEROFF = (*SC, '--no-block', '--job-mode=replace-irreversibly', 'start', 'poweroff.target')
UTC = dt.timezone.utc
GUARD_PROPS = 'Id,LoadState,ActiveState,SubState,MainPID,ControlGroup,User,Type,FailureAction,TimeoutStartUSec,TimeoutStartFailureMode,KillMode,Restart,SuccessExitStatus,RefuseManualStop,FragmentPath,DropInPaths,NeedDaemonReload'
UNIT_PROPS = 'Id,LoadState,ActiveState,SubState,FragmentPath,DropInPaths,NeedDaemonReload,Transient,UnitFileState'
TIMER_PROPS = UNIT_PROPS + ',Persistent,Unit,TimersMonotonic,NextElapseUSecRealtime,AccuracyUSec,RandomizedDelayUSec,OnClockChange,Result'
SERVICE_PROPS = UNIT_PROPS + ',User,Type,ExecStart,FailureAction'


class Refused(ValueError):
    pass


class ShutdownRequested(Refused):
    """PID1 accepted shutdown; physical host-off still requires external verification."""


def require(ok, message):
    if not ok:
        raise Refused(message)


def show(unit, properties):
    return (*SC, 'show', '--all', '--property=' + properties, unit)


SHOW_GUARD = show(GUARD, GUARD_PROPS)
SHOW_TIMER = show(TIMER, TIMER_PROPS)
SHOW_SERVICE = show(SERVICE, SERVICE_PROPS)
SHOW_POWEROFF = show('poweroff.target', 'Id,LoadState,ActiveState,Job')
COMMANDS = (SHOW_GUARD, SHOW_TIMER, SHOW_SERVICE, SHOW_POWEROFF, TIME_QUERY,
            (*SC, '--version'), (*SC, 'daemon-reload'), ENABLE, POWEROFF)


def properties(text):
    require(type(text) is str and len(text) <= 65536, 'bounded manager properties required')
    result = {}
    for line in text.splitlines():
        key, separator, value = line.partition('=')
        require(separator and key not in result, 'missing/duplicate manager property')
        result[key] = value
    return result


def stamp(value):
    require(type(value) is str and re.fullmatch(r'\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z', value),
            'canonical UTC deadline required')
    return dt.datetime.strptime(value, '%Y-%m-%dT%H:%M:%SZ').replace(tzinfo=UTC)


def timestamp_us(value):
    # systemctl v255 property presentation, with fixed TZ=UTC/LC_ALL=C.
    require(type(value) is str and re.fullmatch(r'[A-Z][a-z]{2} \d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d{1,6})? UTC', value),
            'unsupported manager timestamp presentation')
    layout = '%a %Y-%m-%d %H:%M:%S' + ('.%f' if '.' in value else '') + ' UTC'
    return epoch_us(dt.datetime.strptime(value, layout).replace(tzinfo=UTC))


def epoch_us(value):
    delta = value - dt.datetime(1970, 1, 1, tzinfo=UTC)
    return (delta.days * 86400 + delta.seconds) * 1000000 + delta.microseconds


def duration_us(value):
    if value == '0':
        return 0
    require(type(value) is str and re.fullmatch(r'\d+(?:us|ms|s|min|h)(?: \d+(?:us|ms|s|min|h))*', value),
            'finite supported manager duration required')
    units = {'us': 1, 'ms': 1000, 's': 1000000, 'min': 60000000, 'h': 3600000000}
    return sum(int(number) * units[unit] for number, unit in re.findall(r'(\d+)(us|ms|s|min|h)', value))


def request_record(request):
    require(type(request) is dict and set(request) == {'run_id', 'prepared_at', 'expires_at'},
            'exact nonsecret expiry request required')
    require(type(request['run_id']) is str and re.fullmatch(r'[0-9]{8}t[0-9]{6}z-[0-9a-f]{6}', request['run_id']),
            'canonical run identifier required')
    start, end = stamp(request['prepared_at']), stamp(request['expires_at'])
    require(dt.timedelta(seconds=181) < end - start <= dt.timedelta(hours=4.5), 'bounded original absolute deadline required')
    return {'format': 'rh-fixed-host-deadline/1', 'run_id': request['run_id'], 'expires_at': request['expires_at']}


def material(record):
    calendar = stamp(record['expires_at']).strftime('%Y-%m-%d %H:%M:%S UTC')
    service = ('[Unit]\nDescription=Fixed run shutdown ' + record['run_id'] + '\nFailureAction=poweroff\n'
               '[Service]\nType=oneshot\nUser=root\nExecStart=' + ' '.join(POWEROFF) + '\n')
    timer = ('[Unit]\nDescription=Fixed run expiry ' + record['run_id'] + '\n[Timer]\nOnCalendar=' + calendar +
             '\nPersistent=true\nAccuracySec=1us\nRandomizedDelaySec=0\nOnClockChange=true\nUnit=' + SERVICE +
             '\n[Install]\nWantedBy=timers.target\n')
    return {STATE: (json.dumps(record, sort_keys=True) + '\n').encode(),
            SERVICE: service.encode(), TIMER: timer.encode()}


class DeadlineFiles:
    """Held trusted directory fds; tests use private temporary directories, never /etc."""
    def __init__(self, state_fd, unit_fd, owner=0):
        self.state_fd, self.unit_fd, self.owner = state_fd, unit_fd, owner
        self.lock_fd = None

    def info(self, fd):
        info = os.fstat(fd)
        require(stat.S_ISREG(info.st_mode) and info.st_uid == self.owner and info.st_nlink == 1
                and stat.S_IMODE(info.st_mode) == 0o600 and info.st_size <= 8192, 'untrusted deadline/unit inode')

    @contextlib.contextmanager
    def locked(self):
        fd = os.open('expiry-executor.lock', os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW | os.O_CLOEXEC,
                     0o600, dir_fd=self.state_fd)
        try:
            self.info(fd)
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
            os.fsync(fd); os.fsync(self.state_fd)
            yield self
        finally:
            os.close(fd)

    def ensure(self, name, body):
        require(name in (STATE, TIMER, SERVICE) and type(body) is bytes and len(body) <= 8192, 'fixed expiry file required')
        parent = self.state_fd if name == STATE else self.unit_fd
        try:
            fd = os.open(name, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW | os.O_CLOEXEC,
                         0o600, dir_fd=parent)
        except FileExistsError:
            self.verify(name, body)
            # Recover a crash between the original file and directory fsync without replacing bytes.
            os.fsync(parent)
            return
        try:
            self.info(fd)
            remaining = memoryview(body)
            while remaining:
                count = os.write(fd, remaining)
                require(count > 0, 'incomplete expiry write')
                remaining = remaining[count:]
            os.fsync(fd)
            os.fsync(parent)
        finally:
            os.close(fd)

    def check_layout(self):
        present = set()
        for name in (STATE, TIMER, SERVICE):
            try:
                os.stat(name, dir_fd=self.state_fd if name == STATE else self.unit_fd, follow_symlinks=False)
                present.add(name)
            except FileNotFoundError:
                pass
        require(not present or STATE in present, 'unit state without original deadline refused')

    def verify(self, name, body):
        require(name in (STATE, TIMER, SERVICE), 'fixed expiry file required')
        parent = self.state_fd if name == STATE else self.unit_fd
        fd = os.open(name, os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC, dir_fd=parent)
        try:
            self.info(fd)
            require(os.read(fd, 8193) == body, 'existing deadline/material differs; never replace or renew')
            os.fsync(fd)
        finally:
            os.close(fd)

    def persist_enabled(self):
        fd = os.open('timers.target.wants', os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC,
                     dir_fd=self.unit_fd)
        try:
            info = os.fstat(fd)
            require(info.st_uid == self.owner and not info.st_mode & 0o022, 'untrusted timer enablement directory')
            link = os.stat(TIMER, dir_fd=fd, follow_symlinks=False)
            require(stat.S_ISLNK(link.st_mode) and link.st_uid == self.owner and link.st_nlink == 1
                    and os.readlink(TIMER, dir_fd=fd) in ('../' + TIMER, '/etc/systemd/system/' + TIMER),
                    'timer enablement link mismatch')
            os.fsync(fd); os.fsync(self.unit_fd)
        finally:
            os.close(fd)


class LinuxRunner:
    """Strict real OS boundary. Constructing it performs no action."""
    def platform(self): return sys.platform
    def uid(self): return os.geteuid()
    def pid(self): return os.getpid()
    def read(self, path):
        require(path in ('/proc/1/comm', '/proc/self/cgroup'), 'kernel read not allowlisted')
        return LinuxProbe().read(path)
    def namespace(self, path):
        require(path in ('/proc/self/ns/mnt', '/proc/1/ns/mnt'), 'namespace read not allowlisted')
        return os.readlink(path)
    def clock(self): return time.time_ns() // 1000, time.clock_gettime_ns(time.CLOCK_BOOTTIME) // 1000

    def run(self, argv):
        require(argv in COMMANDS, 'command not allowlisted')
        LinuxProbe().trusted_tool(argv[0])
        result = subprocess.run(argv, shell=False, check=True, stdin=subprocess.DEVNULL,
                                stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=5, cwd='/',
                                env={'PATH': '/usr/bin:/usr/sbin', 'LC_ALL': 'C', 'TZ': 'UTC'}, encoding='utf-8')
        require(len(result.stdout) <= 65536 and not result.stderr, 'systemd command output refused')
        return result.stdout

    @contextlib.contextmanager
    def files(self):
        handles = []
        def directory(path, create=False):
            current = os.open('/', os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC)
            handles.append(current)
            components = Path(path).parts[1:]
            for index, component in enumerate(components):
                if create and index == len(components) - 1:
                    try: os.mkdir(component, mode=0o700, dir_fd=current); os.fsync(current)
                    except FileExistsError: pass
                current = os.open(component, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC, dir_fd=current)
                handles.append(current)
                info = os.fstat(current)
                require(info.st_uid == 0 and not info.st_mode & 0o022, 'untrusted expiry directory')
            return current
        try:
            state_fd = directory('/etc/rougehalla', create=True)
            unit_fd = directory('/etc/systemd/system')
            yield DeadlineFiles(state_fd, unit_fd)
        finally:
            for fd in reversed(handles): os.close(fd)


def verify_guard(runner):
    require(runner.read('/proc/1/comm') == 'systemd\n', 'PID1 must be systemd')
    require(runner.namespace('/proc/self/ns/mnt') == runner.namespace('/proc/1/ns/mnt'), 'PID1 mount namespace required')
    require(runner.read('/proc/self/cgroup') == '0::/system.slice/' + GUARD + '\n', 'dedicated v2 bootstrap cgroup required')
    version = runner.run((*SC, '--version')).splitlines()[0]
    require(re.fullmatch(r'systemd 255(?:[ .()].*)?', version), 'only reviewed systemd 255 supported')
    p = properties(runner.run(SHOW_GUARD))
    expected = {'Id': GUARD, 'LoadState': 'loaded', 'ActiveState': 'activating', 'SubState': 'start',
                'MainPID': str(runner.pid()), 'ControlGroup': '/system.slice/' + GUARD,
                'User': 'root', 'Type': 'oneshot', 'FailureAction': 'poweroff', 'RefuseManualStop': 'yes',
                'TimeoutStartFailureMode': 'kill', 'KillMode': 'control-group', 'Restart': 'no', 'SuccessExitStatus': '',
                'FragmentPath': '/etc/systemd/system/' + GUARD, 'DropInPaths': '', 'NeedDaemonReload': 'no'}
    require(all(p.get(key) == value for key, value in expected.items()), 'independent bootstrap guard missing or incompatible')
    require(0 < duration_us(p.get('TimeoutStartUSec')) <= 120000000, 'bootstrap needs finite <=120s startup timeout')


def verify_units(runner, end):
    for unit, command in ((SERVICE, SHOW_SERVICE), (TIMER, SHOW_TIMER)):
        p = properties(runner.run(command))
        expected = {'Id': unit, 'LoadState': 'loaded', 'FragmentPath': '/etc/systemd/system/' + unit,
                    'DropInPaths': '', 'NeedDaemonReload': 'no', 'Transient': 'no'}
        require(all(p.get(key) == value for key, value in expected.items()), 'loaded expiry unit differs or has overrides')
        if unit == SERVICE:
            require(p.get('User') == 'root' and p.get('Type') == 'oneshot' and p.get('FailureAction') == 'poweroff'
                    and p.get('ActiveState') == 'inactive', 'shutdown service is not safely armed')
            prefix = '{ path=/usr/bin/systemctl ; argv[]=' + ' '.join(POWEROFF) + ' ; ignore_errors=no ;'
            require(p.get('ExecStart', '').startswith(prefix) and p['ExecStart'].count('{') == 1
                    and p['ExecStart'].endswith('}'), 'shutdown ExecStart mismatch')
        else:
            require(p.get('ActiveState') == 'active' and p.get('SubState') == 'waiting'
                    and p.get('UnitFileState') == 'enabled' and p.get('Persistent') == 'yes'
                    # v255 omits this property when the array is empty, even with --all.
                    and p.get('Unit') == SERVICE and 'TimersMonotonic' not in p
                    and p.get('OnClockChange') == 'yes' and p.get('Result') == 'success'
                    and duration_us(p.get('AccuracyUSec')) == 1
                    and duration_us(p.get('RandomizedDelayUSec')) == 0
                    and timestamp_us(p.get('NextElapseUSecRealtime')) == end,
                    'absolute persistent timer is not actually armed for the fixed deadline')


def shutdown(runner):
    runner.run(POWEROFF)
    p = properties(runner.run(SHOW_POWEROFF))
    require(p.get('Id') == 'poweroff.target' and p.get('LoadState') == 'loaded'
            and (p.get('ActiveState') in ('active', 'activating')
                 or re.fullmatch('[1-9][0-9]*', p.get('Job', ''))), 'PID1 shutdown acceptance not verified')
    raise ShutdownRequested('PID1 accepted independent shutdown; no downstream gate')


def no_shutdown_pending(runner):
    p = properties(runner.run(SHOW_POWEROFF))
    require(p.get('Id') == 'poweroff.target' and p.get('LoadState') == 'loaded'
            and p.get('ActiveState') == 'inactive' and p.get('Job') == '', 'shutdown already pending; no work gate')


def execute(request, runner=None):
    injected = runner is not None
    runner = runner if injected else LinuxRunner()
    require(runner.platform() == 'linux' and runner.uid() == 0, 'Linux/root only; no host action performed')
    # No deadline state is created until this independently supervised process boundary is verified.
    verify_guard(runner)
    previous = None
    try:
        record = request_record(request)
        start, end = epoch_us(stamp(request['prepared_at'])), epoch_us(stamp(record['expires_at']))
        def check_clock():
            nonlocal previous
            real, boot = runner.clock()
            require(type(real) is int and type(boot) is int and boot >= 0, 'invalid OS clock observation')
            if real >= end:
                raise Refused('fixed absolute expiry elapsed')
            require(real >= start, 'clock precedes original preparation')
            if previous is not None:
                dr, db = real - previous[0], boot - previous[1]
                require(db >= 0 and abs(dr - db) <= 1000000, 'OS clock changed during expiry setup')
            require(properties(runner.run(TIME_QUERY)) == {'NTPSynchronized': 'yes'}, 'kernel clock not synchronized')
            previous = real, boot
            return real
        check_clock()
        no_shutdown_pending(runner)
        bodies = material(record)
        with runner.files() as files, files.locked():
            files.check_layout()
            for name, body in bodies.items():
                check_clock()
                files.ensure(name, body)
            check_clock()
            runner.run((*SC, 'daemon-reload'))
            runner.run(ENABLE)
            files.persist_enabled()
            check_clock()
            verify_units(runner, end)
            for name, body in bodies.items(): files.verify(name, body)
            verify_guard(runner)
            no_shutdown_pending(runner)
            checked_at = check_clock()
        return {'format': 'rh-expiry-executor-gate/1', 'expiry_gate': True, 'installed': False, 'deployable': False,
                'probe_mode': 'injected' if injected else 'local-linux-root', 'deadline': record,
                'checked_at_us': checked_at,
                'material_sha256': {name: hashlib.sha256(body).hexdigest() for name, body in bodies.items()}}
    except (Exception, KeyboardInterrupt):
        # No cleanup, replacement, timer stop or relative renewal. PID1 guard also survives SIGKILL/timeout.
        try:
            shutdown(runner)
        except ShutdownRequested:
            raise
        except (Exception, KeyboardInterrupt):
            raise Refused('expiry setup refused; independent shutdown acceptance unverified; no gate') from None


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--run-id', required=True)
    parser.add_argument('--prepared-at', required=True)
    parser.add_argument('--expires-at', required=True)
    args = parser.parse_args(argv)
    try:
        result = execute(vars(args))
        print(json.dumps(result, sort_keys=True))
        return 0
    except ShutdownRequested as error:
        print(str(error), file=sys.stderr)
        return 3
    except (Refused, OSError, ValueError, subprocess.SubprocessError):
        print('expiry executor refused; no downstream gate', file=sys.stderr)
        return 2


if __name__ == '__main__':
    def cancelled(_signal, _frame): raise KeyboardInterrupt()
    signal.signal(signal.SIGTERM, cancelled)
    raise SystemExit(main())
