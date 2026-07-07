import dotenv from "dotenv";
import path from "path";

const nodeEnv = process.env.NODE_ENV || "development";

dotenv.config({ path: path.resolve(process.cwd(), `.env.${nodeEnv}`) });
dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });
dotenv.config({ path: path.resolve(process.cwd(), ".env") });

function required(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (value === undefined || value === "") {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

function numberEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value)) throw new Error(`Invalid number env var: ${name}`);
  return value;
}

function booleanEnv(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (!raw) return fallback;
  return ["1", "true", "yes", "on"].includes(raw.toLowerCase());
}

export const config = {
  port: numberEnv("PORT", 3850),
  nodeEnv,
  frontendOrigins: (process.env.FRONTEND_ORIGIN || "http://localhost:3005")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean),

  mediasoup: {
    listenIp: process.env.MEDIASOUP_LISTEN_IP || "0.0.0.0",
    announcedIp: process.env.NODE_ENV === "production" ? required("MEDIASOUP_ANNOUNCED_IP") : (process.env.MEDIASOUP_ANNOUNCED_IP || "127.0.0.1"),
    minPort: numberEnv("MEDIASOUP_MIN_PORT", 50000),
    maxPort: numberEnv("MEDIASOUP_MAX_PORT", 60000),
  },

  turn: {
    enabled: booleanEnv("TURN_ENABLED", false),
    host: process.env.TURN_HOST || "127.0.0.1",
    port: numberEnv("TURN_PORT", 3478),
    username: process.env.TURN_USERNAME || "meetra",
    password: process.env.TURN_PASSWORD || "change_this_strong_turn_password",
  },

  internalApiSecret: process.env.NODE_ENV === "production" ? required("INTERNAL_API_SECRET") : (process.env.INTERNAL_API_SECRET || "dev_internal_secret"),
};

export function getCorsOrigin() {
  return function corsOrigin(origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) {
    if (!origin) return callback(null, true);
    if (config.frontendOrigins.includes("*") || config.frontendOrigins.includes(origin)) {
      return callback(null, true);
    }
    return callback(new Error(`CORS blocked origin: ${origin}`));
  };
}
