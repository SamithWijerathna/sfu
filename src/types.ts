import type {
  Consumer,
  Producer,
  Router,
  RtpCapabilities,
  WebRtcTransport,
} from "mediasoup/types";

export type PeerInfo = {
  socketId: string;
  userId?: string;
  displayName?: string;
  roomId: string;
  rtpCapabilities?: RtpCapabilities;
  transports: Map<string, WebRtcTransport>;
  producers: Map<string, Producer>;
  consumers: Map<string, Consumer>;
};

export type RoomInfo = {
  roomId: string;
  router: Router;
  peers: Map<string, PeerInfo>;
  createdAt: Date;
};

export type ProducerSummary = {
  producerId: string;
  socketId: string;
  userId?: string;
  displayName?: string;
  userName?: string;
  name?: string;
  kind: "audio" | "video";
  appData?: Record<string, unknown>;
};
