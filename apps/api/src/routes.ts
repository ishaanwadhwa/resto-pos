import { Router } from "express";
import { menuRouter } from "./modules/menu/router";
import { ordersRouter } from "./modules/orders/router";

export const router = Router();

router.use(menuRouter);
router.use(ordersRouter);

