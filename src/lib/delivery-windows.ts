import "server-only";

import { unstable_cache } from "next/cache";
import { z } from "zod";
import { db, hasDatabaseConnection } from "@/lib/db";

export const DELIVERY_WINDOWS_SETTING_KEY = "delivery.windows";

export const DEFAULT_DELIVERY_WINDOWS = {
  dc: { min: 3, max: 5 },
  supplier: { min: 2, max: 3 },
} as const;

const windowSchema = z
  .object({
    min: z.coerce.number().int().min(0).max(60),
    max: z.coerce.number().int().min(0).max(60),
  })
  .refine((value) => value.min <= value.max, {
    message: "Minimalni rok ne može biti veći od maksimalnog.",
  });

export const deliveryWindowsSchema = z.object({
  dc: windowSchema,
  supplier: windowSchema,
});

export type DeliveryWindows = z.infer<typeof deliveryWindowsSchema>;

async function loadDeliveryWindows(): Promise<DeliveryWindows> {
  if (!hasDatabaseConnection()) return DEFAULT_DELIVERY_WINDOWS;
  const setting = await db.adminSetting.findUnique({
    where: { key: DELIVERY_WINDOWS_SETTING_KEY },
    select: { value: true },
  });
  const parsed = deliveryWindowsSchema.safeParse(setting?.value);
  return parsed.success ? parsed.data : DEFAULT_DELIVERY_WINDOWS;
}

const getCachedDeliveryWindows = unstable_cache(
  loadDeliveryWindows,
  [DELIVERY_WINDOWS_SETTING_KEY],
  { revalidate: 60, tags: [DELIVERY_WINDOWS_SETTING_KEY] },
);

export function getDeliveryWindows() {
  return getCachedDeliveryWindows();
}

export function resolveDeliveryWindow(
  availabilitySource: "DC" | "SUPPLIER" | "MIXED" | "NONE" | undefined,
  windows: DeliveryWindows,
) {
  return availabilitySource === "SUPPLIER" ? windows.supplier : windows.dc;
}

export function resolveDeliveryWindowForQuantity(
  input: {
    quantity: number;
    dcAvailable: number;
    supplierAvailable: number;
  },
  windows: DeliveryWindows,
) {
  const quantity = Math.max(1, Math.trunc(input.quantity));
  const dcAvailable = Math.max(0, Math.trunc(input.dcAvailable));
  const supplierAvailable = Math.max(0, Math.trunc(input.supplierAvailable));
  if (dcAvailable >= quantity) return windows.dc;
  if (dcAvailable + supplierAvailable >= quantity && supplierAvailable > 0) {
    return windows.supplier;
  }
  return windows.dc;
}
