# Socket.IO Event Contract

All callbacks return `{ ok: boolean, ... }`. If `ok` is false, response includes `error`.

## Client -> Server

### join-room
Payload:
```ts
{
  roomId: string;
  userId?: string;
  displayName?: string;
  rtpCapabilities?: RtpCapabilities;
}
```
Response:
```ts
{
  ok: true;
  roomId: string;
  socketId: string;
  routerRtpCapabilities: RtpCapabilities;
  existingProducers: ProducerSummary[];
}
```

### get-router-rtp-capabilities
Payload:
```ts
{ roomId: string }
```

### create-transport
Payload:
```ts
{ roomId: string; direction?: "send" | "recv" }
```
Response:
```ts
{
  ok: true;
  params: {
    id: string;
    iceParameters: IceParameters;
    iceCandidates: IceCandidate[];
    dtlsParameters: DtlsParameters;
    sctpParameters?: SctpParameters;
    iceServers: RTCIceServer[];
  }
}
```

### connect-transport
Payload:
```ts
{ transportId: string; dtlsParameters: DtlsParameters }
```

### produce
Payload:
```ts
{
  transportId: string;
  kind: "audio" | "video";
  rtpParameters: RtpParameters;
  appData?: { source?: "camera" | "mic" | "screen"; [key: string]: unknown };
}
```
Response:
```ts
{ ok: true; producerId: string }
```

### consume
Payload:
```ts
{
  roomId: string;
  producerId: string;
  transportId: string;
  rtpCapabilities: RtpCapabilities;
}
```
Response:
```ts
{
  ok: true;
  params: {
    id: string;
    producerId: string;
    kind: "audio" | "video";
    rtpParameters: RtpParameters;
    type: string;
    producerPaused: boolean;
  }
}
```

### resume-consumer
Payload:
```ts
{ consumerId: string }
```

### close-producer
Payload:
```ts
{ producerId: string }
```

### get-producers
Payload:
```ts
{ roomId: string }
```

## Server -> Client

### peer-joined
```ts
{ socketId: string; userId?: string; displayName?: string }
```

### peer-left
```ts
{ socketId: string; userId?: string; displayName?: string }
```

### new-producer
```ts
{
  producerId: string;
  socketId: string;
  userId?: string;
  displayName?: string;
  kind: "audio" | "video";
  appData?: Record<string, unknown>;
}
```

### producer-closed
```ts
{ producerId: string; socketId: string; userId?: string }
```

### consumer-closed
```ts
{ consumerId: string; producerId: string }
```
