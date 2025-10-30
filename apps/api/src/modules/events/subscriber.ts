import { redisSubscribeClient } from "../../lib/redis";

// Subscribe to all tenants' tickets.created events
const pattern = "tenant:*:tickets.created";

export function startEventSubscribers() {
  // Use psubscribe for pattern subscriptions
  redisSubscribeClient.psubscribe(pattern, (err, count) => {
    if (err) {
      console.error("Redis psubscribe error", err);
      return;
    }
    console.log(`Subscribed to ${count} pattern(s): ${pattern}`);
  });

  redisSubscribeClient.on("pmessage", (_pattern, channel, message) => {
    try {
      const data = JSON.parse(message);
      console.log("Ticket event:", channel, data);
    } catch {
      console.log("Ticket event:", channel, message);
    }
  });
}
