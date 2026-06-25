/**
 * Deterministic number, currency and date formatters for SSR + hydration.
 * Avoid Intl differences between Node, browser engines, and user time zones.
 */

const MONTH_SHORT = [
  "jan",
  "feb",
  "mar",
  "apr",
  "maj",
  "jun",
  "jul",
  "avg",
  "sep",
  "okt",
  "nov",
  "dec",
] as const;

function formatInteger(value: number) {
  const rounded = Math.round(value);
  const sign = rounded < 0 ? "-" : "";
  return `${sign}${Math.abs(rounded).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".")}`;
}

export function formatRsd(value: number) {
  return `${formatInteger(value)} RSD`;
}

export function formatNumber(value: number, fractionDigits = 0) {
  const fixed = value.toFixed(Math.max(0, fractionDigits));
  const [integer = "0", fraction] = fixed.split(".");
  const signed = Number(integer);
  const formattedInteger = Number.isFinite(signed)
    ? formatInteger(signed)
    : integer.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return fractionDigits > 0 ? `${formattedInteger},${fraction}` : formattedInteger;
}

export function formatPercent(value: number) {
  return `${formatInteger(value)}%`;
}

function dateParts(value: string | Date) {
  if (typeof value === "string") {
    const match = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (match) {
      return {
        year: Number(match[1]),
        month: Number(match[2]),
        day: Number(match[3]),
      };
    }
  }

  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) {
    return { year: 1970, month: 1, day: 1 };
  }

  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
  };
}

function timeParts(value: string | Date) {
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) {
    return { hours: 0, minutes: 0 };
  }

  return {
    hours: date.getUTCHours(),
    minutes: date.getUTCMinutes(),
  };
}

export function formatDate(value: string | Date) {
  const { day, month, year } = dateParts(value);
  return `${String(day).padStart(2, "0")}.${String(month).padStart(2, "0")}.${year}.`;
}

export function formatDateShort(value: string | Date) {
  const { day, month } = dateParts(value);
  return `${day}. ${MONTH_SHORT[Math.max(0, Math.min(month - 1, 11))]}`;
}

export function formatDateTime(value: string | Date) {
  const { hours, minutes } = timeParts(value);
  return `${formatDate(value)} ${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

export const formatDimensions = ({
  w,
  d,
  h,
}: {
  w: number;
  d: number;
  h: number;
}) => `${w} × ${d} × ${h} cm`;
