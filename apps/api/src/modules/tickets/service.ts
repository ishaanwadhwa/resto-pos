import { prisma } from "../../lib/prisma";

export async function listTickets(tenantId: string, storeId: string) {
  return prisma.tickets.findMany({
    where: { tenant_id: tenantId, store_id: storeId, status: { in: ["QUEUED","IN_PROGRESS"] } },
    orderBy: { created_at: "desc" },
    select: { id: true, order_id: true, status: true },
  });
}


