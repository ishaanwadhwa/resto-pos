import { Request, Response, NextFunction } from "express";

export function errorHandler(err: any, _req: Request, res: Response, _next: NextFunction) {
  const status = Number((err && (err.status || err.statusCode)) || 500);
  const message = (err && err.message) || "Internal Server Error";
  res.status(status).json({ error: message });
}
