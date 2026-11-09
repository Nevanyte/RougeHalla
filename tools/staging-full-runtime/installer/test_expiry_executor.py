"""Fake PID1/clock/commands plus real private temporary files. Never operates the host."""
import configparser
import contextlib
import datetime as dt
import io
import os
from pathlib import Path
import stat
import subprocess
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

import expiry_executor as e

REQUEST = {'run_id': '20261109t120000z-abcdef', 'prepared_at': '2026-11-09T12:00:00Z',
           'expires_at': '2026-11-09T16:00:00Z'}
LEGACY_ENABLE = (*e.SC, 'enable', '--now', e.TIMER)
QUIET_ENABLE = (*e.SC, '--quiet', 'enable', '--now', e.TIMER)


def text(values):
    return ''.join(key + '=' + str(value) + '\n' for key, value in values.items())


class SimulatedKill(BaseException):
    pass


class TracedFiles(e.DeadlineFiles):
    def __init__(self, runner, *args):
        super().__init__(*args)
        self.runner = runner

    def ensure(self, name, body):
        self.runner.event(('ensure-before', name))
        super().ensure(name, body)
        self.runner.event(('ensure-after', name))


class FakeLinux:
    """Independent synthetic manager state derives loaded units from actual temporary files."""
    def __init__(self, root):
        self.root = root
        self.state, self.units = root / 'state', root / 'units'
        self.state.mkdir(mode=0o700); self.units.mkdir(mode=0o700)
        self.events, self.loaded = [], {}
        self.enabled, self.armed, self.job = False, False, 0
        self.platform_name, self.owner, self.process = 'linux', 0, 4242
        self.real = e.epoch_us(e.stamp('2026-11-09T12:01:00Z'))
        self.boot, self.ntp = 10000000, 'yes'
        self.guard = {'Id': e.GUARD, 'LoadState': 'loaded', 'ActiveState': 'activating', 'SubState': 'start',
                      'MainPID': '4242', 'ControlGroup': '/system.slice/' + e.GUARD, 'User': 'root',
                      'Type': 'oneshot', 'FailureAction': 'poweroff', 'TimeoutStartUSec': '2min',
                      'TimeoutStartFailureMode': 'kill', 'KillMode': 'control-group', 'Restart': 'no',
                      'SuccessExitStatus': '', 'RefuseManualStop': 'yes',
                      'FragmentPath': '/etc/systemd/system/' + e.GUARD, 'DropInPaths': '', 'NeedDaemonReload': 'no'}
        self.kernel = {'/proc/1/comm': 'systemd\n', '/proc/self/cgroup': '0::/system.slice/' + e.GUARD + '\n'}
        self.version = 'systemd 255 (255.4)\n+SYNTHETIC\n'
        self.override = {}
        self.interrupt_at, self.interrupt_type = None, RuntimeError
        self.fail_command, self.cancel_shutdown = None, False
        self.advance_at, self.advance_by = None, 0

    def platform(self): return self.platform_name
    def uid(self): return self.owner
    def pid(self): return self.process
    def read(self, path): self.event(('read', path)); return self.kernel[path]
    def namespace(self, path): self.event(('namespace', path)); return 'mnt:[SYNTHETIC]'
    def clock(self):
        self.event(('clock',))
        self.real += 10; self.boot += 10
        return self.real, self.boot

    def event(self, item):
        self.events.append(item)
        if item == self.advance_at:
            self.real += self.advance_by
            self.advance_at = None
        if item == self.interrupt_at:
            self.interrupt_at = None
            raise self.interrupt_type('synthetic interruption')

    @contextlib.contextmanager
    def files(self):
        self.event(('files',))
        flags = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW
        state_fd, unit_fd = os.open(self.state, flags), os.open(self.units, flags)
        try:
            yield TracedFiles(self, state_fd, unit_fd, os.geteuid())
        finally:
            os.close(unit_fd); os.close(state_fd)

    def unit_properties(self, unit):
        common = {'Id': unit, 'LoadState': 'loaded' if unit in self.loaded else 'not-found',
                  'FragmentPath': '/etc/systemd/system/' + unit, 'DropInPaths': '',
                  'NeedDaemonReload': 'no', 'Transient': 'no', 'UnitFileState': 'enabled' if self.enabled else 'disabled'}
        if unit not in self.loaded:
            return common
        config = self.loaded[unit]
        if unit == e.SERVICE:
            command = config['Service']['ExecStart']
            common.update(ActiveState='inactive', SubState='dead', User=config['Service'].get('User', ''),
                          Type=config['Service']['Type'], FailureAction=config['Unit']['FailureAction'],
                          ExecStart='{ path=' + command.split()[0] + ' ; argv[]=' + command +
                          ' ; ignore_errors=no ; start_time=[n/a] ; stop_time=[n/a] ; pid=0 ; code=(null) ; status=0/0 }')
        else:
            timer = config['Timer']
            calendar = dt.datetime.strptime(timer['OnCalendar'], '%Y-%m-%d %H:%M:%S UTC')
            common.update(ActiveState='active' if self.armed else 'inactive', SubState='waiting' if self.armed else 'dead',
                          Persistent='yes' if timer['Persistent'] == 'true' else 'no', Unit=timer['Unit'],
                          NextElapseUSecRealtime=calendar.strftime('%a %Y-%m-%d %H:%M:%S UTC'),
                          AccuracyUSec=timer['AccuracySec'], RandomizedDelayUSec=timer['RandomizedDelaySec'],
                          OnClockChange='yes' if timer.get('OnClockChange') == 'true' else 'no', Result='success')
        common.update(self.override.get(unit, {}))
        return common

    def run(self, argv):
        self.event(('command', argv))
        if argv == self.fail_command:
            raise subprocess.CalledProcessError(1, argv)
        if argv == (*e.SC, '--version'): return self.version
        if argv == e.SHOW_GUARD: return text(self.guard)
        if argv == e.TIME_QUERY: return text({'NTPSynchronized': self.ntp})
        if argv == (*e.SC, 'daemon-reload'):
            for unit in (e.TIMER, e.SERVICE):
                config = configparser.ConfigParser(interpolation=None)
                config.optionxform = str
                config.read_string((self.units / unit).read_text())
                self.loaded[unit] = config
            return ''
        if argv in (LEGACY_ENABLE, QUIET_ENABLE):
            if set(self.loaded) != {e.TIMER, e.SERVICE}: raise RuntimeError('no loaded units')
            wants = self.units / 'timers.target.wants'; wants.mkdir(exist_ok=True, mode=0o700)
            link = wants / e.TIMER
            if not link.is_symlink(): link.symlink_to('../' + e.TIMER)
            self.enabled, self.armed = True, True
            return ''
        if argv == e.SHOW_TIMER: return text(self.unit_properties(e.TIMER))
        if argv == e.SHOW_SERVICE: return text(self.unit_properties(e.SERVICE))
        if argv == e.POWEROFF:
            self.job = 0 if self.cancel_shutdown else 17
            return ''
        if argv == e.SHOW_POWEROFF:
            return text({'Id': 'poweroff.target', 'LoadState': 'loaded', 'ActiveState': 'inactive',
                         'Job': self.job if self.job else ''})
        raise AssertionError('executor attempted command outside its fixed boundary')

    def pid1_observes_failed_main(self):
        # Emulated OS boundary only; this is not evidence a real host shuts down.
        if self.guard['FailureAction'] == 'poweroff':
            self.events.append(('independent-guard-poweroff',))
            self.job = 18


class NativeBoundaryLinux(FakeLinux):
    """Production LinuxRunner.run over an injected v255 CLI and file-derived manager.

    Only subprocess/tool ownership checks are mocked. Normal first-enable info
    reaches the production stderr policy unless actual argv contains --quiet.
    """
    def __init__(self, root):
        super().__init__(root)
        self.emissions = []

    def run(self, argv):
        return e.LinuxRunner().run(argv)

    def subprocess_result(self, argv, **_kwargs):
        first_enable = argv in (LEGACY_ENABLE, QUIET_ENABLE) and not self.enabled
        stdout = FakeLinux.run(self, argv)
        stderr = ''
        if first_enable and '--quiet' not in argv:
            stderr = ('Created symlink /etc/systemd/system/timers.target.wants/' + e.TIMER +
                      ' → /etc/systemd/system/' + e.TIMER + '.\n')
        self.emissions.append((argv, stderr))
        return SimpleNamespace(stdout=stdout, stderr=stderr)


class Expiry(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.runner = FakeLinux(Path(self.temp.name))

    def test_future_boot_writes_persists_loads_arms_checks_before_gate(self):
        events = self.runner.events
        original = os.fsync
        def synced(fd):
            events.append(('fsync-dir' if stat.S_ISDIR(os.fstat(fd).st_mode) else 'fsync-file',))
            return original(fd)
        with patch.object(e.os, 'fsync', side_effect=synced):
            result = e.execute(REQUEST, self.runner)
        self.assertTrue(result['expiry_gate'])
        self.assertFalse(result['installed']); self.assertFalse(result['deployable'])
        self.assertEqual(result['probe_mode'], 'injected')
        guard = events.index(('command', e.SHOW_GUARD))
        write = events.index(('ensure-before', e.STATE))
        reload = events.index(('command', (*e.SC, 'daemon-reload')))
        arm = events.index(('command', QUIET_ENABLE))
        verify = events.index(('command', e.SHOW_TIMER))
        self.assertLess(guard, write); self.assertLess(write, reload)
        self.assertLess(reload, arm); self.assertLess(arm, verify)
        for name in (e.STATE, e.SERVICE, e.TIMER):
            begin, end = events.index(('ensure-before', name)), events.index(('ensure-after', name))
            self.assertIn(('fsync-file',), events[begin:end])
            self.assertIn(('fsync-dir',), events[begin:end])
        self.assertNotIn(('command', e.POWEROFF), events)
        self.assertTrue(self.runner.armed)

    def test_expired_first_boot_requests_verified_independent_shutdown_without_state(self):
        self.runner.real = e.epoch_us(e.stamp(REQUEST['expires_at']))
        with self.assertRaises(e.ShutdownRequested): e.execute(REQUEST, self.runner)
        self.assertEqual(list(self.runner.state.iterdir()), [])
        self.assertEqual(list(self.runner.units.iterdir()), [])
        self.assertNotIn(('files',), self.runner.events)
        self.assertLess(self.runner.events.index(('command', e.POWEROFF)),
                        self.runner.events.index(('command', e.SHOW_POWEROFF)))
        self.assertEqual(self.runner.job, 17)

    def test_missing_or_misconfigured_independent_guard_refuses_before_deadline_state(self):
        cases = [('LoadState', 'not-found'), ('FailureAction', 'none'), ('User', 'nobody'), ('MainPID', '999'),
                 ('Type', 'simple'), ('TimeoutStartUSec', 'infinity'), ('TimeoutStartUSec', '3min'),
                 ('TimeoutStartFailureMode', 'terminate'), ('KillMode', 'process'), ('Restart', 'always'),
                 ('SuccessExitStatus', 'SIGKILL'), ('RefuseManualStop', 'no'), ('DropInPaths', '/foreign'),
                 ('NeedDaemonReload', 'yes'), ('ActiveState', 'active')]
        for key, value in cases:
            with self.subTest(key=key, value=value):
                original = dict(self.runner.guard); self.runner.guard[key] = value
                try:
                    with self.assertRaises(e.Refused): e.execute(REQUEST, self.runner)
                    self.assertNotIn(('files',), self.runner.events)
                    self.assertEqual(list(self.runner.state.iterdir()), [])
                finally: self.runner.guard = original

    def test_platform_root_pid1_cgroup_namespace_and_unknown_systemd_refuse(self):
        for platform, uid in (('darwin', 0), ('linux', 501)):
            self.runner.platform_name, self.runner.owner = platform, uid
            with self.assertRaises(e.Refused): e.execute(REQUEST, self.runner)
            self.assertEqual(self.runner.events, [])
        self.runner.platform_name, self.runner.owner = 'linux', 0
        for path in ('/proc/1/comm', '/proc/self/cgroup'):
            original = self.runner.kernel[path]; self.runner.kernel[path] = 'foreign\n'
            with self.assertRaises(e.Refused): e.execute(REQUEST, self.runner)
            self.runner.kernel[path] = original
        with patch.object(self.runner, 'namespace', side_effect=['mnt:1', 'mnt:2']):
            with self.assertRaises(e.Refused): e.execute(REQUEST, self.runner)
        self.runner.version = 'systemd 254\n'
        with self.assertRaises(e.Refused): e.execute(REQUEST, self.runner)
        self.assertNotIn(('files',), self.runner.events)

    def test_restart_is_idempotent_and_cannot_extend_or_replace_original_deadline(self):
        e.execute(REQUEST, self.runner)
        before = {p: (p.stat().st_ino, p.read_bytes()) for p in (self.runner.state / e.STATE,
                  self.runner.units / e.SERVICE, self.runner.units / e.TIMER)}
        e.execute(REQUEST, self.runner)
        self.assertEqual(before, {p: (p.stat().st_ino, p.read_bytes()) for p in before})
        changed = dict(REQUEST); changed['expires_at'] = '2026-11-09T16:15:00Z'
        with self.assertRaises(e.ShutdownRequested): e.execute(changed, self.runner)
        self.assertEqual(before, {p: (p.stat().st_ino, p.read_bytes()) for p in before})

    def test_crash_partial_state_can_resume_exact_bytes_under_same_guard(self):
        self.runner.interrupt_at = ('ensure-after', e.STATE)
        self.runner.interrupt_type = SimulatedKill
        with self.assertRaises(SimulatedKill): e.execute(REQUEST, self.runner)
        self.assertTrue((self.runner.state / e.STATE).is_file())
        self.assertFalse(self.runner.armed)
        self.runner.pid1_observes_failed_main()
        self.assertEqual(self.runner.job, 18)
        self.assertIn(('independent-guard-poweroff',), self.runner.events)
        self.runner.job = 0  # Emulate a new boot, after the synthetic guard's poweroff.
        before = (self.runner.state / e.STATE).stat().st_ino
        self.assertTrue(e.execute(REQUEST, self.runner)['expiry_gate'])
        self.assertEqual((self.runner.state / e.STATE).stat().st_ino, before)

    def test_restart_after_deadline_and_expiry_during_setup_never_return_gate(self):
        e.execute(REQUEST, self.runner)
        self.runner.real = e.epoch_us(e.stamp(REQUEST['expires_at']))
        with self.assertRaises(e.ShutdownRequested): e.execute(REQUEST, self.runner)
        self.runner.job = 0
        self.runner.events.clear()
        self.runner.real = e.epoch_us(e.stamp('2026-11-09T15:59:59Z'))
        self.runner.advance_at = ('ensure-after', e.STATE); self.runner.advance_by = 2000000
        with self.assertRaises(e.ShutdownRequested): e.execute(REQUEST, self.runner)
        self.assertIn(('ensure-after', e.STATE), self.runner.events)

    def test_cancellation_before_and_after_arm_never_disarms_timer_or_returns_gate(self):
        for event in (('ensure-before', e.STATE), ('command', e.SHOW_TIMER)):
            with self.subTest(event=event):
                self.runner.job = 0  # Independent synthetic boot; do not short-circuit on the previous shutdown.
                self.runner.events.clear()
                self.runner.interrupt_at, self.runner.interrupt_type = event, KeyboardInterrupt
                with self.assertRaises(e.ShutdownRequested): e.execute(REQUEST, self.runner)
                self.assertEqual(self.runner.job, 17)
                self.assertIn(event, self.runner.events)
        self.assertTrue(self.runner.armed)
        self.assertFalse(any('stop' in value or 'disable' in value for kind, *rest in self.runner.events
                             if kind == 'command' for value in [rest[0]]))

    def test_loaded_manager_properties_are_checked_not_expected_plan_echoes(self):
        cases = [(e.TIMER, 'ActiveState', 'inactive'), (e.TIMER, 'SubState', 'elapsed'),
                 (e.TIMER, 'Persistent', 'no'), (e.TIMER, 'UnitFileState', 'disabled'),
                 (e.TIMER, 'NextElapseUSecRealtime', 'Mon 2026-11-09 16:15:00 UTC'),
                 (e.TIMER, 'TimersMonotonic', '{ OnActiveUSec=4h }'), (e.TIMER, 'AccuracyUSec', '1s'),
                 (e.TIMER, 'OnClockChange', 'no'), (e.TIMER, 'DropInPaths', '/foreign'),
                 (e.SERVICE, 'ExecStart', '{ path=/bin/true ; argv[]=/bin/true ; ignore_errors=no ; }'),
                 (e.SERVICE, 'User', 'nobody'), (e.SERVICE, 'FailureAction', 'none'),
                 (e.SERVICE, 'NeedDaemonReload', 'yes')]
        for unit, key, value in cases:
            with self.subTest(unit=unit, key=key):
                self.runner.job = 0
                self.runner.events.clear()
                self.runner.override = {unit: {key: value}}
                with self.assertRaises(e.ShutdownRequested): e.execute(REQUEST, self.runner)
                self.assertIn(('command', e.SHOW_TIMER if unit == e.TIMER else e.SHOW_SERVICE), self.runner.events)

    def test_time_sync_loss_backward_jump_and_malformed_request_refuse(self):
        self.runner.ntp = 'no'
        with self.assertRaises(e.ShutdownRequested): e.execute(REQUEST, self.runner)
        self.assertNotIn(('files',), self.runner.events)
        self.runner.job = 0
        self.runner.ntp = 'yes'
        self.runner.advance_at = ('ensure-after', e.STATE); self.runner.advance_by = -2000000
        with self.assertRaises(e.ShutdownRequested): e.execute(REQUEST, self.runner)
        for change in ({'expires_at': 'tomorrow'}, {'expires_at': '2026-11-09T20:00:00Z'}, {'run_id': 'bad\nExecStart=/bin/true'}):
            self.runner.job = 0
            request = dict(REQUEST); request.update(change)
            with self.assertRaises(e.ShutdownRequested): e.execute(request, self.runner)

    def test_daemon_reload_arm_and_shutdown_failure_or_cancellation_cannot_false_pass(self):
        for command in ((*e.SC, 'daemon-reload'), QUIET_ENABLE):
            self.runner.job = 0
            self.runner.events.clear()
            self.runner.fail_command = command
            with self.assertRaises(e.ShutdownRequested): e.execute(REQUEST, self.runner)
            self.assertIn(('command', command), self.runner.events)
        self.runner.fail_command = e.POWEROFF
        self.runner.real = e.epoch_us(e.stamp(REQUEST['expires_at']))
        with self.assertRaisesRegex(e.Refused, 'acceptance unverified'): e.execute(REQUEST, self.runner)
        self.runner.fail_command, self.runner.cancel_shutdown = None, True
        with self.assertRaisesRegex(e.Refused, 'acceptance unverified'): e.execute(REQUEST, self.runner)

    def test_untrusted_partial_or_orphaned_deadline_material_never_gets_replaced(self):
        path = self.runner.state / e.STATE
        path.write_bytes(b'{partial'); path.chmod(0o600)
        with self.assertRaises(e.ShutdownRequested): e.execute(REQUEST, self.runner)
        self.assertEqual(path.read_bytes(), b'{partial')
        path.unlink()
        unit = self.runner.units / e.TIMER; unit.write_text('orphan'); unit.chmod(0o600)
        with self.assertRaises(e.ShutdownRequested): e.execute(REQUEST, self.runner)
        self.assertFalse(path.exists()); self.assertEqual(unit.read_text(), 'orphan')

    def test_private_files_reject_symlink_hardlink_bad_mode_and_competing_lock(self):
        with self.runner.files() as files:
            body = b'fixed\n'
            files.ensure(e.STATE, body)
            path = self.runner.state / e.STATE
            path.chmod(0o644)
            with self.assertRaises(e.Refused): files.verify(e.STATE, body)
            path.chmod(0o600)
            other = self.runner.state / 'other'; os.link(path, other)
            with self.assertRaises(e.Refused): files.verify(e.STATE, body)
            other.unlink(); path.unlink(); path.symlink_to(other)
            with self.assertRaises(OSError): files.ensure(e.STATE, body)
            path.unlink()
            with files.locked():
                with self.runner.files() as second:
                    with self.assertRaises(BlockingIOError):
                        with second.locked(): pass

    def test_fsync_error_closes_gate_and_existing_enable_link_is_not_overwritten(self):
        with patch.object(e.os, 'fsync', side_effect=OSError('synthetic failed fsync')):
            with self.assertRaises(e.ShutdownRequested): e.execute(REQUEST, self.runner)
        self.assertFalse(self.runner.armed)
        self.runner.job = 0  # A fresh synthetic boot, not continuation during shutdown.
        e.execute(REQUEST, self.runner)
        link = self.runner.units / 'timers.target.wants' / e.TIMER
        link.unlink(); link.symlink_to('/foreign/timer')
        with self.assertRaises(e.ShutdownRequested): e.execute(REQUEST, self.runner)
        self.assertEqual(os.readlink(link), '/foreign/timer')

    def test_preexisting_shutdown_job_cannot_return_a_future_work_gate(self):
        self.runner.job = 17
        with self.assertRaises(e.ShutdownRequested): e.execute(REQUEST, self.runner)
        self.assertNotIn(('files',), self.runner.events)

    def test_v255_empty_job_and_omitted_empty_monotonic_array_are_not_numeric_echoes(self):
        self.assertIn('Job=\n', self.runner.run(e.SHOW_POWEROFF))
        result = e.execute(REQUEST, self.runner)
        self.assertTrue(result['expiry_gate'])
        self.assertNotIn('TimersMonotonic=', self.runner.run(e.SHOW_TIMER))
        with patch.object(self.runner, 'run', return_value='Id=poweroff.target\nLoadState=loaded\nActiveState=inactive\nJob=0\n'):
            with self.assertRaises(e.Refused): e.no_shutdown_pending(self.runner)

    def test_native_runner_fixed_commands_no_shell_no_inherited_environment(self):
        runner = e.LinuxRunner()
        with patch.object(e.LinuxProbe, 'trusted_tool') as trusted, patch.object(e.subprocess, 'run',
                return_value=SimpleNamespace(stdout='synthetic\n', stderr='')) as run:
            for command in e.COMMANDS:
                runner.run(command)
                self.assertEqual(run.call_args.args, (command,))
                self.assertFalse(run.call_args.kwargs['shell'])
                self.assertEqual(run.call_args.kwargs['env'], {'PATH': '/usr/bin:/usr/sbin', 'LC_ALL': 'C', 'TZ': 'UTC'})
                self.assertEqual(run.call_args.kwargs['timeout'], 5)
                trusted.assert_called_with(command[0])
            before = run.call_count
            for bad in (('/bin/sh', '-c', 'true'), (*e.SC, 'stop', e.TIMER), (*e.SC, 'poweroff', '--force')):
                with self.assertRaises(e.Refused): runner.run(bad)
            self.assertEqual(run.call_count, before)

    def test_v255_first_enable_native_boundary_and_loaded_manager_return_gate(self):
        # This fails on31bd: real LinuxRunner sees normal successful-enable stderr
        # from the CLI model and requests shutdown despite loaded/armed units.
        root = Path(self.temp.name) / 'native-boundary'; root.mkdir(mode=0o700)
        runner = NativeBoundaryLinux(root)
        with patch.object(e.LinuxProbe, 'trusted_tool'), patch.object(e.subprocess, 'run', side_effect=runner.subprocess_result):
            result = e.execute(REQUEST, runner)
        self.assertTrue(result['expiry_gate'])
        self.assertTrue(runner.enabled and runner.armed)
        self.assertIn((QUIET_ENABLE, ''), runner.emissions)
        self.assertNotIn(('command', e.POWEROFF), runner.events)
        self.assertIn(('command', e.SHOW_TIMER), runner.events)

    def test_quiet_enable_native_argv_and_strict_query_warning_policy(self):
        runner = e.LinuxRunner()
        with patch.object(e.LinuxProbe, 'trusted_tool'), patch.object(e.subprocess, 'run',
                return_value=SimpleNamespace(stdout='', stderr='')) as process:
            self.assertEqual(runner.run(QUIET_ENABLE), '')
            self.assertEqual(process.call_args.args, (QUIET_ENABLE,))
            process.return_value = SimpleNamespace(stdout='', stderr='unexpected warning\n')
            for command in (QUIET_ENABLE, e.SHOW_TIMER, e.TIME_QUERY):
                with self.subTest(command=command), self.assertRaisesRegex(e.Refused, 'command output refused'):
                    runner.run(command)
            self.assertEqual(process.call_count, 4)
            with self.assertRaisesRegex(e.Refused, 'command not allowlisted'):
                runner.run(LEGACY_ENABLE)
            self.assertEqual(process.call_count, 4)

    def test_v255_cli_model_emits_first_enable_info_and_retains_manager_effects(self):
        # Independently exercise the CLI model's documented nonquiet behavior;
        # the corrected production allowlist will no longer permit this argv.
        root = Path(self.temp.name) / 'legacy-boundary'; root.mkdir(mode=0o700)
        runner = NativeBoundaryLinux(root)
        bodies = e.material(e.request_record(REQUEST))
        with runner.files() as files:
            for name, body in bodies.items(): files.ensure(name, body)
        runner.subprocess_result((*e.SC, 'daemon-reload'))
        first = runner.subprocess_result(LEGACY_ENABLE)
        self.assertTrue(runner.enabled and runner.armed)
        self.assertTrue(first.stderr.startswith('Created symlink '))
        self.assertEqual(runner.subprocess_result(LEGACY_ENABLE).stderr, '')

    def test_cli_mac_refusal_performs_no_runner_io_and_emits_no_gate(self):
        out, err = io.StringIO(), io.StringIO()
        self.runner.platform_name = 'darwin'
        with patch.object(e, 'LinuxRunner', return_value=self.runner), contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            self.assertEqual(e.main(['--run-id', REQUEST['run_id'], '--prepared-at', REQUEST['prepared_at'],
                                     '--expires-at', REQUEST['expires_at']]), 2)
        self.assertEqual(out.getvalue(), ''); self.assertEqual(self.runner.events, [])
        self.assertIn('no downstream gate', err.getvalue())


if __name__ == '__main__':
    unittest.main()
