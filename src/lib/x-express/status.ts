import type { OrderStatus, ShipmentStatus } from "@prisma/client";

function normalize(value: string) {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "dj");
}

export function inferXExpressShipmentStatus(
  code: string | null | undefined,
  label: string | null | undefined,
): ShipmentStatus {
  const normalizedCode = String(code ?? "").trim().toUpperCase();
  if (
    normalizedCode === "CREATED" ||
    normalizedCode === "REQUEST_RECEIVED" ||
    normalizedCode === "REGISTERED" ||
    normalizedCode === "ANNOUNCED" ||
    normalizedCode === "PCK_ASGN_MISS" ||
    normalizedCode === "PCK_ASGN_OVERLOAD"
  ) {
    return "CREATED";
  }
  if (normalizedCode === "PICKEDUP" || normalizedCode === "PICKED_UP") {
    return "PICKED_UP";
  }
  if (
    normalizedCode === "DLV_ASSIGNED" ||
    normalizedCode === "DLV_TO_PUDO" ||
    normalizedCode === "PUDO_DEPOSITED" ||
    normalizedCode === "OUT_FOR_DELIVERY"
  ) {
    return "OUT_FOR_DELIVERY";
  }
  if (
    normalizedCode === "DELIVERED" ||
    normalizedCode === "PUDO_DELIVERED" ||
    normalizedCode === "PUDO_RETRIEVED"
  ) {
    return "DELIVERED";
  }
  if (
    normalizedCode === "RETURNING" ||
    normalizedCode === "RET_ASSIGNED" ||
    normalizedCode === "REVERSE_RETURN" ||
    normalizedCode === "REVERSE_RETURNING"
  ) {
    return "IN_TRANSIT";
  }
  if (
    normalizedCode === "RETURNED" ||
    normalizedCode === "REFUSED" ||
    normalizedCode === "REVERSE_DELIVERY"
  ) {
    return "RETURNED";
  }
  if (
    normalizedCode.startsWith("PCK_FAIL") ||
    normalizedCode.startsWith("DLV_FAIL") ||
    normalizedCode === "DELETED" ||
    normalizedCode === "CONFISCATED" ||
    normalizedCode === "DAMAGED" ||
    normalizedCode === "LOST" ||
    normalizedCode === "PUDO_NOTPOSSIBLE" ||
    normalizedCode === "RCP_DLV_REJECTED" ||
    normalizedCode === "SRVC_CANCELED" ||
    normalizedCode.includes("CANCELED") ||
    normalizedCode.includes("CANCELLED")
  ) {
    return "FAILED";
  }

  const joined = `${normalizedCode} ${label ?? ""}`;
  const text = normalize(joined);

  if (/(isporuc|delivered|urucen)/.test(text)) return "DELIVERED";
  if (/(vracen|povrat|return|refused|odbij)/.test(text)) return "RETURNED";
  if (/(neuspes|failed|exception|problem|storn|gresk)/.test(text)) {
    return "FAILED";
  }
  if (/(preuzet|pickup|picked)/.test(text)) return "PICKED_UP";
  if (/(isporuci|dostav|kurir|delivery)/.test(text)) {
    return "OUT_FOR_DELIVERY";
  }
  if (/(tranzit|transport|sortir|hub|magacin|u toku|in transit)/.test(text)) {
    return "IN_TRANSIT";
  }
  if (/(kreir|najav|created|registered|formiran)/.test(text)) {
    return "CREATED";
  }

  // Fail closed: unknown carrier statuses become an admin-visible exception
  // instead of silently pretending the package is still moving normally.
  return "FAILED";
}

export function orderStatusForXExpressStatus(
  status: ShipmentStatus,
): OrderStatus | null {
  switch (status) {
    case "DELIVERED":
      return "ISPORUCENO";
    case "RETURNED":
      return "VRACENO";
    case "IN_TRANSIT":
    case "OUT_FOR_DELIVERY":
      return "U_ISPORUCI";
    case "PICKED_UP":
      return "SPREMNO_ZA_ISPORUKU";
    case "CREATED":
    case "FAILED":
      return null;
  }
}
