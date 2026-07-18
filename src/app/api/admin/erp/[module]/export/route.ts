import ExcelJS from "exceljs";
import { NextResponse } from "next/server";
import { requireAdminAction } from "@/lib/admin";
import {
  getErpModule,
  type AdminGridFilter,
  type AdminGridSort,
  type ErpRow,
  type ErpValue,
} from "@/lib/admin/erp";
import { allowedRolesForErpModule } from "@/lib/admin/erp-access";

function textValue(value: ErpValue) {
  if (value === null || value === undefined) return "";
  if (typeof value === "boolean") return value ? "Da" : "Ne";
  return String(value);
}

function parseArray<T>(raw: string | null): T[] {
  if (!raw) return [];
  try {
    const value = JSON.parse(raw);
    return Array.isArray(value) ? (value as T[]) : [];
  } catch {
    return [];
  }
}

function matches(value: ErpValue, filter: AdminGridFilter) {
  const actualText = textValue(value).trim().toLowerCase();
  const expectedText = filter.value.trim().toLowerCase();
  if (!expectedText) return true;
  const actualNumber = Number(actualText.replace(",", "."));
  const expectedNumber = Number(expectedText.replace(",", "."));
  switch (filter.operator) {
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
    default:
      return false;
  }
}

function filterAndSortRows(
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
        .map((key) => textValue(row.values[key]))
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
          : textValue(left).localeCompare(textValue(right), "sr-Latn");
      if (comparison !== 0) return sort.direction === "asc" ? comparison : -comparison;
    }
    return 0;
  });
}

export async function GET(
  request: Request,
  context: { params: Promise<{ module: string }> },
) {
  const { module: slug } = await context.params;
  await requireAdminAction(allowedRolesForErpModule(slug));
  const module = await getErpModule(slug, { take: 10_000 });
  if (!module) {
    return NextResponse.json({ error: "Nepoznat admin modul." }, { status: 404 });
  }

  const search = new URL(request.url).searchParams;
  const requestedColumns = parseArray<string>(search.get("columns"));
  const knownColumns = new Map(module.columns.map((column) => [column.key, column]));
  const columns = requestedColumns
    .map((key) => knownColumns.get(key))
    .filter((column) => Boolean(column));
  const exportColumns = columns.length
    ? (columns as typeof module.columns)
    : module.columns.filter((column) => column.defaultVisible);
  const filters = parseArray<AdminGridFilter>(search.get("filters")).filter(
    (filter) =>
      filter &&
      typeof filter.columnKey === "string" &&
      knownColumns.has(filter.columnKey) &&
      typeof filter.value === "string",
  );
  const sorting = parseArray<AdminGridSort>(search.get("sorting")).filter(
    (sort) =>
      sort &&
      typeof sort.columnKey === "string" &&
      knownColumns.has(sort.columnKey) &&
      (sort.direction === "asc" || sort.direction === "desc"),
  );
  const rows = filterAndSortRows(
    module.rows,
    exportColumns.map((column) => column.key),
    search.get("q") ?? "",
    filters,
    sorting,
  );

  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Svet povoljnih cena ERP";
  workbook.created = new Date();
  const worksheet = workbook.addWorksheet(module.title.slice(0, 31), {
    views: [{ state: "frozen", ySplit: 1 }],
  });
  worksheet.columns = exportColumns.map((column) => ({
    header: column.label,
    key: column.key,
    width: Math.min(
      50,
      Math.max(
        12,
        column.label.length + 2,
        ...rows.slice(0, 100).map((row) => textValue(row.values[column.key]).length + 2),
      ),
    ),
  }));
  for (const row of rows) {
    worksheet.addRow(
      Object.fromEntries(
        exportColumns.map((column) => [column.key, row.values[column.key] ?? ""]),
      ),
    );
  }
  worksheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: Math.max(rows.length + 1, 1), column: exportColumns.length },
  };
  worksheet.getRow(1).eachCell((cell) => {
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF2F2924" },
    };
  });
  exportColumns.forEach((column, index) => {
    if (column.type === "money" || column.type === "number") {
      worksheet.getColumn(index + 1).numFmt = "#,##0.00";
    }
  });

  const buffer = await workbook.xlsx.writeBuffer();
  const bytes = new Uint8Array(buffer);
  return new Response(bytes, {
    headers: {
      "content-type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "content-disposition": `attachment; filename="${slug}.xlsx"`,
      "cache-control": "private, no-store",
    },
  });
}
