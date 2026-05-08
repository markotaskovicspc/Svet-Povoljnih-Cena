import "server-only";

import { db } from "@/lib/db";
import type { Prisma } from "@prisma/client";

export type AdChannelKey = "GOOGLE_MERCHANT" | "META" | "TIKTOK";

export interface BudgetState {
  channel: AdChannelKey;
  enabled: boolean;
  budgetRsd: number | null;
  updatedAt: string;
}

const ALL_CHANNELS: AdChannelKey[] = ["GOOGLE_MERCHANT", "META", "TIKTOK"];

function rowToState(row: {
  channel: AdChannelKey;
  enabled: boolean;
  budgetRsd: Prisma.Decimal | null;
  updatedAt: Date;
}): BudgetState {
  return {
    channel: row.channel,
    enabled: row.enabled,
    budgetRsd: row.budgetRsd ? Number(row.budgetRsd.toString()) : null,
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function listBudgets(): Promise<BudgetState[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows = (await db.adFlag.findMany()) as any[];
  const byChannel = new Map(rows.map((r) => [r.channel, rowToState(r)]));
  return ALL_CHANNELS.map(
    (ch) =>
      byChannel.get(ch) ?? {
        channel: ch,
        enabled: false,
        budgetRsd: null,
        updatedAt: new Date(0).toISOString(),
      },
  );
}

export async function upsertBudget(input: {
  channel: AdChannelKey;
  enabled: boolean;
  budgetRsd: number | null;
}): Promise<BudgetState> {
  const data = {
    enabled: input.enabled,
    budgetRsd: input.budgetRsd != null ? input.budgetRsd.toFixed(2) : null,
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const row = (await (db as any).adFlag.upsert({
    where: { channel: input.channel },
    create: { channel: input.channel, ...data },
    update: data,
  })) as {
    channel: AdChannelKey;
    enabled: boolean;
    budgetRsd: Prisma.Decimal | null;
    updatedAt: Date;
  };
  return rowToState(row);
}
