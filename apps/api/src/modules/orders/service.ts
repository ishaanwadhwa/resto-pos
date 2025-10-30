import { prisma } from "../../lib/prisma";
import { hashBody } from "../../lib/hash";
import { redisPublishClient } from "../../lib/redis";
import { Prisma } from "@prisma/client";

export interface OrderItemInput { menuItemId: string; qty?: number; notes?: string | null }

async function createOrderWithPrisma(
  tx: Prisma.TransactionClient,
  tenantId: string,
  storeId: string,
  type: string,
  items: OrderItemInput[],
) {
  const ids = items.map(i => i.menuItemId);
  const menu = await tx.menu_items.findMany({ where: { tenant_id: tenantId, store_id: storeId, id: { in: ids }, active: true }, select: { id: true, name: true, price_cents: true } });
  if (menu.length !== ids.length) {
    throw Object.assign(new Error("one or more menu items invalid"), { status: 400 });
  }
  const menuById: Record<string, { id: string; name: string; price_cents: number }> = Object.fromEntries(menu.map(r => [r.id, r]));

  const order = await tx.orders.create({ data: { tenant_id: tenantId, store_id: storeId, type, status: "IN_KITCHEN", subtotal_cents: 0, total_cents: 0 }, select: { id: true } });

  let subtotal = 0;
  for (const it of items) {
    const m = menuById[it.menuItemId];
    const qty = Number(it.qty ?? 1);
    if (!Number.isFinite(qty) || qty <= 0) { throw Object.assign(new Error("invalid qty"), { status: 400 }); }
    const line = m.price_cents * qty;
    subtotal += line;
    await tx.order_items.create({ data: { order_id: order.id, menu_item_id: m.id, name_snapshot: m.name, unit_price_cents: m.price_cents, qty: new Prisma.Decimal(qty), notes: null } });
  }

  await tx.orders.update({ where: { id: order.id }, data: { subtotal_cents: subtotal, total_cents: subtotal } });

  const station = await tx.kitchen_stations.findFirst({ where: { tenant_id: tenantId, store_id: storeId }, orderBy: { name: "asc" }, select: { id: true } });
  if (!station) { throw Object.assign(new Error("no kitchen station configured"), { status: 400 }); }
  const ticket = await tx.tickets.create({ data: { tenant_id: tenantId, store_id: storeId, order_id: order.id, station_id: station.id, status: "QUEUED" }, select: { id: true } });

  const oItems = await tx.order_items.findMany({ where: { order_id: order.id }, select: { id: true, name_snapshot: true, qty: true } });
  for (const oi of oItems) { await tx.ticket_items.create({ data: { ticket_id: ticket.id, order_item_id: oi.id, label: oi.name_snapshot, qty: oi.qty } }); }

  return { orderId: order.id, ticketId: ticket.id, total_cents: subtotal };
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

  const endpoint = "/orders";
  const requestHash = hashBody({ type, items });

  try {
    try {
      await prisma.idempotency_keys.create({ data: { tenant_id: tenantId, endpoint, idempotency_key: idempotencyKey, request_hash: requestHash, status: "PENDING" } });
    } catch (e: any) {
      if ((e as Prisma.PrismaClientKnownRequestError).code === "P2002") {
        const row = await prisma.idempotency_keys.findUnique({ where: { tenant_id_endpoint_idempotency_key: { tenant_id: tenantId, endpoint, idempotency_key: idempotencyKey } }, select: { status: true, request_hash: true, response_json: true } });
        if (!row) throw new Error("idempotency lookup failed");
        if (row.request_hash !== requestHash) { throw Object.assign(new Error("idempotency key reused with different payload"), { status: 400 }); }
        if (row.status === "COMPLETED" && row.response_json) { return { result: row.response_json as any, fromCache: true }; }
        throw Object.assign(new Error("request in progress"), { status: 409 });
      }
      throw e;
    }

    const result = await prisma.$transaction(async (tx) => {
      return await createOrderWithPrisma(tx, tenantId, storeId, type, items);
    });

    await prisma.idempotency_keys.update({ where: { tenant_id_endpoint_idempotency_key: { tenant_id: tenantId, endpoint, idempotency_key: idempotencyKey } }, data: { status: "COMPLETED", response_json: result as any } });

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
    try { await prisma.idempotency_keys.update({ where: { tenant_id_endpoint_idempotency_key: { tenant_id: tenantId, endpoint, idempotency_key: idempotencyKey } }, data: { status: "FAILED" } }); } catch {}
    throw err;
  }
}

export async function addPayment(
  tenantId: string,
  storeId: string,
  orderId: string,
  body: { method: "CASH"|"CARD"|"UPI"|"WALLET"|"COUPON"; amount_cents: number; ref?: string },
  idemKey?: string | null
) {
  try {
    if (!idemKey) { const err: any = new Error("Idempotency-Key required"); err.status = 400; throw err; }
    const endpoint = "/orders/:id/pay";
    const reqHash = hashBody({ orderId, ...body });

    try {
      await prisma.idempotency_keys.create({ data: { tenant_id: tenantId, endpoint, idempotency_key: idemKey!, request_hash: reqHash, status: "PENDING" } });
    } catch (e: any) {
      if ((e as Prisma.PrismaClientKnownRequestError).code === "P2002") {
        const r = await prisma.idempotency_keys.findUnique({ where: { tenant_id_endpoint_idempotency_key: { tenant_id: tenantId, endpoint, idempotency_key: idemKey! } }, select: { status: true, request_hash: true, response_json: true } });
        if (!r) { const err: any = new Error("idempotency lookup failed"); err.status = 409; throw err; }
        if (r.request_hash !== reqHash) { const err: any = new Error("idempotency key reused with different payload"); err.status = 400; throw err; }
        if (r.status === "COMPLETED" && r.response_json) return r.response_json as any;
        const err: any = new Error("request in progress"); err.status = 409; throw err;
      }
      throw e;
    }

    const response = await prisma.$transaction(async (tx) => {
      const ord = await tx.orders.findFirst({ where: { id: orderId, tenant_id: tenantId, store_id: storeId }, select: { id: true, total_cents: true, status: true } });
      if (!ord) { const e:any=new Error("order not found"); e.status=404; throw e; }
      if (ord.status === "CANCELED") { const e:any=new Error("order canceled"); e.status=400; throw e; }

      const paidAgg = await tx.payments.aggregate({ _sum: { amount_cents: true }, where: { order_id: orderId } });
      const paidCents = Number(paidAgg._sum.amount_cents ?? 0);
      const totalCents = Number(ord.total_cents);
      const remaining = Math.max(totalCents - paidCents, 0);

      const amount = body.amount_cents;
      let applied = amount;
      let change = 0;
      if (amount > remaining) {
        if (body.method === "CASH") { applied = remaining; change = amount - remaining; }
        else { const e:any=new Error("Overpayment not allowed for this method"); e.status=400; throw e; }
      }

      await tx.payments.create({ data: { order_id: orderId, method: body.method as any, amount_cents: applied, ref: body.ref ?? null, change_cents: change } });

      const paidNowAgg = await tx.payments.aggregate({ _sum: { amount_cents: true }, where: { order_id: orderId } });
      const paidNow = Number(paidNowAgg._sum.amount_cents ?? 0);
      let closed = false;
      if (paidNow >= totalCents) { await tx.orders.update({ where: { id: orderId }, data: { status: "CLOSED", closed_at: new Date() } }); closed = true; }
      const remainingNow = Math.max(totalCents - paidNow, 0);

      return { orderId, total_cents: totalCents, paid_cents: paidNow, remaining_cents: remainingNow, closed, change_cents: change };
    });

    await prisma.idempotency_keys.update({ where: { tenant_id_endpoint_idempotency_key: { tenant_id: tenantId, endpoint, idempotency_key: idemKey! } }, data: { status: "COMPLETED", response_json: response as any } });

    return response;
  } catch (e) {
    try { await prisma.idempotency_keys.update({ where: { tenant_id_endpoint_idempotency_key: { tenant_id: tenantId, endpoint: "/orders/:id/pay", idempotency_key: idemKey! } }, data: { status: "FAILED" } }); } catch {}
    throw e;
  }
}

const OPEN_STATUSES = ["OPEN","IN_KITCHEN","READY"] as const;
type ListOpts = { open?: boolean; status?: string; from?: Date; to?: Date };

export async function listOrders(tenantId: string, storeId: string, opts: ListOpts = {}) {
  const where: any = { tenant_id: tenantId, store_id: storeId };
  if (opts.open) {
    where.status = { in: OPEN_STATUSES as any };
  } else if (opts.status) {
    where.status = opts.status as any;
  }

  const start = opts.from ?? new Date(); start.setHours(0, 0, 0, 0);
  const end = opts.to ?? new Date(); end.setHours(23, 59, 59, 999);
  where.created_at = { gte: start, lte: end };

  const rows = await prisma.orders.findMany({
    where,
    orderBy: { created_at: "desc" },
    select: {
      id: true,
      type: true,
      status: true,
      total_cents: true,
      created_at: true,
      items: { select: { name_snapshot: true, qty: true, unit_price_cents: true } },
    },
  });

  return rows.map((r: any) => ({
    id: r.id,
    type: r.type,
    status: r.status,
    total_cents: r.total_cents,
    created_at: r.created_at,
    order_items: r.items,
  }));
}
