"""Static producer diagnostics: never serialize exception messages, commands or captured output."""
import contextlib
import json
import os
import stat
import subprocess

from component import Refused

STAGES = frozenset(('cli', 'source-selection', 'source-inputs', 'ci-context', 'toolchain-install',
                    'toolchain-identity', 'cargo-build', 'cargo-output-copy', 'staged-binary',
                    'database-fresh', 'server-start', 'http-ready', 'http-info', 'database-boundary',
                    'server-stop', 'database-final', 'source-recheck', 'manifest-build', 'archive-create', 'archive-verify'))
REFUSALS = {
    'invalid producer CLI': 'cli_arguments',
    'component archive required': 'archive_argument',
    'harness checkout required': 'harness_argument',
    'source/harness/new output required': 'producer_arguments',
    'producer is restricted to Linux x86_64 GitHub jobs': 'unsupported_runtime',
    'actual GitHub Actions context required': 'github_context',
    'reviewed canonical workflow ref required': 'canonical_ref',
    'only actual manual or push events are allowed': 'event_name',
    'push must build the actual full GitHub SHA': 'push_sha',
    'push payload mismatch; manual event spoof refused': 'push_payload',
    'actual push event payload required': 'push_payload_missing',
    'exact lowercase identity required': 'identity_format',
    'selected SHA must be a commit': 'selected_commit_type',
    'exact selected SHA required': 'selected_commit_identity',
    'selected commit is not reachable from fetched optimization_port': 'selected_commit_ancestry',
    'source checkout is not selected commit': 'source_head',
    'source checkout must remain clean': 'source_dirty',
    'source must pin one exact stable Rust toolchain': 'toolchain_pin',
    'runner must already provide rustup and psql; no package install fallback': 'runner_tools_missing',
    'bounded single-link regular file required': 'strict_regular_file',
    'noncanonical input path': 'input_path',
    'executable mode required': 'executable_mode',
    'file changed while reading': 'file_changed',
    'owned Cargo directory required': 'cargo_directory',
    'owned bounded regular Cargo executable required': 'cargo_output_policy',
    'Cargo output changed while copying': 'cargo_output_changed',
    'incomplete staged executable write': 'copy_incomplete',
    'staged executable identity mismatch': 'copy_identity',
    'bounded ELF executable required': 'elf_size',
    'Linux/SystemV little-endian ELF64 required': 'elf_format',
    'invalid x86_64 ELF program headers': 'elf_headers',
    'ELF segment outside file': 'elf_segment',
    'ELF load segment truncated': 'elf_truncated',
    'unsupported ELF interpreter': 'elf_interpreter',
    'ELF entry is not in an executable load segment': 'elf_entry',
    'CI database is not fresh': 'database_not_fresh',
    'native process exited before readiness': 'server_early_exit',
    'bounded native readiness timed out': 'readiness_timeout',
    'loopback readiness redirect refused': 'http_redirect',
    'GET readiness allowlist': 'http_endpoint',
    'readiness HTTP status refused': 'http_status',
    'readiness response exceeds bound': 'http_size',
    'unexpected/missing manifest fields': 'manifest_shape',
    'invalid observed protocol': 'protocol_value',
    'unexpected readiness runtime state': 'runtime_state',
    'readiness must have no rooms/players/results': 'runtime_not_empty',
    'actual PostgreSQL readiness required': 'postgres_readiness',
    'fresh database must have zero account/result rows': 'database_not_empty',
    'native health refused': 'health_value',
    'owned readiness process did not stop within grace': 'server_stop_timeout',
    'native readiness process did not stop cleanly': 'server_stop_status',
    'database changed during native shutdown': 'database_changed',
    'readiness elapsed bound exceeded': 'readiness_elapsed',
    'executed binary bytes changed': 'executed_binary_changed',
    'source identities changed during build': 'source_inputs_changed',
    'component only; not a deployable bundle': 'component_gate',
    'exact locked release build required': 'build_identity',
    'bounded nonsecret toolchain identity required': 'toolchain_identity',
    'toolchain/host mismatch': 'toolchain_host',
    'actual GNU libc identity required': 'libc_identity',
    'binary identity mismatch': 'binary_identity',
    'bounded real PostgreSQL16 readiness/clean stop required': 'runtime_receipt',
    'manifest exceeds bound': 'manifest_size',
    'symlinked output parent refused': 'archive_parent',
    'malformed/truncated native component': 'archive_malformed',
    'noncanonical/truncated/trailing archive bytes': 'archive_canonical',
    'archive exceeds bound': 'archive_size',
    'archive member exceeds bound': 'archive_member_size',
    'exact regular binary and manifest only; no links/extra/traversal': 'archive_members',
    'manifest must be canonical': 'manifest_canonical',
    'duplicate JSON key': 'json_duplicate',
    'nonfinite JSON': 'json_nonfinite',
    'command output exceeds bound': 'command_output_size',
}


def failure_code(error):
    if isinstance(error, Refused):
        message = error.args[0] if error.args else None
        return REFUSALS.get(message, 'refused_unclassified') if type(message) is str else 'refused_unclassified'
    if isinstance(error, subprocess.TimeoutExpired): return 'command_timeout'
    if isinstance(error, subprocess.CalledProcessError): return 'command_failed'
    if isinstance(error, FileNotFoundError): return 'file_missing'
    if isinstance(error, FileExistsError): return 'file_exists'
    if isinstance(error, PermissionError): return 'permission_denied'
    if isinstance(error, OSError): return 'os_error'
    if isinstance(error, (KeyboardInterrupt, SystemExit)): return 'cancelled'
    if isinstance(error, (ValueError, UnicodeError)): return 'data_encoding'
    if isinstance(error, (KeyError, TypeError)): return 'data_shape'
    return 'unexpected_exception'


class Diagnostics:
    def __init__(self, stream=None):
        self.stream, self.current = stream, 'cli'
        self.first_failure = None
        self.binaries = {}

    def emit(self, event, **fields):
        if self.stream is not None:
            print(json.dumps({'format': 'rh-native-diagnostic/1', 'stage': self.current,
                              'event': event, **fields}, sort_keys=True), file=self.stream, flush=True)

    @contextlib.contextmanager
    def stage(self, name):
        if name not in STAGES: raise Refused('invalid diagnostic stage')
        previous, self.current = self.current, name
        self.emit('enter')
        try:
            yield
        except BaseException as error:
            if self.first_failure is None: self.first_failure = (name, failure_code(error))
            raise
        finally:
            self.current = previous

    def binary(self, label, info):
        if label not in ('cargo', 'staged'): raise Refused('invalid diagnostic binary label')
        facts = {'kind': 'regular' if stat.S_ISREG(info.st_mode) else 'symlink' if stat.S_ISLNK(info.st_mode) else 'other',
                 'mode': format(stat.S_IMODE(info.st_mode), '04o'), 'nlink': info.st_nlink,
                 'bytes': info.st_size, 'owned_by_runner': info.st_uid == os.geteuid()}
        self.binaries[label] = facts
        self.emit('binary_observed', binary_label=label, binary=facts)

    def process_exit(self, status):
        if type(status) is int and -255 <= status <= 255: self.emit('process_exit', exit_status=status)

    def failure(self, error):
        stage, code = self.first_failure or (self.current, failure_code(error))
        self.current = stage
        self.emit('failure', failure_code=code, binary_metadata=self.binaries)
