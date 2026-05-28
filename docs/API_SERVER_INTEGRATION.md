# Existing API Server Integration

Add these env vars to your existing API server at `api.meet.cloudwave.asia`:

```env
SFU_URL=https://sfu.meet.cloudwave.asia
SFU_INTERNAL_SECRET=CHANGE_THIS_INTERNAL_SECRET
```

Example endpoint for your frontend:

```ts
app.get('/api/meeting/:roomId/sfu-config', requireAuth, async (req, res) => {
  // 1. Validate meeting permission from your database.
  // 2. Return the SFU service URL for this meeting.
  res.json({
    roomId: req.params.roomId,
    socketUrl: process.env.SFU_URL,
    iceServersUrl: `${process.env.SFU_URL}/api/ice-servers`,
  });
});
```

Then frontend does:

```ts
const config = await fetch(`/api/meeting/${roomId}/sfu-config`).then(r => r.json());
const socket = io(config.socketUrl, { transports: ['websocket'] });
```

When your API server fetches ICE servers from the SFU, send:

```ts
await fetch(`${process.env.SFU_URL}/api/ice-servers`, {
  headers: {
    'x-internal-api-secret': process.env.SFU_INTERNAL_SECRET!,
  },
});
```

Keep app auth/database on `api.meet.cloudwave.asia`. Keep media signaling on `sfu.meet.cloudwave.asia`.
