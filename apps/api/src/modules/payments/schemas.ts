import { z } from "zod";
export const payBody = z.object({
  method: z.enum(["CASH","CARD","UPI","WALLET","COUPON"]),
  amount_cents: z.number().int().positive(),
  ref: z.string().max(120).optional(),
});
