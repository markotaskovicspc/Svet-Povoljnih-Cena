import type { OrderStatus } from "@/types";

export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  kreirano: "Kreirano",
  potvrdjeno: "Potvrđeno",
  u_pripremi: "U pripremi",
  spremno_za_isporuku: "Spremno za isporuku",
  u_isporuci: "U isporuci",
  isporuceno: "Isporučeno",
  otkazano: "Otkazano",
  vraceno: "Vraćeno",
};

const PROGRESS_STATUSES = [
  "kreirano",
  "potvrdjeno",
  "u_pripremi",
  "spremno_za_isporuku",
  "u_isporuci",
  "isporuceno",
] as const satisfies readonly OrderStatus[];

export type OrderTimelineStep = {
  status: (typeof PROGRESS_STATUSES)[number];
  label: string;
  done: boolean;
  current: boolean;
};

export function orderStatusTimeline(status: OrderStatus): OrderTimelineStep[] {
  const progressStatus = status === "vraceno" ? "isporuceno" : status;
  const currentIndex = PROGRESS_STATUSES.indexOf(
    progressStatus as (typeof PROGRESS_STATUSES)[number],
  );

  return PROGRESS_STATUSES.map((stepStatus, index) => ({
    status: stepStatus,
    label: ORDER_STATUS_LABELS[stepStatus],
    done: currentIndex >= 0 && index <= currentIndex,
    current: status === stepStatus,
  }));
}

export function isTerminalOrderException(status: OrderStatus) {
  return status === "otkazano" || status === "vraceno";
}
