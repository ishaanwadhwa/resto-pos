import { getPool } from "../../db";

export async function fetchMenuItems(tenantId: string, storeId: string) {
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT id, name, price_cents
     FROM menu_items
     WHERE tenant_id = $1 AND store_id = $2 AND active = true
     ORDER BY name`,
    [tenantId, storeId]
  );
  return rows;
}
