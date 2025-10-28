import { Request, Response, NextFunction } from "express";
import { fetchMenuItems } from "./service";

export async function listMenu(req: Request, res: Response, next: NextFunction) {
  try {
    const { tenantId, storeId } = req as any;
    const items = await fetchMenuItems(tenantId, storeId);
    res.json(items);
  } catch (err) {
    next(err);
  }
}
