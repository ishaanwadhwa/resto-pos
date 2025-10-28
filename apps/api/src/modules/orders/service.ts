import { getPool } from "../../db";
import { hashBody } from "../../lib/hash";

export interface OrderItemInput { menuItemId: string; qty?: number; notes?: string | null }

async function createOrderWithClient(
  client: any,
  tenantId: string,
  storeId: string,
  type: string,
  items: OrderItemInput[],
) {
  // Validate menu items
  const ids = items.map(i => i.menuItemId);
  const menu = await client.query(
    `SELECT id, name, price_cents
     FROM menu_items
     WHERE tenant_id = $1 AND store_id = $2 AND id = ANY($3) AND active = true`,
    [tenantId, storeId, ids]
  );
  if (menu.rowCount !== ids.length) {
    throw Object.assign(new Error("one or more menu items invalid"), { status: 400 });
  }
  const menuById: Record<string, any> = Object.fromEntries(menu.rows.map((r: any) => [r.id, r]));

  // Create order
  const orderIns = await client.query(
    `INSERT INTO orders (tenant_id, store_id, type, status, subtotal_cents, total_cents)
     VALUES ($1, $2, $3, 'IN_KITCHEN', 0, 0)
     RETURNING id`,
    [tenantId, storeId, type]
  );
  const orderId: string = orderIns.rows[0].id;

  // Insert order items and compute subtotal
  let subtotal = 0;
  for (const it of items) {
    const m = menuById[it.menuItemId];
    const qty = Number(it.qty ?? 1);
    if (!Number.isFinite(qty) || qty <= 0) {
      throw Object.assign(new Error("invalid qty"), { status: 400 });
    }
    const line = m.price_cents * qty;
    subtotal += line;

    await client.query(
      `INSERT INTO order_items (order_id, menu_item_id, name_snapshot, unit_price_cents, qty, notes)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [orderId, m.id, m.name, m.price_cents, qty, it.notes ?? null]
    );
  }

  await client.query(
    `UPDATE orders SET subtotal_cents = $2, total_cents = $2 WHERE id = $1`,
    [orderId, subtotal]
  );

  // First station
  const st = await client.query(
    `SELECT id FROM kitchen_stations
     WHERE tenant_id = $1 AND store_id = $2
     ORDER BY name ASC LIMIT 1`,
    [tenantId, storeId]
  );
  if (!st.rows[0]) {
    throw Object.assign(new Error("no kitchen station configured"), { status: 400 });
  }
  const stationId: string = st.rows[0].id;

  const ticketIns = await client.query(
    `INSERT INTO tickets (tenant_id, store_id, order_id, station_id, status)
     VALUES ($1, $2, $3, $4, 'QUEUED')
     RETURNING id`,
    [tenantId, storeId, orderId, stationId]
  );
  const ticketId: string = ticketIns.rows[0].id;

  // Attach items to ticket
  const oItems = await client.query(
    `SELECT id, name_snapshot, qty FROM order_items WHERE order_id = $1`,
    [orderId]
  );
  for (const oi of oItems.rows) {
    await client.query(
      `INSERT INTO ticket_items (ticket_id, order_item_id, label, qty)
       VALUES ($1, $2, $3, $4)`,
      [ticketId, oi.id, oi.name_snapshot, oi.qty]
    );
  }

  return { orderId, ticketId, total_cents: subtotal };
}

export async function createOrderIdempotent(
  tenantId: string,
  storeId: string,
  type: string,
  items: OrderItemInput[],
  idempotencyKey?: string
) {
  if (!idempotencyKey) {
    throw Object.assign(new Error("Idempotency-Key required"), { status: 400 });
  }

  const pool = getPool();
  const client = await pool.connect();
  const endpoint = "/orders";
  const requestHash = hashBody({ type, items });

  try {
    // Attempt to insert lock row
    const insert = await client.query(
      `INSERT INTO idempotency_keys (tenant_id, endpoint, idempotency_key, request_hash, status)
       VALUES ($1,$2,$3,$4,'PENDING')
       ON CONFLICT (tenant_id, endpoint, idempotency_key) DO NOTHING
       RETURNING id`,
      [tenantId, endpoint, idempotencyKey, requestHash]
    );

    if (insert.rowCount === 0) {
      const { rows } = await client.query(
        `SELECT status, request_hash, response_json
         FROM idempotency_keys
         WHERE tenant_id=$1 AND endpoint=$2 AND idempotency_key=$3`,
        [tenantId, endpoint, idempotencyKey]
      );
      const row = rows[0];
      if (!row) throw new Error("idempotency lookup failed");

      if (row.request_hash !== requestHash) {
        throw Object.assign(new Error("idempotency key reused with different payload"), { status: 400 });
      }

      if (row.status === "COMPLETED" && row.response_json) {
        return row.response_json;
      }

      throw Object.assign(new Error("request in progress"), { status: 409 });
    }

    await client.query("BEGIN");

    const result = await createOrderWithClient(client, tenantId, storeId, type, items);

    await client.query(
      `UPDATE idempotency_keys
       SET status='COMPLETED', response_json=$4::jsonb
       WHERE tenant_id=$1 AND endpoint=$2 AND idempotency_key=$3`,
      [tenantId, endpoint, idempotencyKey, JSON.stringify(result)]
    );

    await client.query("COMMIT");
    return result;
  } catch (err) {
    try {
      await client.query(
        `UPDATE idempotency_keys
         SET status='FAILED'
         WHERE tenant_id=$1 AND endpoint=$2 AND idempotency_key=$3`,
        [tenantId, endpoint, idempotencyKey]
      );
    } catch {}
    try { await client.query("ROLLBACK"); } catch {}
    throw err;
  } finally {
    client.release();
  }
}
