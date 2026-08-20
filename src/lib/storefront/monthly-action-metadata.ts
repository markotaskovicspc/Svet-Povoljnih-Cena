import "server-only";

import { db, hasDatabaseConnection } from "@/lib/db";

export const MONTHLY_ACTION_METADATA_SETTING_KEY =
  "storefront.monthlyActionMetadata";

export const DEFAULT_MONTHLY_ACTION_METADATA = {
  title: "Mesečna akcija — kuratirana selekcija po sniženim cenama",
  description:
    "Aktuelna akcijska ponuda nameštaja. Heroji meseca, najveći popusti i najpovoljnije cene na jednom mestu.",
} as const;

export type MonthlyActionMetadata = {
  title: string;
  description: string;
};

export function normalizeMonthlyActionMetadata(
  value: unknown,
): MonthlyActionMetadata {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ...DEFAULT_MONTHLY_ACTION_METADATA };
  }
  const candidate = value as Record<string, unknown>;
  const title = typeof candidate.title === "string" ? candidate.title.trim() : "";
  const description =
    typeof candidate.description === "string"
      ? candidate.description.trim()
      : "";
  return {
    title: title || DEFAULT_MONTHLY_ACTION_METADATA.title,
    description: description || DEFAULT_MONTHLY_ACTION_METADATA.description,
  };
}

export async function getMonthlyActionMetadata(): Promise<MonthlyActionMetadata> {
  if (!hasDatabaseConnection()) return { ...DEFAULT_MONTHLY_ACTION_METADATA };
  try {
    const setting = await db.adminSetting.findUnique({
      where: { key: MONTHLY_ACTION_METADATA_SETTING_KEY },
      select: { value: true },
    });
    return normalizeMonthlyActionMetadata(setting?.value);
  } catch (error) {
    console.error("Failed to load monthly action metadata", error);
    return { ...DEFAULT_MONTHLY_ACTION_METADATA };
  }
}
