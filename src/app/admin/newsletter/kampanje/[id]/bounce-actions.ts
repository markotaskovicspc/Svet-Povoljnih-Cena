"use server";

import { z } from "zod";
import { requireAdminAction } from "@/lib/admin";
import { db } from "@/lib/db";

const inputSchema = z.object({
  campaignId: z.string().min(1).max(100),
  afterId: z.string().min(1).max(100).optional(),
});

export async function getNewsletterBounces(input: { campaignId: string; afterId?: string }) {
  await requireAdminAction(["ADS"]);
  const { campaignId, afterId } = inputSchema.parse(input);
  // Use the same event predicate as the campaign's bounce count. A later
  // complaint/status transition must not hide an earlier bounce.
  const rows = await db.newsletterCampaignRecipient.findMany({
    where: { campaignId, bouncedAt: { not: null }, ...(afterId ? { id: { gt: afterId } } : {}) },
    orderBy: { id: "asc" },
    take: 51,
    select: { id: true, email: true, bouncedAt: true },
  });
  const items = rows.slice(0, 50).map((row) => ({
    id: row.id,
    email: row.email,
    bouncedAt: row.bouncedAt?.toISOString() ?? null,
  }));
  return { items, nextCursor: rows.length > 50 ? items[items.length - 1].id : null };
}
