# Meetra Self-Hosted SFU Backend

This is a self-hosted Node.js SFU signaling backend for a meeting app.

It does **not** use LiveKit Cloud, Twilio, Google, or any external API key.

It uses:

- **Node.js + Express** for HTTP API
- **Socket.IO** for signaling
- **mediasoup** as the SFU media engine
- **coturn** as the optional STUN/TURN fallback server

You still need to set your own server public IP/domain and TURN password. Those are not third-party API keys.

---

## 1. Requirements

Recommended server:

- Ubuntu 22.04 or 24.04
- Node.js 22+
- Public IPv4 address
- Open firewall ports

Recommended DNS:

```txt
sfu.meet.cloudwave.asia   -> your VPS public IP
turn.meet.cloudwave.asia  -> your VPS public IP
```

---

## 2. Install backend

```bash
cd /opt
unzip meetra-selfhosted-sfu.zip
mv meetra-selfhosted-sfu meetra-sfu
cd /opt/meetra-sfu

cp .env.example .env
nano .env
```

Edit these values:

```env
FRONTEND_ORIGIN=https://meet.cloudwave.asia,http://localhost:3000
MEDIASOUP_ANNOUNCED_IP=YOUR_SERVER_PUBLIC_IP
TURN_HOST=turn.meet.cloudwave.asia
TURN_USERNAME=meetra
TURN_PASSWORD=change_this_strong_turn_password
INTERNAL_API_SECRET=CHANGE_THIS_INTERNAL_SECRET
```

Install and build:

```bash
npm install
npm run build
npm start
```

For development:

```bash
npm run dev
```

Check:

```bash
curl http://127.0.0.1:3850/health
```

---

## 3. Open firewall

```bash
sudo ./scripts/open-firewall.sh
```

Manual ports:

```bash
sudo ufw allow 3850/tcp
sudo ufw allow 3478/tcp
sudo ufw allow 3478/udp
sudo ufw allow 50000:60000/udp
sudo ufw allow 50000:60000/tcp
sudo ufw allow 49152:65535/udp
sudo ufw reload
```

If your cloud provider has an external firewall, open the same ports there too.

---

## 4. Start TURN server

Edit coturn config:

```bash
nano deploy/coturn/turnserver.conf
```

Change:

```txt
realm=turn.meet.cloudwave.asia
server-name=turn.meet.cloudwave.asia
user=meetra:change_this_strong_turn_password
external-ip=YOUR_SERVER_PUBLIC_IP
```

Start coturn:

```bash
docker compose -f docker-compose.turn.yml up -d
```

Check logs:

```bash
docker logs -f meetra-coturn
```

Backend endpoint for frontend ICE servers:

```bash
curl -H "x-internal-api-secret: CHANGE_THIS_INTERNAL_SECRET" http://127.0.0.1:3850/api/ice-servers
```

---

## 5. Nginx reverse proxy

Copy example:

```bash
sudo cp deploy/nginx/sfu.meet.cloudwave.asia.conf /etc/nginx/sites-available/sfu.meet.cloudwave.asia
sudo nano /etc/nginx/sites-available/sfu.meet.cloudwave.asia
sudo ln -s /etc/nginx/sites-available/sfu.meet.cloudwave.asia /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

Then add SSL using Certbot or your panel.

Your frontend should connect Socket.IO to:

```txt
https://sfu.meet.cloudwave.asia
```

---

## 6. Systemd service

```bash
sudo cp deploy/systemd/meetra-sfu.service /etc/systemd/system/meetra-sfu.service
sudo systemctl daemon-reload
sudo systemctl enable meetra-sfu
sudo systemctl start meetra-sfu
sudo systemctl status meetra-sfu
```

Logs:

```bash
journalctl -u meetra-sfu -f
```

---

## 7. Frontend integration

Read:

```txt
docs/SOCKET_EVENTS.md
frontend-example/useMediasoupClientFlow.ts
```

Your frontend needs these packages:

```bash
npm install socket.io-client mediasoup-client
```

Basic flow:

```txt
1. socket connect
2. join-room
3. create send transport
4. connect send transport
5. produce local audio/video/screen tracks
6. create receive transport
7. consume existing producers
8. listen for new-producer and consume it
9. resume consumer
```

The frontend app should connect directly to the SFU Socket.IO endpoint. Your main API backend should stay responsible for auth, room access, and proxying ICE server config from `/api/ice-servers` using `x-internal-api-secret`.

---

## 8. Common problems

### Remote users cannot see/hear each other

Usually one of these:

- `MEDIASOUP_ANNOUNCED_IP` is wrong
- UDP `50000-60000` is blocked
- Cloud provider firewall is blocking UDP
- Nginx WebSocket proxy headers are missing
- Frontend is not calling `resume-consumer`

### Localhost works but production fails

Set:

```env
MEDIASOUP_LISTEN_IP=0.0.0.0
MEDIASOUP_ANNOUNCED_IP=YOUR_SERVER_PUBLIC_IP
INTERNAL_API_SECRET=CHANGE_THIS_INTERNAL_SECRET
```

Then open:

```txt
50000-60000 UDP
3478 UDP/TCP
3850 TCP
```

### TURN not working

Check coturn logs:

```bash
docker logs -f meetra-coturn
```

Check config password matches `.env`:

```txt
deploy/coturn/turnserver.conf -> user=meetra:password
.env -> TURN_USERNAME=meetra, TURN_PASSWORD=password
```

---

## 9. What this backend handles

Handled by Node.js:

- rooms
- users
- signaling
- producer/consumer lifecycle
- Socket.IO event API
- health and ICE endpoints

Handled by mediasoup media engine:

- ICE/DTLS/SRTP
- RTP/RTCP
- NACK/PLI feedback
- SFU audio/video routing
- simulcast/SVC support when the frontend uses it
- transport bandwidth estimation support

Handled by coturn:

- STUN/TURN fallback for restrictive networks

---

## 10. Production note

This is a working base model, not a full enterprise meeting platform yet. For production you should later add:

- authentication on socket events
- room permissions and host approval
- rate limits
- recording worker
- multi-worker scaling
- metrics and monitoring
- TURN over TLS on port 5349/443 if your users are behind very strict networks

---

## 11. Optional full Docker mode

If you prefer Docker for backend + TURN together:

```bash
cp .env.example .env
nano .env
nano deploy/coturn/turnserver.conf
docker compose -f docker-compose.full.yml up -d --build
```

This uses `network_mode: host` so mediasoup can bind public UDP/TCP media ports properly on Linux.
