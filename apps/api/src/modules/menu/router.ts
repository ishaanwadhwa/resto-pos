import { Router } from "express";
import { listMenu } from "./controller";

const router = Router();

router.get("/menu", listMenu);

export { router as menuRouter };
