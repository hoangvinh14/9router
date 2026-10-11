#!/usr/bin/env bash
# Disposable private CA, startup-only Node trust; no insecure TLS or machine CA.
set -u
umask 077
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
D=$(mktemp -d /tmp/9router-fusion-verified-tls-XXXXXX)
printf 'ARTIFACT=%s\n' "$D"
mkdir -p "$D/certs" "$D/home" "$D/data"
trap 'rm -rf "$D/certs"' EXIT
C="$D/certs"
openssl req -x509 -newkey rsa:2048 -nodes -days 1 -subj '/CN=Owned Fusion accounting fixture CA' \
  -addext 'basicConstraints=critical,CA:TRUE' -addext 'keyUsage=critical,keyCertSign,cRLSign' \
  -keyout "$C/ca.key" -out "$C/ca.pem" >"$D/certificate-generation.txt" 2>&1 || exit 1
for ID in matching mismatch; do
  if [ "$ID" = matching ]; then SAN='IP:127.0.0.1'; else SAN='DNS:fixture-mismatch.invalid'; fi
  printf 'basicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\nsubjectAltName=%s\n' "$SAN" >"$C/$ID.ext"
  openssl req -new -newkey rsa:2048 -nodes -subj "/CN=$ID fixture" -keyout "$C/$ID.key" -out "$C/$ID.csr" >>"$D/certificate-generation.txt" 2>&1 || exit 1
  openssl x509 -req -in "$C/$ID.csr" -CA "$C/ca.pem" -CAkey "$C/ca.key" -CAcreateserial -days 1 \
    -extfile "$C/$ID.ext" -out "$C/$ID.pem" >>"$D/certificate-generation.txt" 2>&1 || exit 1
done
cd "$ROOT/tests" || exit 1
test -f unit/accounting-queued-fusion-loopback.test.js || exit 2
HOME="$D/home" DATA_DIR="$D/data" JWT_SECRET=fixture-only API_KEY_SECRET=fixture-only INITIAL_PASSWORD=fixture-only \
  FUSION_TLS_FIXTURE_DIR="$C" NODE_EXTRA_CA_CERTS="$C/ca.pem" \
  timeout 180s ./node_modules/.bin/vitest run --config helpers/fusion-verified-tls.vitest.config.js \
  --maxWorkers=1 --no-file-parallelism --reporter=verbose --reporter=json --outputFile="$D/results.json" >"$D/test.log" 2>&1
T=$?; printf 'TEST_EXIT=%s\n' "$T"
cd "$ROOT" || exit 1
timeout 30s ./node_modules/.bin/eslint tests/unit/accounting-queued-fusion-loopback.test.js tests/helpers/fusion-verified-tls.vitest.config.js >"$D/lint.log" 2>&1
L=$?; printf 'LINT_EXIT=%s\n' "$L"
git diff --check >"$D/whitespace.log" 2>&1
W=$?; printf 'WHITESPACE_EXIT=%s\n' "$W"
[ "$T" -eq 0 ] && [ "$L" -eq 0 ] && [ "$W" -eq 0 ]
