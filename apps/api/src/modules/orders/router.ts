import { Router } from "express";
import * as controller from "./controller";
import { validate } from "../../lib/validate";
import { createOrderBody } from "./schemas";

const router = Router();

router.post("/orders",
  validate(createOrderBody, "body"),
  controller.create
);

export { router as ordersRouter };
