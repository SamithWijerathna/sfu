# Meetra Split Server Setup

Use this when you already have an app/API server at `api.meet.cloudwave.asia`, and you want a separate SFU/TURN VPS:

- `api.meet.cloudwave.asia` = existing app backend, auth, database, meeting logic.
- `sfu.meet.cloudwave.asia` = this Node.js + mediasoup signaling/SFU backend.
- `turn.meet.cloudwave.asia` = coturn STUN/TURN on the same SFU/TURN VPS.
- `meet.cloudwave.asia` = frontend.

## DNS

Point both records to the SFU/TURN VPS public IP:

```dns
sfu.meet.cloudwave.asia   A   YOUR_SFU_TURN_VPS_PUBLIC_IP
turn.meet.cloudwave.asia  A   YOUR_SFU_TURN_VPS_PUBLIC_IP
```

Keep `api.meet.cloudwave.asia` pointed to your existing API server.

## SFU VPS install

```bash
cd /opt
unzip meetra-sfu-split-server.zip
mv meetra-sfu-split-server meetra-sfu
cd /opt/meetra-sfu

cp .env.split-server.example .env
nano .env
npm install
npm run build
```

Set:

```env
MEDIASOUP_ANNOUNCED_IP=YOUR_SFU_TURN_VPS_PUBLIC_IP
TURN_HOST=turn.meet.cloudwave.asia
TURN_PASSWORD=same_password_as_coturn
INTERNAL_API_SECRET=same_secret_as_api_server
```

## TURN setup on the same VPS

```bash
cp deploy/coturn/turn.meet.cloudwave.asia.conf.example deploy/coturn/turnserver.conf
nano deploy/coturn/turnserver.conf
```

Set:

```txt
user=meetra:SAME_TURN_PASSWORD
external-ip=YOUR_SFU_TURN_VPS_PUBLIC_IP
```

Start coturn:

```bash
docker compose -f docker-compose.turn.yml up -d
docker logs -f meetra-coturn
```

## Open ports on SFU/TURN VPS

Open these in both Linux firewall and provider firewall:

```bash
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow 3850/tcp
ufw allow 3478/tcp
ufw allow 3478/udp
ufw allow 50000:60000/udp
ufw allow 50000:60000/tcp
ufw reload
```

## Nginx on SFU VPS

```bash
cp deploy/nginx/sfu.meet.cloudwave.asia.conf /etc/nginx/sites-available/sfu.meet.cloudwave.asia
ln -s /etc/nginx/sites-available/sfu.meet.cloudwave.asia /etc/nginx/sites-enabled/
nginx -t
systemctl reload nginx
certbot --nginx -d sfu.meet.cloudwave.asia
```

Do not proxy TURN through Nginx. `turn.meet.cloudwave.asia` uses raw TURN ports directly: `3478` UDP/TCP and optional `5349` TCP.

## Start SFU

```bash
npm install -g pm2
pm2 start dist/server.js --name meetra-sfu
pm2 save
pm2 logs meetra-sfu
```

Test:

```bash
curl https://sfu.meet.cloudwave.asia/health
curl -H "x-internal-api-secret: CHANGE_THIS_INTERNAL_SECRET" https://sfu.meet.cloudwave.asia/api/ice-servers
```

## How existing API server communicates

Your existing `api.meet.cloudwave.asia` should not carry video packets. It should only handle auth/business logic and tell the frontend which SFU URL to use:

```json
{
  "sfuUrl": "https://sfu.meet.cloudwave.asia",
  "socketUrl": "https://sfu.meet.cloudwave.asia",
  "iceServersUrl": "https://sfu.meet.cloudwave.asia/api/ice-servers"
}
```

The frontend then opens Socket.IO directly to `sfu.meet.cloudwave.asia` for media signaling.

Recommended browser flow:

1. Frontend logs in with `api.meet.cloudwave.asia`.
2. API verifies user/meeting permission.
3. API returns `sfuUrl=https://sfu.meet.cloudwave.asia`.
4. Frontend connects socket to `sfu.meet.cloudwave.asia`.
5. Frontend sends `join-room` with meeting/user info.
6. SFU handles mediasoup transports/producers/consumers.

## Optional: existing API server checks SFU health

Node example:

```ts
const SFU_URL = process.env.SFU_URL || "https://sfu.meet.cloudwave.asia";
const SFU_INTERNAL_SECRET = process.env.SFU_INTERNAL_SECRET!;

export async function getSfuIceServers() {
  const res = await fetch(`${SFU_URL}/api/ice-servers`, {
    headers: {
      "x-internal-api-secret": SFU_INTERNAL_SECRET,
    },
  });

  if (!res.ok) throw new Error("Failed to fetch SFU ICE servers");
  return res.json();
}
```

But the actual video/audio should still go browser <-> SFU, not API server <-> SFU.
