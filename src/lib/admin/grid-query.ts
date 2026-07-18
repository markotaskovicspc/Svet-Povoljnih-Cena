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

function matches(value: ErpValue, filter: AdminGridFilter) {
  const actualText = gridTextValue(value).trim().toLowerCase();
  const expectedText = filter.value.trim().toLowerCase();
  if (!expectedText) return true;
  const actualNumber = Number(actualText.replace(",", "."));
  const expectedNumber = Number(expectedText.replace(",", "."));
  switch (filter.operator ?? "contains") {
    case "contains":
      return actualText.includes(expectedText);
    case "equals":
      return actualText === expectedText;
    case "not_equals":
      return actualText !== expectedText;
    case "gt":
      return actualNumber > expectedNumber;
    case "gte":
      return actualNumber >= expectedNumber;
    case "lt":
      return actualNumber < expectedNumber;
    case "lte":
      return actualNumber <= expectedNumber;
    case "before":
      return new Date(actualText).getTime() < new Date(expectedText).getTime();
    case "after":
      return new Date(actualText).getTime() > new Date(expectedText).getTime();
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
    return filters.every((filter) => matches(row.values[filter.columnKey], filter));
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
      if (comparison !== 0) return sort.direction === "asc" ? comparison : -comparison;
    }
    return 0;
  });
}
