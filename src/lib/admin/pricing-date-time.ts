export const PRICING_TIME_ZONE = "Europe/Belgrade";

/** Inclusive calendar dates used by the price-list form. Empty means unbounded. */
export function parseBelgradePricingDate(
  value: string | null | undefined,
  boundary: "start" | "end",
) {
  if (!value?.trim()) return null;
  const instant = parseBelgradePricingDateTime(
    `${value.trim()}T${boundary === "start" ? "00:00:00" : "23:59:59"}`,
  );
  if (boundary === "end") instant.setUTCMilliseconds(999);
  return instant;
}

const DATE_TIME_LOCAL_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/;

/** Converts an admin datetime-local wall clock in Serbia into a UTC instant. */
export function parseBelgradePricingDateTime(value: string) {
  const match = value.match(DATE_TIME_LOCAL_PATTERN);
  if (!match) throw new Error("Datum i vreme nisu ispravni.");

  const [, year, month, day, hour, minute, second = "0"] = match;
  const expected = {
    year: Number(year),
    month: Number(month),
    day: Number(day),
    hour: Number(hour),
    minute: Number(minute),
    second: Number(second),
  };
  const wallClockUtc = Date.UTC(
    expected.year,
    expected.month - 1,
    expected.day,
    expected.hour,
    expected.minute,
    expected.second,
  );
  const calendarCheck = new Date(wallClockUtc);
  if (
    calendarCheck.getUTCFullYear() !== expected.year ||
    calendarCheck.getUTCMonth() !== expected.month - 1 ||
    calendarCheck.getUTCDate() !== expected.day ||
    calendarCheck.getUTCHours() !== expected.hour ||
    calendarCheck.getUTCMinutes() !== expected.minute ||
    calendarCheck.getUTCSeconds() !== expected.second
  ) {
    throw new Error("Datum i vreme nisu ispravni.");
  }

  let instant = calendarCheck;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    instant = new Date(wallClockUtc - timeZoneOffsetMs(instant));
  }

  const actual = dateParts(instant);
  if (
    actual.year !== expected.year ||
    actual.month !== expected.month ||
    actual.day !== expected.day ||
    actual.hour !== expected.hour ||
    actual.minute !== expected.minute ||
    actual.second !== expected.second
  ) {
    throw new Error(
      "Izabrano lokalno vreme ne postoji zbog promene računanja vremena.",
    );
  }
  return instant;
}

/** Formats a stored UTC instant for an admin datetime-local control in Serbia. */
export function formatBelgradePricingDateTime(value: Date | null) {
  if (!value) return "";
  const parts = dateParts(value);
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}T${pad(parts.hour)}:${pad(parts.minute)}`;
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
      timeZone: PRICING_TIME_ZONE,
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
