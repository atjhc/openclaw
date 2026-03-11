#!/usr/bin/env bash
# Deploy the current build to the Multipass VM.
# Usage: scripts/deploy-vm.sh [vm-name]
set -euo pipefail

VM="${1:-openclaw}"
TARBALL="openclaw-$(node -p "require('./package.json').version").tgz"

cleanup() { rm -f "$TARBALL"; }
trap cleanup EXIT

pnpm build
pnpm pack

multipass transfer "$TARBALL" "$VM":/tmp/openclaw-deploy.tgz
multipass exec "$VM" -- sudo npm i -g /tmp/openclaw-deploy.tgz
multipass exec "$VM" -- sudo systemctl restart openclaw-gateway

echo "Deployed to $VM — verifying gateway status:"
multipass exec "$VM" -- sudo systemctl status openclaw-gateway --no-pager | head -8
