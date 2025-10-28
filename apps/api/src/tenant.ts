import { Request, Response, NextFunction } from "express";
import { getPool } from "./db";

export async function tenantScope(req: Request, res: Response, next: NextFunction) {
  console.log("🔍 [TENANT] Middleware called, path:", req.path);
  
  const slug = (req.header("x-tenant-slug") || "").trim();
  console.log("🔍 [TENANT] Slug received:", slug);
  
  if (!slug) return res.status(400).json({ error: "x-tenant-slug required" });

  console.log("🔍 [TENANT] Querying database for slug:", slug);
  
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
    
    console.log("🔍 [TENANT] Query result:", rows);
    
    if (!rows[0]) return res.status(404).json({ error: "tenant/store not found" });

    (req as any).tenantId = rows[0].tenant_id;
    (req as any).storeId  = rows[0].store_id;
    console.log("🔍 [TENANT] Set tenantId:", rows[0].tenant_id, "storeId:", rows[0].store_id);
    next();
  } catch (err) {
    console.error("❌ [TENANT] Query error:", err);
    res.status(500).json({ error: "Database error", details: (err as any).message });
  }
}
