const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const ADMIN_DATE_TIME = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/Belgrade",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

/** Excel dates have no time zone. Encode the same local clock shown in the ERP. */
export function toExcelAdminDate(value: string): Date | null {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  // Calendar-only fields must not acquire a time or a time-zone offset.
  if (DATE_ONLY.test(value)) return parsed;
  const parts = Object.fromEntries(
    ADMIN_DATE_TIME.formatToParts(parsed).map(({ type, value }) => [type, value]),
  );
  return new Date(Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
    parsed.getUTCMilliseconds(),
  ));
}
