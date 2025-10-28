import type { Request, Response, NextFunction } from "express";
import type { ZodSchema } from "zod";

export function validate<T>(schema: ZodSchema<T>, where: "body" | "query" | "params" | "headers") {
  return (req: Request, res: Response, next: NextFunction) => {
    const data = (req as any)[where];
    const result = (schema as any).safeParse(data);
    if (!result.success) {
      return res.status(400).json({ error: "validation failed", details: result.error.flatten() });
    }
    (req as any)[`validated_${where}`] = result.data as T;
    next();
  };
}
