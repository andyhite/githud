#!/usr/bin/env bash
# Create a stable, self-signed code-signing identity for LOCAL macOS builds.
#
# Why: githud stores its secrets (GitHub PAT, Anthropic key) via Electron
# `safeStorage`, which keeps its encryption key in the login Keychain behind an
# ACL bound to the app's *code signature*. An unsigned / ad-hoc build gets a new
# signature every time it's rebuilt, so the running app is treated as a new
# program and macOS re-prompts for your password to reach that Keychain item.
# Signing every build with the SAME identity gives the app one stable designated
# requirement, so the ACL persists and the prompt stops.
#
# This is a local-only convenience: a self-signed cert is enough to keep the
# signature stable on one machine. It is NOT a Developer ID and does not notarize
# or clear Gatekeeper for distribution.
#
# Run once:  pnpm run signing:cert   (or: bash build/make-signing-cert.sh)
# Then sign builds with:  pnpm run package:signed
set -euo pipefail

CERT_NAME="${GITHUD_SIGNING_IDENTITY:-githud Local Signing}"
KEYCHAIN="$HOME/Library/Keychains/login.keychain-db"

if [[ "$(uname)" != "Darwin" ]]; then
  echo "This script is macOS-only (code-signing identities live in the Keychain)." >&2
  exit 1
fi

if security find-identity -v -p codesigning "$KEYCHAIN" | grep -qF "$CERT_NAME"; then
  echo "✓ '$CERT_NAME' already exists and is valid for code signing — nothing to do."
  exit 0
fi

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

# 1. Self-signed leaf cert with the code-signing EKU. A config file (rather than
#    -addext) keeps this working on both OpenSSL and the system LibreSSL.
cat > "$tmp/openssl.cnf" <<EOF
[req]
distinguished_name = dn
x509_extensions     = v3_codesign
prompt              = no
[dn]
CN = $CERT_NAME
[v3_codesign]
basicConstraints     = critical,CA:false
keyUsage             = critical,digitalSignature
extendedKeyUsage     = critical,codeSigning
EOF

openssl req -x509 -newkey rsa:2048 -nodes -days 3650 \
  -keyout "$tmp/key.pem" -out "$tmp/cert.pem" -config "$tmp/openssl.cnf" >/dev/null 2>&1

# 2. Bundle key + cert into a passwordless PKCS#12 for import.
openssl pkcs12 -export -inkey "$tmp/key.pem" -in "$tmp/cert.pem" \
  -out "$tmp/identity.p12" -passout pass: -name "$CERT_NAME" >/dev/null 2>&1

# 3. Import into the login keychain; -T whitelists codesign on the private key's
#    ACL so signing doesn't prompt for the key on every build.
security import "$tmp/identity.p12" -k "$KEYCHAIN" -P "" \
  -T /usr/bin/codesign -T /usr/bin/security >/dev/null

# 4. Trust the cert for the code-signing policy so it shows up as *valid* in
#    `security find-identity -v -p codesigning`. macOS shows ONE GUI prompt here
#    asking for your login password to change trust settings — that's expected.
echo "→ Approve the 'change your Certificate Trust Settings' prompt (login password)…"
security add-trusted-cert -p codeSign -k "$KEYCHAIN" "$tmp/cert.pem"

# 5. Best-effort: let codesign use the key non-interactively. Needs the login
#    keychain password; if it can't run silently the first `package:signed` will
#    just show one 'codesign wants to use a key' prompt — click 'Always Allow'.
security set-key-partition-list -S apple-tool:,apple:,codesign: -s -k "" "$KEYCHAIN" >/dev/null 2>&1 || true

echo
if security find-identity -v -p codesigning "$KEYCHAIN" | grep -qF "$CERT_NAME"; then
  echo "✓ created code-signing identity: '$CERT_NAME'"
  echo "  Now build with:  pnpm run package:signed"
else
  echo "⚠ '$CERT_NAME' was imported but isn't showing as a valid signing identity." >&2
  echo "  Open Keychain Access → log in keychain, find the cert, set 'Code Signing: Always Trust'." >&2
  exit 1
fi
