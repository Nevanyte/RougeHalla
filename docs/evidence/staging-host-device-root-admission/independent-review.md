# Host-device collector: finite source/offline review

**SOURCE + OFFLINE EVIDENCE RELEASE**, code `7cbbb255f759430cc84e4018f76d303d5c8b9d3e`, evidence child `51285bb60cae84bc0bfec4fab14a5efc37d5daf5`, exact base `875d94bafeec4fab45d85235ea6358bae51f4227`. No concrete in-scope blocker found. This does not admit actual host identity, tool execution, installer activation or physical/cloud attestation.

Reviewed immutable Git blobs only in owned-seat-checkpoint/repo. No real Linux/Mac probe, collector/test/Node/Cargo/Editor execution, network/cloud call, secret access, cache or source/main mutation.

## Pins and evidence

Verified all **seven manifest payloads /53258B**, SHA256SUMS SHA256 **d5111999f1aca41fd70e558b7bde73df6011d5d3e5e91b27e6701febc588f88d**. Exactly eight added paths from base: two source files and six evidence paths including manifest. All nine previous installer source files match base bytes and audit pins; final collector/test bytes match the code commit. No existing installer operation is wired to call this new collector.

Final raw log: **20 synthetic PASS**,0FAIL,0.008s. First17-pass log is retained as historical earlier development state, not relabeled as final20. Source-audit records two AST checks, evidence-script bash syntax and whitespace checks; verify.sh contains those bounded commands. Reviewer did not rerun them. Native adapter mocks prove argument/open/mode/descriptor behavior without running a real tool or reading real devices.

Controls meaningfully exercise actual collect_and_validate with independently mutable synthetic mountinfo/sysfs/block-stat/lsblk/blkid facts. Kernel-only, lsblk-only and mutually consistent wrong serials/UUIDs refuse against expected values. Positive whole disk/partition/mapped data and nested/flat lsblk forms coexist with negative alias/root-partition/non-first mapper overlap, multi-disk data, malformed/cyclic/missing/disagreeing graphs, symlinks, changed snapshots and CLI no-success-output controls. Expected labels are not echoed as collected proof.

## Source assessment

Non-Linux refusal occurs before collection. Native commands use exactly the fixed absolute lsblk vector and readonly low-level blkid vector plus canonical observed /dev/kname; no shell, PATH lookup or fallback. Executable and ancestor lstat checks require root-owned, non-group/world-writable, canonical directories/regular executable. Env/locale/cwd/stdin and five-second timeout are explicit. Actual tool versions/bytes remain separately unverified.

Mount directory traversal holds readonly O_DIRECTORY|O_NOFOLLOW|O_CLOEXEC descriptors across each parent-relative open and obtains fstat; descriptors close in finally, including partial failure. Mountinfo major:minor must match directory st_dev. Device lstat must be a block node with matching st_rdev. Sysfs canonical path/dev identity, partition-parent identity and **every** mapper slave are cross-checked against the complete lsblk edge set; unsupported/deep/cyclic/missing/ambiguous relationships refuse.

Memoized physical ancestry includes all root/data leaves, not just first parents. Any canonical physical-device intersection refuses; data must have exactly one physical NVMe ancestor. That ancestor's actual kernel serial and lsblk serial must both equal the expected EBS ID form. Actual low-level blkid UUID/ext4/filesystem usage must agree with lsblk and expected UUID. Here “one dedicated ancestor” describes this observed supported device graph, not a uniqueness attestation over every cloud attachment or all unmounted disks.

The entire observation, including raw kernel/tool text and descriptor identities, is repeated and compared before returning. It is a stable two-sample observation, not an atomic held mount/ownership fence. Supported graphs/filesystems are intentionally narrow; unrelated unsupported lsblk device types can also cause refusal rather than silently broadening support. No formatting/mounting/writer/service operation exists; output explicitly sets installed/deployable/physical_attestation false.

## Precise limits to retain

The4MiB subprocess output check happens **after subprocess.run captures stdout/stderr**. It is a post-capture size/refusal bound, not a streaming hard memory cap; file text length is likewise a character bound. Do not turn this into a measured bounded-RSS/performance claim. This is not an in-scope activation blocker with trusted utilities and no service integration, but any future hard resource ceiling needs bounded streaming capture or a suitably narrow declared domain.

Mountinfo rejects subdirectory mount roots and duplicate target records; this should not be generalized to proof that every possible full-filesystem bind is distinguishable or impossible. Physical separation is established from the checked graph rather than mount-source pathname labels.

Actual trusted Linux/kernel/utility bytes, intended mount namespace, real volume/UUID/account/AZ/encryption/attachment/run ownership remain unverified. Future writer/mount/device fencing and revalidation are still required before mutation, as already documented; two snapshots do not prevent later hotplug/remount. Existing fixed expiry, private PG/secret/egress/TLS/runtime/backup/restore/cost gates remain held. This release adds a source-reviewed readonly collector with synthetic controls, not actual host recovery or installation success.
