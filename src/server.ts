import express from "express";
import http from "node:http";
import cors from "cors";
import helmet from "helmet";
import { rateLimit } from "express-rate-limit";
import { Server } from "socket.io";
import * as mediasoup from "mediasoup";
import type {
  Consumer,
  DtlsParameters,
  MediaKind,
  Producer,
  Router,
  RtpCapabilities,
  RtpParameters,
  RouterRtpCodecCapability,
  TransportListenInfo,
  WebRtcTransport,
  Worker,
} from "mediasoup/types";
import { config, getCorsOrigin } from "./config.js";
import { getIceServers } from "./ice.js";
import type { PeerInfo, ProducerSummary, RoomInfo } from "./types.js";

let worker: Worker;
const rooms = new Map<string, RoomInfo>();
const allowedProducerSources = new Set(["camera", "mic", "screen"]);

const mediaCodecs: RouterRtpCodecCapability[] = [
  {
    kind: "audio",
    mimeType: "audio/opus",
    clockRate: 48000,
    channels: 2,
  },
  {
    kind: "video",
    mimeType: "video/VP8",
    clockRate: 90000,
    parameters: {
      "x-google-start-bitrate": 1000,
    },
  },
  {
    kind: "video",
    mimeType: "video/H264",
    clockRate: 90000,
    parameters: {
      "packetization-mode": 1,
      "profile-level-id": "42e01f",
      "level-asymmetry-allowed": 1,
      "x-google-start-bitrate": 1000,
    },
  },
];

async function createWorker() {
  worker = await mediasoup.createWorker({
    rtcMinPort: config.mediasoup.minPort,
    rtcMaxPort: config.mediasoup.maxPort,
    logLevel: "warn",
    logTags: ["ice", "dtls", "rtp", "srtp", "rtcp"],
  });

  worker.on("died", (error) => {
    console.error("mediasoup worker died", error);
    setTimeout(() => process.exit(1), 2000);
  });

  console.log("mediasoup worker created");
}

async function getOrCreateRoom(roomId: string): Promise<RoomInfo> {
  let room = rooms.get(roomId);
  if (room) return room;

  const router = await worker.createRouter({ mediaCodecs });
  room = {
    roomId,
    router,
    peers: new Map(),
    createdAt: new Date(),
  };

  rooms.set(roomId, room);
  console.log(`room created: ${roomId}`);
  return room;
}

function getPeer(socketId: string): PeerInfo | undefined {
  for (const room of rooms.values()) {
    const peer = room.peers.get(socketId);
    if (peer) return peer;
  }
  return undefined;
}

function getRoomByPeer(socketId: string): RoomInfo | undefined {
  for (const room of rooms.values()) {
    if (room.peers.has(socketId)) return room;
  }
  return undefined;
}

function getExistingProducers(room: RoomInfo, requesterSocketId?: string): ProducerSummary[] {
  const list: ProducerSummary[] = [];

  for (const peer of room.peers.values()) {
    if (requesterSocketId && peer.socketId === requesterSocketId) continue;

    for (const producer of peer.producers.values()) {
      list.push({
        producerId: producer.id,
        socketId: peer.socketId,
        userId: peer.userId,
        displayName: peer.displayName,
        userName: peer.displayName,
        name: peer.displayName,
        kind: producer.kind,
        appData: producer.appData as Record<string, unknown>,
      });
    }
  }

  return list;
}

async function createWebRtcTransport(router: Router): Promise<WebRtcTransport> {
  const listenInfos: TransportListenInfo[] = [
    {
      protocol: "udp",
      ip: config.mediasoup.listenIp,
      announcedAddress: config.mediasoup.announcedIp,
    },
    {
      protocol: "tcp",
      ip: config.mediasoup.listenIp,
      announcedAddress: config.mediasoup.announcedIp,
    },
  ];

  const transport = await router.createWebRtcTransport({
    listenInfos,
    initialAvailableOutgoingBitrate: 1_000_000,
    enableSctp: true,
  });

  // Improve initial video bitrate when supported by the endpoint.
  try {
    await transport.setMaxIncomingBitrate(1_500_000);
  } catch {
    // Not fatal.
  }

  return transport;
}

function transportParams(transport: WebRtcTransport) {
  return {
    id: transport.id,
    iceParameters: transport.iceParameters,
    iceCandidates: transport.iceCandidates,
    dtlsParameters: transport.dtlsParameters,
    sctpParameters: transport.sctpParameters,
    iceServers: getIceServers(),
  };
}

function safeAck(callback: unknown, payload: unknown) {
  if (typeof callback === "function") {
    callback(payload);
  }
}

function getProducerSource(kind: MediaKind, payload: { appData?: Record<string, unknown>; source?: unknown }) {
  const rawSource = payload.appData?.source ?? payload.source;
  const source = typeof rawSource === "string" ? rawSource.trim().toLowerCase() : "";

  if (source) {
    if (!allowedProducerSources.has(source)) {
      throw new Error("appData.source must be one of: camera, mic, screen");
    }

    return source;
  }

  return kind === "audio" ? "mic" : "camera";
}

function closePeer(socketId: string) {
  for (const [roomId, room] of rooms.entries()) {
    const peer = room.peers.get(socketId);
    if (!peer) continue;

    for (const consumer of peer.consumers.values()) consumer.close();
    for (const producer of peer.producers.values()) producer.close();
    for (const transport of peer.transports.values()) transport.close();

    room.peers.delete(socketId);

    io.to(roomId).emit("peer-left", {
      socketId,
      userId: peer.userId,
      displayName: peer.displayName,
      userName: peer.displayName,
      name: peer.displayName,
    });

    if (room.peers.size === 0) {
      room.router.close();
      rooms.delete(roomId);
      console.log(`room deleted: ${roomId}`);
    }

    return;
  }
}

const app = express();

// Secure HTTP response headers
app.use(
  helmet({
    crossOriginResourcePolicy: { policy: "cross-origin" },
    contentSecurityPolicy: false,
  })
);

// Rate Limiter to protect SFU status & ICE config routes from spam/abuse
const sfuRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 150,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { ok: false, error: "Too many requests from this IP. Please try again later." },
});

app.use(sfuRateLimiter);
app.use(express.json({ limit: "1mb" }));
app.use(cors({ origin: getCorsOrigin(), credentials: true }));
app.use(express.static("public"));

function requireInternalSecret(req: express.Request, res: express.Response, next: express.NextFunction) {
  const header = req.header("x-internal-api-secret");
  if (header === config.internalApiSecret) return next();
  res.status(401).json({ ok: false, error: "Unauthorized" });
}

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    service: "meetra-selfhosted-sfu",
    rooms: rooms.size,
    turnEnabled: config.turn.enabled,
  });
});

app.get("/api/ice-servers", requireInternalSecret, (_req, res) => {
  res.json({ ok: true, iceServers: getIceServers() });
});

app.get("/api/rooms", requireInternalSecret, (_req, res) => {
  res.json({
    rooms: Array.from(rooms.values()).map((room) => ({
      roomId: room.roomId,
      peers: room.peers.size,
      producers: getExistingProducers(room).length,
      createdAt: room.createdAt,
    })),
  });
});

const httpServer = http.createServer(app);

const io = new Server(httpServer, {
  cors: {
    origin: getCorsOrigin(),
    methods: ["GET", "POST"],
    credentials: true,
  },
  transports: ["websocket", "polling"],
});

io.on("connection", (socket) => {
  console.log("socket connected", socket.id);

  socket.on("join-room", async (payload, callback) => {
    try {
      const roomId = String(payload?.roomId || "").trim();
      if (!roomId) throw new Error("roomId is required");

      const oldRoom = getRoomByPeer(socket.id);
      if (oldRoom) closePeer(socket.id);

      const room = await getOrCreateRoom(roomId);

      const peer: PeerInfo = {
        socketId: socket.id,
        userId: payload?.userId ? String(payload.userId) : undefined,
        displayName:
          payload?.displayName
            ? String(payload.displayName)
            : payload?.userName
              ? String(payload.userName)
              : payload?.name
                ? String(payload.name)
                : undefined,
        roomId,
        rtpCapabilities: payload?.rtpCapabilities,
        transports: new Map(),
        producers: new Map(),
        consumers: new Map(),
      };

      room.peers.set(socket.id, peer);
      await socket.join(roomId);

      safeAck(callback, {
        ok: true,
        roomId,
        socketId: socket.id,
        routerRtpCapabilities: room.router.rtpCapabilities,
        existingProducers: getExistingProducers(room, socket.id),
      });

      socket.to(roomId).emit("peer-joined", {
        socketId: socket.id,
        userId: peer.userId,
        displayName: peer.displayName,
        userName: peer.displayName,
        name: peer.displayName,
      });
    } catch (error) {
      safeAck(callback, { ok: false, error: error instanceof Error ? error.message : String(error) });
    }
  });

  socket.on("get-router-rtp-capabilities", async (payload, callback) => {
    try {
      const roomId = String(payload?.roomId || "").trim();
      const room = await getOrCreateRoom(roomId);
      safeAck(callback, { ok: true, routerRtpCapabilities: room.router.rtpCapabilities });
    } catch (error) {
      safeAck(callback, { ok: false, error: error instanceof Error ? error.message : String(error) });
    }
  });

  socket.on("create-transport", async (payload, callback) => {
    try {
      const roomId = String(payload?.roomId || "").trim();
      const room = rooms.get(roomId);
      if (!room) throw new Error("Room not found. Join room first.");

      const peer = room.peers.get(socket.id);
      if (!peer) throw new Error("Peer not found. Join room first.");

      const transport = await createWebRtcTransport(room.router);
      peer.transports.set(transport.id, transport);

      transport.on("dtlsstatechange", (state) => {
        if (state === "closed") {
          transport.close();
          peer.transports.delete(transport.id);
        }
      });

      transport.observer.on("close", () => {
        peer.transports.delete(transport.id);
      });

      safeAck(callback, { ok: true, params: transportParams(transport) });
    } catch (error) {
      safeAck(callback, { ok: false, error: error instanceof Error ? error.message : String(error) });
    }
  });

  socket.on("connect-transport", async (payload, callback) => {
    try {
      const peer = getPeer(socket.id);
      if (!peer) throw new Error("Peer not found");

      const transportId = String(payload?.transportId || "");
      const dtlsParameters = payload?.dtlsParameters as DtlsParameters | undefined;
      if (!transportId || !dtlsParameters) throw new Error("transportId and dtlsParameters are required");

      const transport = peer.transports.get(transportId);
      if (!transport) throw new Error("Transport not found");

      await transport.connect({ dtlsParameters });
      safeAck(callback, { ok: true });
    } catch (error) {
      safeAck(callback, { ok: false, error: error instanceof Error ? error.message : String(error) });
    }
  });

  socket.on("produce", async (payload, callback) => {
    try {
      const peer = getPeer(socket.id);
      if (!peer) throw new Error("Peer not found");
      const room = rooms.get(peer.roomId);
      if (!room) throw new Error("Room not found");

      const transportId = String(payload?.transportId || "");
      const kind = payload?.kind as MediaKind | undefined;
      const rtpParameters = payload?.rtpParameters as RtpParameters | undefined;
      if (!transportId || !kind || !rtpParameters) throw new Error("transportId, kind and rtpParameters are required");

      const transport = peer.transports.get(transportId);
      if (!transport) throw new Error("Transport not found");

      const source = getProducerSource(kind, payload ?? {});

      const producer = await transport.produce({
        kind,
        rtpParameters,
        appData: {
          socketId: socket.id,
          userId: peer.userId,
          displayName: peer.displayName,
          ...payload?.appData,
          source,
        },
      });

      peer.producers.set(producer.id, producer);

      producer.on("transportclose", () => {
        peer.producers.delete(producer.id);
      });

      producer.observer.on("close", () => {
        peer.producers.delete(producer.id);
      });

      socket.to(peer.roomId).emit("new-producer", {
        producerId: producer.id,
        socketId: socket.id,
        userId: peer.userId,
        displayName: peer.displayName,
        userName: peer.displayName,
        name: peer.displayName,
        kind: producer.kind,
        appData: producer.appData,
      });

      safeAck(callback, { ok: true, producerId: producer.id });
    } catch (error) {
      safeAck(callback, { ok: false, error: error instanceof Error ? error.message : String(error) });
    }
  });

  socket.on("consume", async (payload, callback) => {
    try {
      const roomId = String(payload?.roomId || "").trim();
      const room = rooms.get(roomId);
      if (!room) throw new Error("Room not found");

      const peer = room.peers.get(socket.id);
      if (!peer) throw new Error("Peer not found");

      const transportId = String(payload?.transportId || "");
      const producerId = String(payload?.producerId || "");
      const rtpCapabilities = payload?.rtpCapabilities as RtpCapabilities | undefined;

      if (!transportId || !producerId || !rtpCapabilities) {
        throw new Error("transportId, producerId and rtpCapabilities are required");
      }

      const transport = peer.transports.get(transportId);
      if (!transport) throw new Error("Transport not found");

      if (!room.router.canConsume({ producerId, rtpCapabilities })) {
        throw new Error("Cannot consume this producer with provided RTP capabilities");
      }

      const consumer = await transport.consume({
        producerId,
        rtpCapabilities,
        paused: true,
      });

      peer.consumers.set(consumer.id, consumer);

      consumer.on("transportclose", () => {
        peer.consumers.delete(consumer.id);
      });

      consumer.on("producerclose", () => {
        peer.consumers.delete(consumer.id);
        socket.emit("consumer-closed", {
          consumerId: consumer.id,
          producerId,
        });
      });

      safeAck(callback, {
        ok: true,
        params: {
          id: consumer.id,
          producerId,
          kind: consumer.kind,
          rtpParameters: consumer.rtpParameters,
          type: consumer.type,
          producerPaused: consumer.producerPaused,
        },
      });
    } catch (error) {
      safeAck(callback, { ok: false, error: error instanceof Error ? error.message : String(error) });
    }
  });

  socket.on("resume-consumer", async (payload, callback) => {
    try {
      const peer = getPeer(socket.id);
      if (!peer) throw new Error("Peer not found");

      const consumerId = String(payload?.consumerId || "");
      const consumer = peer.consumers.get(consumerId);
      if (!consumer) throw new Error("Consumer not found");

      await consumer.resume();
      safeAck(callback, { ok: true });
    } catch (error) {
      safeAck(callback, { ok: false, error: error instanceof Error ? error.message : String(error) });
    }
  });

  socket.on("close-producer", async (payload, callback) => {
    try {
      const peer = getPeer(socket.id);
      if (!peer) throw new Error("Peer not found");

      const producerId = String(payload?.producerId || "");
      const producer = peer.producers.get(producerId);
      if (!producer) throw new Error("Producer not found");

      producer.close();
      peer.producers.delete(producerId);

      socket.to(peer.roomId).emit("producer-closed", {
        producerId,
        socketId: socket.id,
        userId: peer.userId,
      });

      safeAck(callback, { ok: true });
    } catch (error) {
      safeAck(callback, { ok: false, error: error instanceof Error ? error.message : String(error) });
    }
  });

  socket.on("get-producers", async (payload, callback) => {
    try {
      const roomId = String(payload?.roomId || "").trim();
      const room = rooms.get(roomId);
      if (!room) throw new Error("Room not found");
      safeAck(callback, { ok: true, producers: getExistingProducers(room, socket.id) });
    } catch (error) {
      safeAck(callback, { ok: false, error: error instanceof Error ? error.message : String(error) });
    }
  });

  socket.on("disconnect", () => {
    console.log("socket disconnected", socket.id);
    closePeer(socket.id);
  });
});

async function start() {
  if (config.mediasoup.listenIp === "0.0.0.0" && !config.mediasoup.announcedIp) {
    throw new Error("MEDIASOUP_ANNOUNCED_IP is required when MEDIASOUP_LISTEN_IP is 0.0.0.0");
  }

  await createWorker();

  httpServer.listen(config.port, () => {
    console.log(`SFU backend running on :${config.port}`);
    console.log(`Allowed origins: ${config.frontendOrigins.join(", ")}`);
    console.log(`mediasoup announced IP: ${config.mediasoup.announcedIp}`);
    console.log(`mediasoup UDP/TCP port range: ${config.mediasoup.minPort}-${config.mediasoup.maxPort}`);
    console.log(`TURN enabled: ${config.turn.enabled}`);
  });
}

start().catch((error) => {
  console.error("Failed to start SFU backend", error);
  process.exit(1);
});
