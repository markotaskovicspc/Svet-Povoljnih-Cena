export const STOCKTAKE_DESTINATION_NAME = "Popis";

export const STOCKTAKE_STATUS_LABEL = {
  DRAFT: "Nacrt",
  POSTED: "Proknjižen",
  CANCELLED: "Storniran",
} as const;

export function isStocktakeDispatchEditable(status: string) {
  return status === "DRAFT";
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
