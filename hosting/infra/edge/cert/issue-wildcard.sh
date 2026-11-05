#!/usr/bin/env bash
# Wildcard certificate for the game hostnames (`*.g.rougehalla.com`) via Let's Encrypt DNS-01 using the pinned `lego` image.
# DRY RUN BY DEFAULT: prints the commands and touches nothing. Nothing in this repository has run it.
#
#   hosting/infra/edge/cert/issue-wildcard.sh                 # print the staging-CA plan
#   hosting/infra/edge/cert/issue-wildcard.sh --production    # print the production-CA plan
#   hosting/infra/edge/cert/issue-wildcard.sh --run [--production]
#       needs RH_EDGE_ALLOW_CERT_ISSUE=yes, CLOUDFLARE_DNS_API_TOKEN (a token separate from the placement service's; TXT edits
#       on rougehalla.com), LEGO_EMAIL; it creates _acme-challenge TXT records in the practice zone and removes them afterwards.
#
# The staging CA (default) issues certificates browsers do NOT trust: use it to prove the DNS-01 path, never to test browsers.
# lego flags below were checked against `goacme/lego:v4.25.2 --help` on 2026-11-05. Let's Encrypt limits and lifetimes:
# docs/hosting/TLS_DNS.md section 4.
set -euo pipefail

ZONE="${RH_EDGE_ZONE:-g.rougehalla.com}"
IMAGE="goacme/lego:v4.25.2"
CA_STAGING="https://acme-staging-v02.api.letsencrypt.org/directory"
CA_PROD="https://acme-v02.api.letsencrypt.org/directory"
OUT="${RH_EDGE_CERT_DIR:-$PWD/target/edge-cert}"
RUN=0; CA="$CA_STAGING"; CANARY="staging"
for a in "$@"; do
  case "$a" in
    --run) RUN=1 ;;
    --production) CA="$CA_PROD"; CANARY="production" ;;
    *) echo "unknown argument $a" >&2; exit 2 ;;
  esac
done

case "$ZONE" in
  *.rougehalla.com|rougehalla.com) ;;
  *) echo "refusing zone '$ZONE': only the practice domain rougehalla.com is allowed (never roguehalla.com)" >&2; exit 2 ;;
esac

LEGO=(docker run --rm
  -v "$OUT:/data"
  -e CLOUDFLARE_DNS_API_TOKEN -e LEGO_EMAIL
  "$IMAGE"
  --accept-tos --path /data --server "$CA" --dns cloudflare --key-type ec256
  --dns.propagation-wait 30s
  --domains "*.$ZONE")

echo "== plan ($CANARY CA, zone $ZONE, output $OUT) =="
show() { printf '%q ' "$@"; echo; }
printf '1. '; show "${LEGO[@]}" run
echo "2. aws secretsmanager put-secret-value --secret-id rh/edge/wildcard-cert --secret-string file://\$OUT/bundle.json   # fullchain + key; needs an AWS credential (not on this machine)"
printf '3. renewal (every ~30 days; see TLS_DNS.md): '; show "${LEGO[@]}" renew --days 30
echo "Certificate files would appear as $OUT/certificates/_.$ZONE.{crt,key}"

if [ "$RUN" -ne 1 ]; then
  echo "(dry run: nothing executed. Add --run with RH_EDGE_ALLOW_CERT_ISSUE=yes after review.)"
  exit 0
fi
[ "${RH_EDGE_ALLOW_CERT_ISSUE:-}" = "yes" ] || { echo "refusing --run: set RH_EDGE_ALLOW_CERT_ISSUE=yes after the change was reviewed" >&2; exit 2; }
: "${CLOUDFLARE_DNS_API_TOKEN:?missing}" "${LEGO_EMAIL:?missing}"
mkdir -p "$OUT"
"${LEGO[@]}" run
