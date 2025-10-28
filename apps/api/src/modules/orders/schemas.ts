import { z } from "zod";

export const orderItemInput = z.object({
  menuItemId: z.string().uuid(),
  qty: z.coerce.number().int().positive(),
  notes: z.string().max(300).optional().nullable(),
}).strict();

export const createOrderBody = z.object({
  type: z.enum(["TAKEAWAY","DINE_IN","WEB"]).default("TAKEAWAY"),
  items: z.array(orderItemInput).min(1, "at least one item required"),
}).strict();
