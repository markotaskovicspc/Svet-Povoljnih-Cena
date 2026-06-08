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
  const joined = `${code ?? ""} ${label ?? ""}`;
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
