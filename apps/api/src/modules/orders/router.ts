import { Router } from "express";
import * as controller from "./controller";
import { validate } from "../../lib/validate";
import { createOrderBody } from "./schemas";
import { payBody } from "../payments/schemas";

const router = Router();

router.post(
  "/",
  validate(createOrderBody, "body"),
  controller.create
);

router.post(
  "/:orderId/pay",
  validate(payBody, "body"),
  controller.pay
);

export { router as ordersRouter };
