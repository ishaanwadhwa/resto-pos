import express from "express";
import cors from "cors";

import { tenantScope } from "./middleware/tenant";
import { errorHandler } from "./middleware/error";
import { router } from "./routes";

const app = express();

// Minimal request logger
app.use((req, _res, next) => { console.log(req.method, req.url); next(); });

app.get("/health", (_req, res) => {
  res.send("ok");
});

app.use(cors());
app.use(express.json());

app.use(tenantScope);

app.use(router);

// JSON 404 handler
app.use((req, res) => {
  res.status(404).json({ error: `Not Found: ${req.method} ${req.originalUrl}` });
});

app.use(errorHandler);

export { app };
