#!/usr/bin/env bash
set -euo pipefail

apt update
apt install -y curl build-essential python3 make g++ git ufw

if ! command -v node >/dev/null 2>&1; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt install -y nodejs
fi

npm install
npm run build

echo "Install completed. Copy .env.example to .env and update MEDIASOUP_ANNOUNCED_IP + TURN settings."
