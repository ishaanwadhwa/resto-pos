import { Router } from "express";
import { menuRouter } from "./modules/menu/router";
import { ordersRouter } from "./modules/orders/router";
import { ticketsRouter } from "./modules/tickets/router";

export const router = Router();

router.use(menuRouter);
router.use("/orders", ordersRouter);
router.use("/tickets", ticketsRouter);

