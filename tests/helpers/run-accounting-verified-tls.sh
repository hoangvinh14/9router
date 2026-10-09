#!/usr/bin/env bash
# Isolated owned TLS trust fixture. No machine CA install, disabled verification,
# global environment mutation, registry mutation or live provider traffic.
set -u
umask 077
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
D=$(mktemp -d /tmp/9router-accounting-verified-tls-XXXXXX)
echo "ARTIFACT=$D"
mkdir -p "$D/certs" "$D/home" "$D/data"
trap 'rm -rf "$D/certs"' EXIT
C="$D/certs"
openssl req -x509 -newkey rsa:2048 -nodes -days 1 -subj '/CN=Owned accounting fixture CA' \
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
# NODE_EXTRA_CA_CERTS is read at Node startup. Only this child process trusts the
# private temporary CA; each certificate and key is removed even on test failure.
HOME="$D/home" DATA_DIR="$D/data" ACCOUNTING_TLS_FIXTURE_DIR="$C" NODE_EXTRA_CA_CERTS="$C/ca.pem" \
  timeout 180s npx vitest run --config helpers/verified-tls.vitest.config.js --maxWorkers=1 --no-file-parallelism \
  --reporter=verbose --reporter=json --outputFile="$D/results.json" >"$D/verbose.txt" 2>&1
T=$?; echo "TEST_EXIT=$T"
cd "$ROOT" || exit 1
npx eslint tests/unit/accounting-queued-verified-tls-loopback.fixture.js tests/helpers/verified-tls.vitest.config.js >"$D/lint.txt" 2>&1
L=$?; echo "LINT_EXIT=$L"
git diff --check >"$D/whitespace.txt" 2>&1
W=$?; echo "WHITESPACE_EXIT=$W"
[ "$T" -eq 0 ] && [ "$L" -eq 0 ] && [ "$W" -eq 0 ]
