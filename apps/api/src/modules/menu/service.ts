import { prisma } from "../../lib/prisma";

export async function fetchMenuItems(tenantId: string, storeId: string) {
  const items = await prisma.menu_items.findMany({
    where: { tenant_id: tenantId, store_id: storeId, active: true },
    select: { id: true, name: true, price_cents: true },
    orderBy: { name: "asc" },
  });
  return items;
}
