import type {
  AdminGridFilter,
  AdminGridSort,
  ErpRow,
  ErpValue,
} from "@/lib/admin/erp";

export function gridTextValue(value: ErpValue) {
  if (value === null || value === undefined) return "";
  if (typeof value === "boolean") return value ? "Da" : "Ne";
  return String(value);
}

export function parseGridArray<T>(raw: string | null): T[] {
  if (!raw) return [];
  try {
    const value = JSON.parse(raw);
    return Array.isArray(value) ? (value as T[]) : [];
  } catch {
    return [];
  }
}

export function nextGridSorting(
  current: AdminGridSort[],
  columnKey: string,
): AdminGridSort[] {
  const existing = current.find((item) => item.columnKey === columnKey);
  if (!existing) return [{ columnKey, direction: "asc" }];
  if (existing.direction === "asc") {
    return [{ columnKey, direction: "desc" }];
  }
  return [];
}

const DATE_ONLY_VALUE = /^\d{4}-\d{2}-\d{2}$/;
const ADMIN_TIME_ZONE = "Europe/Belgrade";

function dateOnlyInAdminTimeZone(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: ADMIN_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  })
    .formatToParts(parsed)
    .reduce<Record<string, string>>((result, part) => {
      if (part.type !== "literal") result[part.type] = part.value;
      return result;
    }, {});
  return parts.year && parts.month && parts.day
    ? `${parts.year}-${parts.month}-${parts.day}`
    : null;
}

function calendarDateComparison(actualText: string, expectedText: string) {
  if (!DATE_ONLY_VALUE.test(expectedText)) return null;
  const actualDate = dateOnlyInAdminTimeZone(actualText);
  if (!actualDate) return null;
  return actualDate.localeCompare(expectedText);
}

export function gridValueMatchesFilter(
  value: ErpValue,
  filter: AdminGridFilter,
) {
  const actualText = gridTextValue(value).trim().toLowerCase();
  const expectedText = filter.value.trim().toLowerCase();
  if (!expectedText) return true;
  const actualNumber = Number(actualText.replace(",", "."));
  const expectedNumber = Number(expectedText.replace(",", "."));
  const dateComparison = calendarDateComparison(actualText, expectedText);
  switch (filter.operator ?? "contains") {
    case "contains":
      return actualText.includes(expectedText);
    case "not_contains":
      return !actualText.includes(expectedText);
    case "equals":
      return dateComparison === null
        ? actualText === expectedText
        : dateComparison === 0;
    case "not_equals":
      return dateComparison === null
        ? actualText !== expectedText
        : dateComparison !== 0;
    case "gt":
      return actualNumber > expectedNumber;
    case "gte":
      return actualNumber >= expectedNumber;
    case "lt":
      return actualNumber < expectedNumber;
    case "lte":
      return actualNumber <= expectedNumber;
    case "before":
      return dateComparison === null
        ? new Date(actualText).getTime() < new Date(expectedText).getTime()
        : dateComparison < 0;
    case "after":
      return dateComparison === null
        ? new Date(actualText).getTime() > new Date(expectedText).getTime()
        : dateComparison > 0;
  }
}

export function filterAndSortGridRows(
  rows: ErpRow[],
  columnKeys: string[],
  query: string,
  filters: AdminGridFilter[],
  sorting: AdminGridSort[],
) {
  const needle = query.trim().toLowerCase();
  const filtered = rows.filter((row) => {
    if (
      needle &&
      !columnKeys
        .map((key) => gridTextValue(row.values[key]))
        .join(" ")
        .toLowerCase()
        .includes(needle)
    ) {
      return false;
    }
    return filters.every((filter) =>
      gridValueMatchesFilter(row.values[filter.columnKey], filter),
    );
  });
  if (!sorting.length) return filtered;
  return [...filtered].sort((leftRow, rightRow) => {
    for (const sort of sorting) {
      const left = leftRow.values[sort.columnKey];
      const right = rightRow.values[sort.columnKey];
      const numericLeft = typeof left === "number" ? left : Number.NaN;
      const numericRight = typeof right === "number" ? right : Number.NaN;
      const comparison =
        Number.isFinite(numericLeft) && Number.isFinite(numericRight)
          ? numericLeft - numericRight
          : gridTextValue(left).localeCompare(gridTextValue(right), "sr-Latn");
      if (comparison !== 0)
        return sort.direction === "asc" ? comparison : -comparison;
    }
    return 0;
  });
}
