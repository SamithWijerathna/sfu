#!/usr/bin/env bash
set -euo pipefail

ufw allow 3850/tcp
ufw allow 3478/tcp
ufw allow 3478/udp
ufw allow 50000:60000/udp
ufw allow 50000:60000/tcp
ufw allow 49152:65535/udp
ufw reload

echo "Firewall opened for backend, mediasoup media ports, and TURN relay ports."
