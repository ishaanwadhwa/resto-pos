import Redis from "ioredis";

const REDIS_URL = process.env.REDIS_URL || "redis://127.0.0.1:6379";

export const redisPublishClient = new Redis(REDIS_URL, { lazyConnect: false });
export const redisSubscribeClient = new Redis(REDIS_URL, { lazyConnect: false });

redisPublishClient.on("connect", () => console.log("Redis publish client connected"));
redisPublishClient.on("ready", () => console.log("Redis publish client ready"));
redisSubscribeClient.on("connect", () => console.log("Redis subscribe client connected"));
redisSubscribeClient.on("ready", () => console.log("Redis subscribe client ready"));

redisPublishClient.on("error", (err) => console.error("Redis publish error", err));
redisSubscribeClient.on("error", (err) => console.error("Redis subscribe error", err));

export function setupRedisShutdown() {
  const shutdown = async () => {
    try { await redisSubscribeClient.quit(); } catch {}
    try { await redisPublishClient.quit(); } catch {}
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}
