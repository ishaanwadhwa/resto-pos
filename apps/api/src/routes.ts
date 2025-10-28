import { Router } from "express";
import { getPool } from "./db";

export const router = Router();

router.get("/menu", async (req, res) => {
  console.log("🍔 [MENU] Route handler called");
  
  const { tenantId, storeId } = req as any;
  console.log("🍔 [MENU] tenantId:", tenantId, "storeId:", storeId);
  
  try {
    console.log("🍔 [MENU] Querying menu items...");
    const pool = getPool();
    const { rows } = await pool.query(
      `SELECT id, name, price_cents
       FROM menu_items
       WHERE tenant_id = $1 AND store_id = $2 AND active = true
       ORDER BY name`,
      [tenantId, storeId]
    );
    console.log("🍔 [MENU] Found items:", rows);
    res.json(rows);
  } catch (err) {
    console.error("❌ [MENU] Query error:", err);
    res.status(500).json({ error: "Database error", details: (err as any).message });
  }
});
