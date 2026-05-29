import "server-only";
import { cache } from "react";
import { db, hasDatabaseConnection } from "@/lib/db";

export const hasBannerPlacementColumn = cache(async () => {
  if (!hasDatabaseConnection()) return false;

  try {
    const result = await db.$queryRaw<{ exists: boolean }[]>`
      SELECT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'Banner'
          AND column_name = 'placement'
      ) AS "exists"
    `;
    return Boolean(result[0]?.exists);
  } catch {
    return false;
  }
});

export const hasHomeSectionSlotTable = cache(async () => {
  if (!hasDatabaseConnection()) return false;

  try {
    const result = await db.$queryRaw<{ exists: boolean }[]>`
      SELECT EXISTS (
        SELECT 1
        FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name = 'HomeSectionSlot'
      ) AS "exists"
    `;
    return Boolean(result[0]?.exists);
  } catch {
    return false;
  }
});
