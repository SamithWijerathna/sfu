/*
This is frontend reference only. Install in frontend:
  npm install socket.io-client mediasoup-client

It shows the order your existing frontend must call the backend events.
Adapt it into your existing meeting hook/UI.
*/

import { io, Socket } from "socket.io-client";
import * as mediasoupClient from "mediasoup-client";
import type { Device } from "mediasoup-client";
import type { Consumer, Producer, Transport } from "mediasoup-client/lib/types";

function emitAck<T>(socket: Socket, event: string, payload: unknown): Promise<T> {
  return new Promise((resolve, reject) => {
    socket.timeout(15000).emit(event, payload, (err: Error | null, response: any) => {
      if (err) return reject(err);
      if (!response?.ok) return reject(new Error(response?.error || `${event} failed`));
      resolve(response as T);
    });
  });
}

export async function connectToMeetraSfu(options: {
  apiUrl: string;
  roomId: string;
  userId: string;
  displayName: string;
  localStream: MediaStream;
  onRemoteTrack: (data: {
    consumer: Consumer;
    stream: MediaStream;
    producerId: string;
    socketId?: string;
  }) => void;
}) {
  const socket = io(options.apiUrl, { transports: ["websocket"] });
  await new Promise<void>((resolve) => socket.on("connect", () => resolve()));

  const joinResponse: any = await emitAck(socket, "join-room", {
    roomId: options.roomId,
    userId: options.userId,
    displayName: options.displayName,
  });

  const device: Device = new mediasoupClient.Device();
  await device.load({ routerRtpCapabilities: joinResponse.routerRtpCapabilities });

  const sendTransportResponse: any = await emitAck(socket, "create-transport", {
    roomId: options.roomId,
    direction: "send",
  });

  const sendTransport: Transport = device.createSendTransport(sendTransportResponse.params);

  sendTransport.on("connect", ({ dtlsParameters }, callback, errback) => {
    emitAck(socket, "connect-transport", {
      transportId: sendTransport.id,
      dtlsParameters,
    })
      .then(() => callback())
      .catch(errback);
  });

  sendTransport.on("produce", ({ kind, rtpParameters, appData }, callback, errback) => {
    emitAck<any>(socket, "produce", {
      transportId: sendTransport.id,
      kind,
      rtpParameters,
      appData,
    })
      .then((res) => callback({ id: res.producerId }))
      .catch(errback);
  });

  const localProducers: Producer[] = [];
  for (const track of options.localStream.getTracks()) {
    const source = track.kind === "audio" ? "mic" : "camera";
    localProducers.push(await sendTransport.produce({ track, appData: { source } }));
  }

  const recvTransportResponse: any = await emitAck(socket, "create-transport", {
    roomId: options.roomId,
    direction: "recv",
  });

  const recvTransport: Transport = device.createRecvTransport(recvTransportResponse.params);

  recvTransport.on("connect", ({ dtlsParameters }, callback, errback) => {
    emitAck(socket, "connect-transport", {
      transportId: recvTransport.id,
      dtlsParameters,
    })
      .then(() => callback())
      .catch(errback);
  });

  async function consumeProducer(producerInfo: any) {
    const consumeResponse: any = await emitAck(socket, "consume", {
      roomId: options.roomId,
      producerId: producerInfo.producerId,
      transportId: recvTransport.id,
      rtpCapabilities: device.rtpCapabilities,
    });

    const consumer = await recvTransport.consume(consumeResponse.params);
    const stream = new MediaStream([consumer.track]);

    options.onRemoteTrack({
      consumer,
      stream,
      producerId: producerInfo.producerId,
      socketId: producerInfo.socketId,
    });

    await emitAck(socket, "resume-consumer", { consumerId: consumer.id });
  }

  for (const producerInfo of joinResponse.existingProducers || []) {
    await consumeProducer(producerInfo);
  }

  socket.on("new-producer", (producerInfo) => {
    consumeProducer(producerInfo).catch(console.error);
  });

  socket.on("producer-closed", ({ producerId }) => {
    console.log("producer closed", producerId);
  });

  socket.on("peer-left", ({ socketId }) => {
    console.log("peer left", socketId);
  });

  return {
    socket,
    device,
    sendTransport,
    recvTransport,
    localProducers,
    close() {
      localProducers.forEach((producer) => producer.close());
      sendTransport.close();
      recvTransport.close();
      socket.disconnect();
    },
  };
}
