import { config } from "./config.js";

export function getIceServers() {
  if (!config.turn.enabled) return [];

  const host = config.turn.host;
  const port = config.turn.port;

  return [
    {
      urls: [`stun:${host}:${port}`],
    },
    {
      urls: [`turn:${host}:${port}?transport=udp`, `turn:${host}:${port}?transport=tcp`],
      username: config.turn.username,
      credential: config.turn.password,
    },
  ];
}
