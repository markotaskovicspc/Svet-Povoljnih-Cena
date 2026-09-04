import type { OrderStatus, ShipmentStatus } from "@prisma/client";
import type {
  MyGlsParcelListStatusesResponse,
  MyGlsParcelStatusResponse,
  MyGlsStatusEvent,
} from "./types";

// Before zero-padded provider codes were normalized, real shipment progress
// such as 01 (pickup) and 03 (depot entry) was persisted as FAILED. Keep those
// historical spellings eligible for status reconciliation so the normal
// pickup/fiscalization side effects can resume without manual data repair.
export const MYGLS_RECOVERABLE_STATUS_CODES = [
  "01",
  "02",
  "03",
  "04",
  "05",
  "06",
  "07",
  "08",
  "09",
  "51",
  "52",
  "86",
] as const;

type StoredMyGlsShipmentStatus = {
  provider?: string | null;
  status: string;
  providerStatusCode?: string | null;
  labelObjectKey?: string | null;
  syncError?: string | null;
};

const DIRECT_STATUS: Record<string, ShipmentStatus> = {
  "51": "CREATED",
  "52": "CREATED",
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
  "86": "PICKED_UP",
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
  const normalizedCode = codeText.replace(/^0+(?=\d)/, "");
  const direct = DIRECT_STATUS[normalizedCode];
  if (direct) return direct;

  const text = normalize(`${codeText} ${label ?? ""}`);
  if (/(data sent|cod data sent|announced|registered|kreiran|najavljen)/.test(text)) {
    return "CREATED";
  }
  if (/(delivered|isporuc|urucen)/.test(text)) return "DELIVERED";
  if (/(return|returned|vracen|refused|odbij)/.test(text)) return "RETURNED";
  if (/(absent|failed|wrong|incomplete|problem|damaged|gresk|neuspes)/.test(text)) {
    return "FAILED";
  }
  if (/(out for delivery|during the day|kurir|dostav|isporuci)/.test(text)) {
    return "OUT_FOR_DELIVERY";
  }
  if (/(handed over|successful pick up|picked up|preuzet)/.test(text)) {
    return "PICKED_UP";
  }
  if (/(center|centre|depot|storage|hub|sort|transit|parcel center|tranzit)/.test(text)) {
    return "IN_TRANSIT";
  }
  return "FAILED";
}

export function effectiveMyGlsShipmentStatus(
  shipment: StoredMyGlsShipmentStatus,
) {
  if (
    shipment.provider !== "MYGLS" ||
    shipment.status !== "FAILED" ||
    !shipment.labelObjectKey ||
    shipment.syncError != null ||
    !MYGLS_RECOVERABLE_STATUS_CODES.includes(
      shipment.providerStatusCode as (typeof MYGLS_RECOVERABLE_STATUS_CODES)[number],
    )
  ) {
    return shipment.status;
  }
  return inferMyGlsShipmentStatus(shipment.providerStatusCode, null);
}

export function parseMyGlsStatusDate(value: unknown) {
  if (typeof value !== "string" || !value.trim()) return undefined;
  const dotNet = value.match(/\/Date\((\d+)(?:[+-]\d{4})?\)\//);
  const date = dotNet ? new Date(Number(dotNet[1])) : new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

export function normalizeMyGlsStatusResponses(
  response: MyGlsParcelStatusResponse | MyGlsParcelListStatusesResponse,
  fallbackNumbers: number[],
): MyGlsStatusEvent[] {
  const events =
    "ParcelList" in response && Array.isArray(response.ParcelList)
      ? response.ParcelList.flatMap((parcel) =>
          statusListToEvents(
            parcel.ParcelStatusList ?? [],
            parcel.ParcelNumber ?? fallbackNumbers[0]!,
            parcel.ClientReference,
          ),
        )
      : statusListToEvents(
          (response as MyGlsParcelStatusResponse).ParcelStatusList ?? [],
          (response as MyGlsParcelStatusResponse).ParcelNumber ?? fallbackNumbers[0]!,
          (response as MyGlsParcelStatusResponse).ClientReference,
        );

  return events.sort(
    (left, right) =>
      (right.occurredAt?.getTime() ?? 0) -
      (left.occurredAt?.getTime() ?? 0),
  );
}

function statusListToEvents(
  list: MyGlsParcelStatusResponse["ParcelStatusList"],
  parcelNumber: number,
  clientReference?: string | null,
): MyGlsStatusEvent[] {
  return (list ?? []).map((status) => {
    const code = String(status.StatusCode ?? "");
    const mapped = inferMyGlsShipmentStatus(
      code,
      status.StatusDescription ?? status.StatusInfo ?? null,
    );
    const occurredAt = parseMyGlsStatusDate(status.StatusDate);
    return {
      trackingNo: String(parcelNumber),
      parcelNumber,
      providerStatusCode: code,
      status: mapped,
      orderStatus: orderStatusForMyGlsStatus(mapped),
      message: status.StatusDescription ?? status.StatusInfo ?? null,
      occurredAt,
      providerEventId: `MYGLS:${parcelNumber}:${code}:${occurredAt?.toISOString() ?? "unknown"}`,
      raw: { ...status, clientReference },
    };
  });
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
