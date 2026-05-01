/**
 * Number, currency and date formatters — all locale "sr-Latn-RS".
 */

const LOCALE = "sr-Latn-RS";

export const formatRsd = (value: number) =>
  new Intl.NumberFormat(LOCALE, {
    style: "currency",
    currency: "RSD",
    maximumFractionDigits: 0,
  }).format(value);

export const formatNumber = (value: number, fractionDigits = 0) =>
  new Intl.NumberFormat(LOCALE, {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(value);

export const formatPercent = (value: number) =>
  new Intl.NumberFormat(LOCALE, {
    style: "percent",
    maximumFractionDigits: 0,
  }).format(value / 100);

export const formatDate = (value: string | Date) =>
  new Intl.DateTimeFormat(LOCALE, {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(typeof value === "string" ? new Date(value) : value);

export const formatDateShort = (value: string | Date) =>
  new Intl.DateTimeFormat(LOCALE, {
    day: "numeric",
    month: "short",
  }).format(typeof value === "string" ? new Date(value) : value);

export const formatDimensions = ({
  w,
  d,
  h,
}: {
  w: number;
  d: number;
  h: number;
}) => `${w} × ${d} × ${h} cm`;
