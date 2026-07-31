import type { PickupBatchStatus } from "@prisma/client";

export const PICKUP_BATCH_EXTERNAL_BLOCK_REASON =
  "MyGLS produkcijski pozivi su bezbednosno zaključani dok je MYGLS_PRODUCTION_ACCEPTED=false. Nalog i paketi mogu da se pripreme bez slanja GLS-u.";

export const MYGLS_PICKUP_MIN_LEAD_MS = 24 * 60 * 60_000;
export const MYGLS_PICKUP_MIN_WINDOW_MS = 2 * 60 * 60_000;
export const PICKUP_TIME_ZONE = "Europe/Belgrade";

export const MYGLS_BOOKING_CHANNELS = [
  "MYGLS_PORTAL",
  "EMAIL",
  "PHONE",
  "FIXED_SCHEDULE",
] as const;

export type MyGlsBookingChannel = (typeof MYGLS_BOOKING_CHANNELS)[number];

export const MYGLS_BOOKING_CHANNEL_LABEL: Record<MyGlsBookingChannel, string> = {
  MYGLS_PORTAL: "MyGLS portal",
  EMAIL: "Email",
  PHONE: "Telefon",
  FIXED_SCHEDULE: "Stalni termin",
};

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

export function validateMyGlsPickupWindow(
  start: Date,
  end: Date,
  now = new Date(),
  options: { requireLeadTime?: boolean } = {},
) {
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    throw new Error("Termin preuzimanja nije ispravan.");
  }
  if (
    options.requireLeadTime !== false &&
    start.getTime() - now.getTime() < MYGLS_PICKUP_MIN_LEAD_MS
  ) {
    throw new Error(
      "Prvi MyGLS prikup mora biti najavljen najmanje 24 sata unapred.",
    );
  }
  if (end.getTime() - start.getTime() < MYGLS_PICKUP_MIN_WINDOW_MS) {
    throw new Error("MyGLS vremenski prozor mora trajati najmanje 2 sata.");
  }
  return { start, end };
}

/** Parses a datetime-local value as a wall-clock time in Europe/Belgrade. */
export function parseBelgradeDateTimeLocal(value: string) {
  const match = value.match(
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/,
  );
  if (!match) throw new Error("Termin preuzimanja nije ispravan.");
  const [, y, m, d, h, min, sec = "0"] = match;
  const wallClockUtc = Date.UTC(+y, +m - 1, +d, +h, +min, +sec);
  let instant = new Date(wallClockUtc);
  for (let attempt = 0; attempt < 2; attempt += 1) {
    instant = new Date(wallClockUtc - timeZoneOffsetMs(instant));
  }
  return instant;
}

export function formatBelgradeDateTimeLocal(value: Date | null) {
  if (!value) return "";
  const parts = dateParts(value);
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}T${pad(parts.hour)}:${pad(parts.minute)}`;
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

function timeZoneOffsetMs(date: Date) {
  const parts = dateParts(date);
  const representedAsUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );
  return representedAsUtc - Math.floor(date.getTime() / 1000) * 1000;
}

function dateParts(date: Date) {
  const values = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: PICKUP_TIME_ZONE,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(date)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, Number(part.value)]),
  );
  return {
    year: values.year,
    month: values.month,
    day: values.day,
    hour: values.hour,
    minute: values.minute,
    second: values.second,
  };
}

function pad(value: number) {
  return String(value).padStart(2, "0");
}
