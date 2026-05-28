#!/usr/bin/env bash
set -euo pipefail
curl -4 https://ifconfig.me || curl -4 https://api.ipify.org || true
