import dotenv from "dotenv";
dotenv.config();

import { app } from "./app";
import { startIdempotencyCleanupJob } from "./jobs/cleanup";
import { startEventSubscribers } from "./modules/events/subscriber";
import { setupRedisShutdown } from "./lib/redis";

const port = Number(process.env.PORT || 3000);
app.listen(port, () => {
  console.log(`API running on :${port}`);
  startIdempotencyCleanupJob();
  startEventSubscribers();
  setupRedisShutdown();
});
