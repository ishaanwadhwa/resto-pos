import { Request, Response, NextFunction } from "express";
import { createOrderIdempotent } from "./service";

export async function create(req: Request, res: Response, next: NextFunction) {
  try {
    const { tenantId, storeId } = req as any;
    const { type, items } = (req as any).validated_body;
    const idemKey = req.header("idempotency-key") || req.header("x-idempotency-key") || "";

    const result = await createOrderIdempotent(tenantId, storeId, type, items, idemKey);
    res.status(201).json(result);
  } catch (e) { next(e); }
}
