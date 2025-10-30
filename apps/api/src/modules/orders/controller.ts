import { Request, Response, NextFunction } from "express";
import { createOrderIdempotent, addPayment } from "./service";

export async function create(req: Request, res: Response, next: NextFunction) {
  try {
    const { tenantId, storeId } = req as any;
    const { type, items } = (req as any).validated_body;
    const idemKey = req.header("idempotency-key") || req.header("x-idempotency-key") || "";

    const { result, fromCache } = await createOrderIdempotent(tenantId, storeId, type, items, idemKey);
    if (fromCache) {
      res.setHeader("Idempotency-Replay", "true");
      return res.status(200).json(result);
    }
    res.status(201).json(result);
  } catch (e) { next(e); }
}

export async function pay(req: Request, res: Response, next: NextFunction) {
  try {
    const { tenantId, storeId } = req as any;
    const { orderId } = req.params as any;
    const body = (req as any).validated_body;
    const idemKey = req.header("idempotency-key") || req.header("x-idempotency-key") || "";
    const result = await addPayment(tenantId, storeId, orderId, body, idemKey);
    res.status(201).json(result);
  } catch (e) { next(e); }
}
