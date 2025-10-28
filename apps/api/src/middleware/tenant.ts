import { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { getPool } from "../db";

const slugSchema = z.string().regex(/^[a-z0-9-]{3,}$/,"invalid slug");

export async function tenantScope(req: Request, res: Response, next: NextFunction) {
  const slug = (req.header("x-tenant-slug") || "").trim();
  const parsed = slugSchema.safeParse(slug);
  if (!parsed.success) return res.status(400).json({ error: "x-tenant-slug required", details: parsed.error.flatten() });

  try {
    const pool = getPool();
    const { rows } = await pool.query(
      `SELECT t.id AS tenant_id, s.id AS store_id
       FROM tenants t
       JOIN stores s ON s.tenant_id = t.id
       WHERE t.slug = $1
       ORDER BY s.created_at ASC
       LIMIT 1`, [slug]
    );

    if (!rows[0]) return res.status(404).json({ error: "tenant/store not found" });

    (req as any).tenantId = rows[0].tenant_id;
    (req as any).storeId  = rows[0].store_id;
    next();
  } catch (err) {
    res.status(500).json({ error: "Database error", details: (err as any).message });
  }
}
