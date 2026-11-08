# Local Caddy and release-bundle validation

2026-11-08. Local validation only; no AWS, DNS, or host trust-store calls or changes.

## Exact inputs

The tested Caddyfile was extracted from `UserData.Fn::Base64.Fn::Sub` in the current rendered latency-duel template and matched the single Caddy heredoc in the rendered bootstrap:

```caddyfile
{
    admin off
    servers {
        protocols h1 h2
    }
}
rougehalla.com {
    encode gzip
    @game path /ws /info /ping /healthz
    handle @game {
        reverse_proxy 127.0.0.1:7777
    }
    handle {
        root * /opt/rougehalla/web
        header {
            X-Content-Type-Options nosniff
            Cache-Control no-cache
        }
        @data path /Build/*.data
        header @data Content-Type application/octet-stream
        file_server {
            precompressed gzip
        }
    }
}
```

The configuration hash is SHA-256 `6508797a01c32715ff3a44accf0a9e368d932887026404c1f73ed2d9134796a0`. Exact file: `/Users/nevinmckinnon/.codex/tools/rougehalla-stage2/input-latency-staging-prep/caddy-validation-work/Caddyfile`.

Prepared executable: `/Users/nevinmckinnon/.codex/tools/rougehalla-stage2/input-latency-staging-prep/bundle/bin/caddy`; SHA-256 `762d7763ed8e303d50bf11fb0274627266907ea8c170720d7d9a6fd0b9bf5c65`. It was executed inside Linux ARM64 image `rh-input-latency-rust:23b2e4cf` (Docker Engine 29.2.1, host aarch64), in container `rh-latency-duel-caddy-validate-20261108` with `--network none`, read-only root, read-only mounts for binary/config, and a temporary `/tmp`. `docker run --rm` removed the container after validation.

Command executed:

```sh
/caddy validate --config /Caddyfile --adapter caddyfile
```

Result: exit 0, **Valid configuration**. Caddy logged a formatting warning (`Caddyfile input is not formatted`) and the expected automatic HTTPS/HTTP redirect adaptation. This validation did not rewrite or format the Caddyfile.

## Bundle check

`staging.validate_bundle(path, latency_duel=True)` returned PASS for the exact local release tar:

- `/Users/nevinmckinnon/.codex/tools/rougehalla-stage2/input-latency-staging-prep/release.tar.gz`
- SHA-256 `8c77189316c797d66cb6c5a492ac585fed38c7ee7bd20cc3a7b59e4bff8136eb`
- Required server/Caddy executables and Web entrypoint present; the latency-duel map is included; unsafe paths, links, and special files rejected by the validator were absent; size limit passed.

## Limits

The Caddyfile keeps the practice hostname, admin API disabled, HTTP/2 and HTTP/1 enabled, gzip, same-host static serving, `.data` MIME, and loopback proxy paths. Public exposure remains governed by the rendered stack's TCP 80/443 rules. This local `validate` does not obtain a certificate, resolve or test DNS, open network listeners, exercise WebSocket forwarding or static delivery, verify the public security group, or show that `rougehalla.com` points to a staging host. No Caddy source/config changes, cloud calls, or deployment were made.
