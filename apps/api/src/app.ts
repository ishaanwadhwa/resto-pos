import express from "express";
import cors from "cors";

import { tenantScope } from "./middleware/tenant";
import { errorHandler } from "./middleware/error";
import { router } from "./routes";

const app = express();

app.get("/health", (_req, res) => {
  res.send("ok");
});

app.use(cors());
app.use(express.json());

app.use(tenantScope);

app.use(router);

app.use(errorHandler);

export { app };
