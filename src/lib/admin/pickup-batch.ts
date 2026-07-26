import type { PickupBatchStatus } from "@prisma/client";

export const PICKUP_BATCH_EXTERNAL_BLOCK_REASON =
  "Čeka se GLS API za najavu preuzimanja. Nalog može da se pripremi, ali još ne može da se proknjiži i pošalje kurirskoj službi.";

export const PICKUP_BATCH_STATUS_LABEL: Record<PickupBatchStatus, string> = {
  DRAFT: "Novi",
  POSTING: "Slanje kuriru",
  BOOKED: "Proknjižen",
  PICKED_UP: "Preuzet",
  CANCELLED: "Otkazan",
};

export function isPickupBatchEditable(status: PickupBatchStatus) {
  return status === "DRAFT";
}

export function nextPickupBatchNumber(
  existingNumbers: readonly string[],
  year: number,
) {
  const prefix = `PRE-${year}-`;
  const maxSequence = existingNumbers.reduce((max, number) => {
    if (!number.startsWith(prefix)) return max;
    const sequence = Number.parseInt(number.slice(prefix.length), 10);
    return Number.isFinite(sequence) ? Math.max(max, sequence) : max;
  }, 0);
  return `${prefix}${String(maxSequence + 1).padStart(4, "0")}`;
}
