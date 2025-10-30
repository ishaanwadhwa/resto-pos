import { Request, Response, NextFunction } from "express";
import { listTickets } from "./service";

export async function list(req: Request, res: Response, next: NextFunction) {
  try {
    const { tenantId, storeId } = req as any;
    const data = await listTickets(tenantId, storeId);
    res.json(data);
  } catch (e) { next(e); }
}


