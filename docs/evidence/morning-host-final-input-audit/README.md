# Morning host final-input compatibility audit

**Finding: no hard-coded host identity rejects the planned wire-16/internal-version union.** The host reads protocol
and content identity from the reviewed executable and requires exact equality to immutable launch config. One launch
README sentence is stale relative to the current primary's hitbox default. The current staging artifact is an older,
nondeployable native component, not the final host bundle. This was a read-only audit at backend integration
`924eb7253b3e80e544ce19968dced5d607592df7` and clean primary `bb0c1cad790cbba729d3a8d8ddafe6abecc93eb8`; no AWS
or other service call, credential read, build, test, source capture, or checkout edit was performed.

## Identity compatibility

| Surface | Current behavior | Effect on planned union |
| --- | --- | --- |
| `hosting/technical-demo/bootstrap.py:29-44` config | Requires exact keys; `protocol` is an actual non-boolean Python integer in `1..=65535`; `content_hash` is exactly 16 lowercase hex characters. Example `protocol: 0` and hash placeholder are deliberately invalid sentinels (`config.example.json:9-10`). | No old protocol/hash is embedded in production config validation. Use wire protocol `16` and the final binary's actual content hash in the later Root-reviewed config. |
| `bootstrap.py:301-316` readiness | Checks both `/readyz` and `/info`; requires the returned protocol to be an integer in range and exactly equal configured `protocol`, and `contentHash` exactly equal configured `content_hash`. It runs for Source and Training checks. | A mismatched old binary fails closed. A matching final binary is accepted without a version-specific code edit. |
| Server `/info` (`crates/rh-server/src/director.rs:1304-1317`; route `crates/rh-server/src/lib.rs:97-99`) | Emits `rh_protocol::PROTOCOL_VERSION` and `rh_sim::content::content_hash()` formatted as 16 lowercase hex. `content_hash()` is the current rules identity (`crates/rh-sim/src/content.rs:452-456`). | Root can bind launch config to actual compiled bytes. The host must not use an old captured `7c6a...` or a branch-tip value as a substitute for the final union binary's `/info`. |
| Checkpoint/replay/observation/policy formats | No references to these internal format constants or tags occur in `hosting/technical-demo`, `tools/staging-native-artifact`, or its workflow. They are not config fields or `/info` fields. | Proposed internal versions `31/25/23/17` do not need to be added to the host config or readiness gate. Native code owns those formats. The host starts with a fresh PG data directory; this bootstrap does not import old checkpoints/replays. |
| Existing offline config test (`hosting/technical-demo/test_offline.py:17-18,43-94`) | Its positive synthetic fixture uses protocol `14` and content `7c6a633f68c2cc72`; boundary tests reject malformed/stale values. Production code's validation remains generic. | This fixture is not a default or deployed identity and does not make protocol 16 fail. Do not promote it into a real launch config or final artifact receipt. |

The one documentation mismatch is `hosting/technical-demo/README.md:129-132`: it says the current runtime is protocol 14 and describes `--hitboxes` as unsupported. The current primary is clean at `bb0c1cad`, protocol 16 (`crates/rh-protocol/src/lib.rs:176`), and its live runtime default is `HitboxMode::Archetypes` (`crates/rh-server/src/runtime.rs:23-30,156`; the default flip is in `e438c100`). The bootstrap does not pass a `--hitboxes` option (`bootstrap.py:213-225`), so Source and Training inherit the current live default; the current runtime tests pin those profiles and preserve LegacyCircle for bare core (`runtime.rs:260-321`). This is not a launch-code mismatch. Before the final launch review, update that README wording to describe wire 16 and the already-flipped live default, while retaining the requirement to verify the exact merged binary and runtime. No extra flag is needed when the final runtime keeps this default.

## Staging artifact boundary

The staging workflow is a manual, read-only native-component producer on `optimization_port` with an explicit exact
source commit (`.github/workflows/staging-native-artifact.yml:1-18,34-57`). `tools/staging-native-artifact/component.py:105-116`
checks observed `/info` protocol as a valid u16 and content hash as 16 lowercase hex; it has no literal `14`, old
internal version, or old content hash. The selected build's observed values are carried into its manifest. The
artifact is explicitly `deployable:false` and contains only `bin/rh-server` plus `component.json`
(`component.py:15,119-124`; `tools/staging-native-artifact/README.md:23-36`).

That component archive cannot serve as the final host artifact. The host README explicitly says the full public
bundle is separate and must not be replaced by the component tar (`hosting/technical-demo/README.md:68-83`). Previous
staging receipts showing protocol 14/content `7c6a...` are historical evidence of that earlier selected commit, not
the forthcoming union's identity. The staging verifier is useful only for its own component archive; it does not
produce the map, Unity Web tree, or full-host manifest.

## Exact final bundle inputs already specified

The existing host contract gives the exact artifact boundary (`hosting/technical-demo/README.md:68-99`, enforced by
`bootstrap.py:47-85`):

1. `rh-server`: reviewed Linux x86-64 executable built with the PostgreSQL feature for the final combined source.
2. `source-map.json`: the complete reviewed Source map. The existing full-runtime admission identifies the canonical
   source export as `parity/arena/source.json` at `.map.export` and documents extracting that export
   (`docs/evidence/full-runtime-admission/README.md:44-50`). Refresh this input from the final reviewed map/source
   cut and bind its exact bytes; the container checks member hashes, not semantic map provenance.
3. `web/index.html` plus the complete reviewed Web output tree. The existing `client-unity/UnityProject/Tools/build-web.sh`
   obtains `contentHash` from a running `/info`, writes the corresponding `BakedContent.cs`, then invokes the pinned
   Unity Editor build (`client-unity/UnityProject/Tools/build-web.sh:1-24,25-56`; usage
   `client-unity/README.md:69`). For the final package, the `/info` endpoint must be the exact final combined binary;
   then package the complete resulting Web directory without carrying a stale primary bake.
4. `bundle-manifest.json`: lowercase SHA-256 for every other exact relative path, no missing/extra member. The full
   tar SHA goes in the separate config and is distinct from both the server content hash and the per-file manifest.

`bootstrap.py:51-81` refuses paths outside `rh-server`, `source-map.json`, `bundle-manifest.json`, and `web/**`,
requires all three root files plus `web/index.html`, exact inventory equality, and per-member hash matches. The
sample `test_offline.py` archive uses synthetic bytes and is only a validator unit fixture; it is not a packaging
recipe. No full-host bundle producer was present among the inspected staging files. The existing README specifies
the package contract; Root must prepare the reviewed actual binary/map/Web files and their manifest under that
contract, without treating the smaller component archive as the finished bundle.

## Existing local preflight tools and actionable gap

- The host contract's offline checks are the existing `hosting/technical-demo/test_offline.py` and `test_stack.py`
  (README `:177-190`; prior offline receipt is `docs/evidence/morning-host-preparation/`). They validate strict
  configuration, `/readyz` and `/info` gates, archive inventory/hash refusal, rendered systemd/configuration and
  stack scope. They do not build a real binary/bundle, start a host, or substitute for actual public TLS/browser
  validation.
- `hosting/technical-demo/render.py` locally renders user data from the exact reviewed `bootstrap.py` bytes and
  nonsecret config; the README provides its invocation at `:85-99`. At release, config `protocol`/`content_hash`
  must be sourced from the exact bundled binary's `/info`, and config `sha256` from the exact full tar. These values
  are immutable for the launch, with the original absolute expiry unchanged on reboot.
- The current staging workflow's artifact has no full web/map bundle and is tagged nondeployable. No source code
  currently blocks the planned identities. The only actionable preparation issue found is to replace the stale
  protocol-14/unsupported-hitboxes wording in the host README and to keep final bundle inputs distinct from the old
  component artifact and historical `14`/`7c6...` receipts.

No shared status, host/config/tool/workflow/source file, primary checkout, artifact, or service was changed by this
audit. No AWS CLI or credentials were accessed.


## Follow-up wording correction

The launch-default paragraph above was stale and has now been corrected in
`hosting/technical-demo/README.md`. The scripts still omit `--hitboxes`; do not
add that flag as part of this documentation correction. At the audited
integration cut, protocol 14 remains current and has no such parser option.
The incoming reviewed primary at `e438c100` is protocol 16 and provides the
option, with Archetypes as the live runtime default and LegacyCircle retained
for bare-core `SimConfig`. The final exact combined binary must be checked for
its parser and runtime default before preparing launch config. This correction
does not claim that protocol 16 is integrated or deployed, and leaves the
existing historical test/config and artifact evidence unchanged.
