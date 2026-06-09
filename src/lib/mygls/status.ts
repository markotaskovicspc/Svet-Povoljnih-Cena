import type { OrderStatus, ShipmentStatus } from "@prisma/client";

const DIRECT_STATUS: Record<string, ShipmentStatus> = {
  "1": "PICKED_UP",
  "2": "IN_TRANSIT",
  "3": "IN_TRANSIT",
  "4": "OUT_FOR_DELIVERY",
  "5": "DELIVERED",
  "6": "IN_TRANSIT",
  "7": "IN_TRANSIT",
  "8": "IN_TRANSIT",
  "9": "IN_TRANSIT",
  "10": "IN_TRANSIT",
  "11": "FAILED",
  "12": "FAILED",
  "13": "FAILED",
  "14": "FAILED",
  "15": "FAILED",
  "16": "FAILED",
  "17": "RETURNED",
  "18": "FAILED",
  "19": "FAILED",
  "20": "FAILED",
  "21": "IN_TRANSIT",
  "22": "IN_TRANSIT",
  "23": "RETURNED",
  "24": "IN_TRANSIT",
  "25": "IN_TRANSIT",
  "26": "IN_TRANSIT",
  "27": "IN_TRANSIT",
  "28": "FAILED",
  "29": "FAILED",
  "30": "FAILED",
};

function normalize(value: string) {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "dj");
}

export function inferMyGlsShipmentStatus(
  code: string | number | null | undefined,
  label: string | null | undefined,
): ShipmentStatus {
  const codeText = code == null ? "" : String(code).trim();
  const direct = DIRECT_STATUS[codeText];
  if (direct) return direct;

  const text = normalize(`${codeText} ${label ?? ""}`);
  if (/(delivered|isporuc|urucen)/.test(text)) return "DELIVERED";
  if (/(return|returned|vracen|refused|odbij)/.test(text)) return "RETURNED";
  if (/(absent|failed|wrong|incomplete|problem|damaged|gresk|neuspes)/.test(text)) {
    return "FAILED";
  }
  if (/(out for delivery|during the day|kurir|dostav|isporuci)/.test(text)) {
    return "OUT_FOR_DELIVERY";
  }
  if (/(handed over|picked|preuzet)/.test(text)) return "PICKED_UP";
  if (/(center|centre|hub|sort|transit|parcel center|tranzit)/.test(text)) {
    return "IN_TRANSIT";
  }
  return "FAILED";
}

export function orderStatusForMyGlsStatus(status: ShipmentStatus): OrderStatus | null {
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
