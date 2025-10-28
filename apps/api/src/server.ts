import express from "express";
import cors from "cors";
import dotenv from "dotenv";
dotenv.config();

import { tenantScope } from "./tenant";
import { router } from "./routes";

const app = express();

// Top-level request logger to verify requests reach the server
app.use((req, _res, next) => {
  console.log("➡️  ", req.method, req.url);
  next();
});

// Global response timeout (6s)
app.use((req, res, next) => {
  res.setTimeout(6000, () => {
    console.error("⏳ [TIMEOUT] Request timed out:", req.method, req.url);
    // Only end if not already sent
    if (!res.headersSent) {
      try { res.status(504).send("Gateway Timeout"); } catch {}
    }
  });
  next();
});

// Keep health check before any heavy middleware
app.get("/health", (_, res) => {
  console.log("❤️ [HEALTH] Health check");
  res.send("ok");
});

app.use(cors());
app.use(express.json());

app.use(tenantScope);       // multi-tenant scoping
app.use("/", router);       // routes

const port = Number(process.env.PORT || 3000);
app.listen(port, () => console.log(`🚀 API running on :${port}`));
