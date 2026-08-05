export const PRODUCT_NEWNESS_TIME_ZONE = "Europe/Belgrade";
export const PRODUCT_NEWNESS_MONTHS = 4;
export const SUPPLIER_IMMUTABLE_NEWNESS_FIELDS = [
  "isNew",
  "newUntil",
  "newUntilAutomatic",
] as const;

export function productNewUntilIsActive(
  newUntil: Date | null | undefined,
  now = new Date(),
) {
  if (!newUntil) return false;
  return newUntil >= productNewUntilFloor(now);
}

export function productNewUntilFloor(now = new Date()) {
  const { year, month, day } = productNewnessDateParts(now);
  return new Date(Date.UTC(year, month - 1, day));
}

/**
 * Returns the inclusive "Novo do" date for an automatically managed product.
 * Calendar-month arithmetic is clamped, so 31 October + 4 months becomes the
 * last valid day of February instead of overflowing into March.
 */
export function defaultProductNewUntil(createdAt: Date) {
  const { year, month, day } = productNewnessDateParts(createdAt);
  const targetMonthIndex = month - 1 + PRODUCT_NEWNESS_MONTHS;
  const targetYear = year + Math.floor(targetMonthIndex / 12);
  const targetMonth = ((targetMonthIndex % 12) + 12) % 12;
  const lastTargetDay = new Date(
    Date.UTC(targetYear, targetMonth + 1, 0),
  ).getUTCDate();

  return new Date(
    Date.UTC(targetYear, targetMonth, Math.min(day, lastTargetDay)),
  );
}

export function productNewnessDateInput(value: Date) {
  return value.toISOString().slice(0, 10);
}

export function resolveAdminImportedProductNewness(input: {
  columnPresent: boolean;
  incomingNewUntil: Date | null;
  existing?: {
    newUntil: Date | null;
    newUntilAutomatic: boolean;
  } | null;
}) {
  if (input.columnPresent) {
    return {
      newUntil: input.incomingNewUntil,
      newUntilAutomatic: false,
    };
  }
  if (input.existing) {
    return {
      newUntil: input.existing.newUntil,
      newUntilAutomatic: input.existing.newUntilAutomatic,
    };
  }
  return {
    newUntil: null,
    newUntilAutomatic: true,
  };
}

/** Supplier refreshes can change catalog data, but never renew newness. */
export function omitSupplierProductNewnessUpdates<
  T extends Record<string, unknown>,
>(data: T): T {
  const protectedData = { ...data };
  for (const field of SUPPLIER_IMMUTABLE_NEWNESS_FIELDS) {
    delete protectedData[field];
  }
  return protectedData;
}

function productNewnessDateParts(date: Date) {
  const values = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: PRODUCT_NEWNESS_TIME_ZONE,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    })
      .formatToParts(date)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, Number(part.value)]),
  );

  return {
    year: values.year,
    month: values.month,
    day: values.day,
  };
}
