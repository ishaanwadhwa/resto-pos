import { getPool } from "../../db";
import { hashBody } from "../../lib/hash";
import { redisPublishClient } from "../../lib/redis";

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
): Promise<{ result: { orderId: string; ticketId: string; total_cents: number }, fromCache: boolean }> {
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
        return { result: row.response_json, fromCache: true };
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

    // Publish after successful commit (only for fresh creations)
    try {
      const channel = `tenant:${tenantId}:tickets.created`;
      const payload = JSON.stringify({ tenantId, storeId, orderId: result.orderId, ticketId: result.ticketId, total_cents: result.total_cents });
      const delivered = await redisPublishClient.publish(channel, payload);
      if (delivered === 0) {
        console.warn("Redis publish had no subscribers:", channel);
      }
    } catch (e) {
      console.error("Redis publish failed", e);
    }

    return { result, fromCache: false };
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

export async function addPayment(
  tenantId: string,
  storeId: string,
  orderId: string,
  body: { method: "CASH"|"CARD"|"UPI"|"WALLET"|"COUPON"; amount_cents: number; ref?: string },
  idemKey?: string | null
) {
  const client = await getPool().connect();
  try {
    if (!idemKey) {
      const err: any = new Error("Idempotency-Key required");
      err.status = 400; throw err;
    }
    const endpoint = "/orders/:id/pay";
    const reqHash = hashBody({ orderId, ...body });

    await client.query("BEGIN");

    // 1) Lock order & verify tenant/store
    const ord = await client.query(
      `SELECT id, total_cents, status FROM orders
       WHERE id=$1 AND tenant_id=$2 AND store_id=$3 FOR UPDATE`,
      [orderId, tenantId, storeId]
    );
    if (!ord.rows[0]) { const e:any=new Error("order not found"); e.status=404; throw e; }
    if (ord.rows[0].status === "CANCELED") { const e:any=new Error("order canceled"); e.status=400; throw e; }

    // 2) Upsert idempotency row
    const inserted = await client.query(
      `INSERT INTO idempotency_keys (tenant_id, endpoint, idempotency_key, request_hash, status)
       VALUES ($1,$2,$3,$4,'PENDING')
       ON CONFLICT (tenant_id, endpoint, idempotency_key) DO NOTHING
       RETURNING id`,
      [tenantId, endpoint, idemKey, reqHash]
    );

    if (inserted.rowCount === 0) {
      const row = await client.query(
        `SELECT status, request_hash, response_json FROM idempotency_keys
         WHERE tenant_id=$1 AND endpoint=$2 AND idempotency_key=$3`,
        [tenantId, endpoint, idemKey]
      );
      const r = row.rows[0];
      if (!r) { const e:any=new Error("idempotency lookup failed"); e.status=409; throw e; }
      if (r.request_hash !== reqHash) { const e:any=new Error("idempotency key reused with different payload"); e.status=400; throw e; }
      if (r.status === "COMPLETED" && r.response_json) { await client.query("COMMIT"); return r.response_json; }
      const e:any=new Error("request in progress"); e.status=409; throw e;
    }

    // 3) Payment application with overpay/change logic
    // 3.1 Current totals
    const paidRes = await client.query(
      `SELECT COALESCE(SUM(amount_cents), 0) AS paid FROM payments WHERE order_id = $1`,
      [orderId]
    );
    const paidCents = Number(paidRes.rows[0].paid);
    const totalCents = Number(ord.rows[0].total_cents);
    const remaining = Math.max(totalCents - paidCents, 0);

    const amount = body.amount_cents;

    // 3.2 Handle overpay / change logic
    let applied = amount;
    let change = 0;

    if (amount > remaining) {
      if (body.method === "CASH") {
        applied = remaining;
        change = amount - remaining;
      } else {
        const e: any = new Error("Overpayment not allowed for this method");
        e.status = 400;
        throw e;
      }
    }

    // 3.3 Insert payment with change_cents recorded
    await client.query(
      `INSERT INTO payments (order_id, method, amount_cents, ref, change_cents)
       VALUES ($1, $2, $3, $4, $5)`,
      [orderId, body.method, applied, body.ref ?? null, change]
    );

    // 4) Recalculate total paid and close if needed
    const paidNowRes = await client.query(
      `SELECT COALESCE(SUM(amount_cents), 0) AS paid FROM payments WHERE order_id = $1`,
      [orderId]
    );
    const paidNow = Number(paidNowRes.rows[0].paid);
    let closed = false;

    if (paidNow >= totalCents) {
      await client.query(
        `UPDATE orders SET status = 'CLOSED', closed_at = now() WHERE id = $1`,
        [orderId]
      );
      closed = true;
    }

    const remainingNow = Math.max(totalCents - paidNow, 0);

    const response = {
      orderId,
      total_cents: totalCents,
      paid_cents: paidNow,
      remaining_cents: remainingNow,
      closed,
      change_cents: change,
    };
    await client.query(
      `UPDATE idempotency_keys
         SET status='COMPLETED', response_json=$4::jsonb
       WHERE tenant_id=$1 AND endpoint=$2 AND idempotency_key=$3`,
      [tenantId, endpoint, idemKey, JSON.stringify(response)]
    );

    await client.query("COMMIT");
    return response;
  } catch (e) {
    try { await client.query(
      `UPDATE idempotency_keys SET status='FAILED'
       WHERE tenant_id=$1 AND endpoint=$2 AND idempotency_key=$3`,
      [tenantId, "/orders/:id/pay", idemKey]
    ); } catch {}
    try { await client.query("ROLLBACK"); } catch {}
    throw e;
  } finally {
    client.release();
  }
}
