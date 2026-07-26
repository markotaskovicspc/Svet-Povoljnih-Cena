import "server-only";

import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import {
  getSmallParcelProvider,
  type SmallParcelProvider,
} from "@/lib/mygls/config";

export const SMALL_PARCEL_PROVIDER_SETTING_KEY =
  "courier.smallParcelProvider";

export async function getSelectedSmallParcelProvider(): Promise<SmallParcelProvider> {
  const setting = await db.adminSetting.findUnique({
    where: { key: SMALL_PARCEL_PROVIDER_SETTING_KEY },
    select: { value: true },
  });
  return normalizeSmallParcelProvider(setting?.value) ?? getSmallParcelProvider();
}

export async function setSelectedSmallParcelProvider(
  provider: SmallParcelProvider,
  actorId: string,
) {
  return db.adminSetting.upsert({
    where: { key: SMALL_PARCEL_PROVIDER_SETTING_KEY },
    create: {
      key: SMALL_PARCEL_PROVIDER_SETTING_KEY,
      value: provider,
      updatedBy: actorId,
    },
    update: {
      value: provider,
      updatedBy: actorId,
    },
  });
}

export function normalizeSmallParcelProvider(
  value: Prisma.JsonValue | null | undefined,
): SmallParcelProvider | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toUpperCase();
  if (normalized === "MYGLS") return "MYGLS";
  if (normalized === "X_EXPRESS" || normalized === "XPRESS") {
    return "X_EXPRESS";
  }
  return null;
}
