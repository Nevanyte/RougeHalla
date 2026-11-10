# Read-only Linux retained-device collector

Exact base: `875d94bafeec4fab45d85235ea6358bae51f4227`.
Code commit: `7cbbb255f759430cc84e4018f76d303d5c8b9d3e`.
Branch: `codex/staging-host-device-collector`, reusing the existing clean owned-seat-checkpoint worktree.

Two new source files implement a real Linux collector and synthetic tests. Nothing invokes it from the existing installer foundation yet; all nine previous installer files and their pins/schema are untouched. The new component supplies the canonical physical ancestry check that the old supplied-string comparison could not establish. Future integration must call this collector and retain the separate run-owner, expiry, writer-fence and installation checks; its output alone cannot satisfy those checks.

The lead reviewed the interface/data-source plan before implementation. The CLI is Linux-only and read-only. No real Linux host/block-device probe was run on this Mac. All Linux facts in verification are explicitly synthetic and supplied by an in-memory adapter; mocks exercise native adapter command/open flags without executing a tool or inspecting a real device.

## Interface and collection

`collect_and_validate(expected_volume, probe=None)` consumes the existing four-field volume contract: `id`, canonical `uuid`, `filesystem:ext4`, `mountpoint:/srv/rougehalla-data`. With no injected adapter it uses the production `LinuxProbe`; injection is labeled `probe_mode:injected` in the result. The actual CLI accepts only `--volume-id` and `--uuid`; it fixes the filesystem and mountpoint. It refuses non-Linux platforms before any probe.

Expected values are comparisons, never collection results. The collected facts come from:

| Source | Binding |
|---|---|
| `/proc/self/mountinfo` | Exact root and retained mount, kernel major:minor, filesystem, mount root and read/write options. Root aliases such as `/dev/root` are resolved by kernel identity, not pathname comparison. Missing, stacked or subdirectory mounts refuse. |
| Held directory descriptors | Walk `/`, `srv`, `rougehalla-data` using `O_RDONLY|O_DIRECTORY|O_NOFOLLOW|O_CLOEXEC` and parent `dir_fd`; compare `fstat().st_dev` with mountinfo. Close every descriptor on success/error. |
| `/usr/bin/lsblk --json --tree --paths --output NAME,KNAME,MAJ:MIN,TYPE,PKNAME,FSTYPE,UUID,SERIAL` | Canonical kernel names/identities, filesystem UUID and complete tree/parent edges, including repeated LVM parents. |
| `/sys/dev/block/<major:minor>` | Canonical sysfs path and identity, partition parent or every mapped-device slave; cross-check the complete ancestry edge set with lsblk. Canonical `/dev/<kname>` block-node `st_rdev` must agree. |
| NVMe ancestor `device/serial` | Kernel serial must equal lsblk serial and the expected EBS ID without its hyphen. Data must have exactly one physical NVMe ancestor. |
| `/usr/sbin/blkid -p -o export /dev/<observed-kname>` | Low-level, read-only filesystem probe without cache update. Actual DEVNAME, TYPE, USAGE and UUID must agree with lsblk and the expected UUID. |

The executables and each path ancestor must be root-owned, unwritable by group/others, and symlink-free. No PATH discovery or fallback path exists. Subprocesses use exact tuple argv, `shell=False`, null stdin, captured output, fixed locale/environment and five-second timeouts. File/tool output and graph size/depth have refusal bounds. Tool versions/bytes and the OS still require the separate trusted-host/toolchain release gate.

All physical root/data ancestors are traversed and compared as canonical major:minor sets. Any intersection refuses, including another partition/alias on the same disk, root on the whole disk, or a later LVM slave sharing the data disk. Memoized ancestry traversal avoids repeated exponential work in a shared graph. Data cannot span multiple physical disks under this single-volume contract. Supported graphs are disk, partition directly on disk, and active LVM/crypt device-mapper nodes. Unsupported, incomplete, cyclic, ambiguous or disagreeing graphs refuse. Root filesystems are limited to ext4/xfs; data is ext4. This does not unlock encrypted media or understand arbitrary multi-device filesystems, RAID or multipath.

The entire collection is repeated and must be identical before success. Output is `rh-linux-host-device-observation/1`, with the observed UUID/serial, root/data canonical devices, all physical ancestors, graph and snapshot SHA256. `installed`, `deployable` and `physical_attestation` are always false. It writes no receipt/marker/file and performs no format, mount, install, service, cloud, PostgreSQL, secret or network operation.

## Synthetic verification

The first bounded suite passed **17/17**. Review then added descriptor-based mount walking, memoized ancestry and three focused tests; the final new suite passed **20/20**, with no failures in either run. Raw outputs are [first-offline.txt](first-offline.txt) and [final-offline.txt](final-offline.txt). Both new Python files passed AST parsing, the evidence script passed `bash -n`, and staged whitespace checks passed. No existing preparation/installer suite or broader build was rerun; no dependencies were added.

Tests exercise the actual `collect_and_validate` collector with an injected read-only adapter, not an expected-facts echo. They independently change kernel/lsblk serials and blkid/lsblk UUIDs; even mutually consistent wrong observed values refuse against the expected identity. The CLI's mocked adapter refusal produces exit 2 and no success JSON. Tests also cover:

- Positive dedicated partition, whole volume and mapped data; mapped/multi-disk roots with all ancestors reported; nested lsblk tree and flat repeated-parent forms.
- Root alias/same partition, differently labeled second partition, whole root disk, and a shared non-first LVM slave: all refuse for physical overlap.
- Wrong UUID/serial, absent/read-only/wrong-filesystem/subdirectory/stacked mount, each symlinked mount ancestor, and mismatched mount/block `stat` identities.
- Missing/conflicting/unsupported nodes, kernel-vs-lsblk edge disagreement, cyclic/empty mapped ancestry, multi-disk data, changed snapshots and probe failure.
- Mac/unknown-platform refusal with zero probes; fixed subprocess vectors without shell; descriptor nofollow/read-only flags and cleanup; root-owned unmodifiable tool path enforcement.

Reproduce only the new offline tests, from the worktree root:

```sh
source /Users/nevinmckinnon/.codex/tools/rougehalla-stage2/return-cleanup-2026-11-08/final-env.sh
export CARGO_TARGET_DIR=/Users/nevinmckinnon/.codex/tools/rougehalla-stage2/staging-host-device-state/cargo-target-not-created
export RH_PGTEST_STATE=/Users/nevinmckinnon/.codex/tools/rougehalla-stage2/staging-host-device-state/pg-not-created
export PYTHONDONTWRITEBYTECODE=1
bash -n docs/evidence/staging-host-device-collector/verify.sh
bash docs/evidence/staging-host-device-collector/verify.sh
test ! -e "$CARGO_TARGET_DIR"
test ! -e "$RH_PGTEST_STATE"
shasum -a 256 -c docs/evidence/staging-host-device-collector/SHA256SUMS
```

The script encodes the already-run test/AST commands; packaging did not rerun the suite. [source-audit.json](source-audit.json) records the exact code/base, all nine unchanged installer files, preserved `7b2599aa` and `fe571ce4` refs, and bounded checks. No new worktree or cache was created; the task's Cargo/PG state paths remain absent.

## Remaining actual-host execution gate

Root must separately authorize and run the collector on the real trusted Linux host, with reviewed OS/Python >=3.10 and exact utility paths/tool pins, the intended host mount namespace, real already-initialized ext4 volume and actual expected UUID/EBS volume ID. Capture its bounded JSON and tool/kernel provenance there, and independently confirm AWS volume/account/AZ/encryption/attachment and run ownership. None of that was verified here. A future Linux-only invocation, not run in this packet, is:

```text
python3 tools/staging-full-runtime/installer/host_device.py --volume-id <reviewed-volume-id> --uuid <reviewed-ext4-uuid>
```

Two stable snapshots are observations of the current mount namespace. They do not prevent a subsequent remount/hotplug, prove an uncompromised kernel, attest a physical/cloud identity, establish ownership or hold an installation fence. Before any future mutation/activation, the trusted executor must revalidate while holding its reviewed ownership/writer/device controls; this collector adds none of those actions. Unknown disks remain unformatted. Existing old-writer fencing, fixed expiry, PG/secret provisioning, egress/TLS, real native/account probes, independent offhost restore and cleanup gates remain pending. This is production collector code with synthetic offline verification, not host validation or installer completion.

`SHA256SUMS` covers both new source files and every evidence payload except itself. The handoff gives the evidence commit ID to avoid self-reference. Root owns review/integration; this worker made no merge or push.
