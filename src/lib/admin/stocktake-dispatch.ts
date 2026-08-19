export const STOCKTAKE_DESTINATION_NAME = "Popis";

export const STOCKTAKE_STATUS_LABEL = {
  DRAFT: "Nacrt",
  POSTED: "Proknjižen",
  CANCELLED: "Storniran",
} as const;

export function isStocktakeDispatchEditable(
  status: string,
  archivedAt?: Date | string | null,
) {
  return status === "DRAFT" && !archivedAt;
}

export function stocktakeDeleteBlocker(number: string, status: string) {
  return status === "DRAFT"
    ? null
    : `Popis ${number} je proknjižen ili storniran i mora ostati u evidenciji. Možete ga arhivirati, ali ne i obrisati.`;
}

export function nextStocktakeDispatchNumber(
  existingNumbers: string[],
  year = new Date().getFullYear(),
) {
  const prefix = `POP-${year}-`;
  const lastSerial = existingNumbers.reduce((max, number) => {
    if (!number.startsWith(prefix)) return max;
    const serial = Number(number.slice(prefix.length));
    return Number.isInteger(serial) && serial > max ? serial : max;
  }, 0);

  return `${prefix}${String(lastSerial + 1).padStart(4, "0")}`;
}
