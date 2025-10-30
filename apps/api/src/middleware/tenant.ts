import { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";

const slugSchema = z.string().regex(/^[a-z0-9-]{3,}$/,"invalid slug");

export async function tenantScope(req: Request, res: Response, next: NextFunction) {
  const slug = (req.header("x-tenant-slug") || "").trim();
  const parsed = slugSchema.safeParse(slug);
  if (!parsed.success) return res.status(400).json({ error: "x-tenant-slug required", details: parsed.error.flatten() });

  try {
    const tenant = await prisma.tenants.findUnique({ where: { slug } });
    if (!tenant) return res.status(404).json({ error: "tenant/store not found" });

    const store = await prisma.stores.findFirst({
      where: { tenant_id: tenant.id },
      orderBy: { created_at: "asc" },
    });
    if (!store) return res.status(404).json({ error: "tenant/store not found" });

    (req as any).tenantId = tenant.id;
    (req as any).storeId  = store.id;
    next();
  } catch (err) {
    res.status(500).json({ error: "Database error", details: (err as any).message });
  }
}
