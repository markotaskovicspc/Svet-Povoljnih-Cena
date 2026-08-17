import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { requireAdminAction } from "@/lib/admin";
import { db } from "@/lib/db";
import { getErpModuleDefinition } from "@/lib/admin/erp";
import {
  DASHBOARD_CONTEXT_KEYS,
  isDashboardContextEntry,
} from "@/lib/admin/dashboard-context";
import { allowedNavFor } from "@/lib/admin/nav";

const ADMIN_NAVIGATION_MODULE = "admin-navigation";

const GRID_OPERATORS = new Set([
  "contains",
  "not_contains",
  "equals",
  "not_equals",
  "gt",
  "gte",
  "lt",
  "lte",
  "before",
  "after",
]);

type SavedViewPayload = {
  module?: unknown;
  name?: unknown;
  query?: unknown;
  searchColumn?: unknown;
  filters?: unknown;
  sorting?: unknown;
  visibleColumns?: unknown;
  columnOrder?: unknown;
  columnWidths?: unknown;
  isDefault?: unknown;
  context?: unknown;
};

function toView(row: {
  id: string;
  name: string;
  query: Prisma.JsonValue;
  filters: Prisma.JsonValue;
  sorting: Prisma.JsonValue;
  columns: Prisma.JsonValue;
  isDefault: boolean;
}) {
  const columns =
    row.columns && typeof row.columns === "object" && !Array.isArray(row.columns)
      ? (row.columns as Record<string, Prisma.JsonValue>)
      : {};
  return {
    id: row.id,
    name: row.name,
    query: typeof row.query === "string" ? row.query : "",
    searchColumn:
      typeof columns.searchColumn === "string" ? columns.searchColumn : "",
    filters: Array.isArray(row.filters) ? row.filters : [],
    sorting: Array.isArray(row.sorting) ? row.sorting : [],
    visibleColumns: Array.isArray(columns.visibleColumns)
      ? columns.visibleColumns
      : [],
    columnOrder: Array.isArray(columns.columnOrder) ? columns.columnOrder : [],
    columnWidths:
      columns.columnWidths &&
      typeof columns.columnWidths === "object" &&
      !Array.isArray(columns.columnWidths)
        ? columns.columnWidths
        : {},
    context:
      columns.context &&
      typeof columns.context === "object" &&
      !Array.isArray(columns.context)
        ? columns.context
        : {},
    isDefault: row.isDefault,
  };
}

export async function GET(request: Request) {
  const admin = await requireAdminAction();
  const moduleSlug =
    new URL(request.url).searchParams.get("module")?.trim() ?? "";
  if (
    moduleSlug !== "dashboard" &&
    moduleSlug !== ADMIN_NAVIGATION_MODULE &&
    !getErpModuleDefinition(moduleSlug)
  ) {
    return NextResponse.json({ error: "Nepoznat admin modul." }, { status: 400 });
  }
  const rows = await db.adminSavedView.findMany({
    where: { adminUserId: admin.id, module: moduleSlug },
    orderBy: [{ isDefault: "desc" }, { name: "asc" }],
    select: {
      id: true,
      name: true,
      query: true,
      filters: true,
      sorting: true,
      columns: true,
      isDefault: true,
    },
  });
  return NextResponse.json({ views: rows.map(toView) });
}

export async function POST(request: Request) {
  const admin = await requireAdminAction();
  const body = (await request.json().catch(() => null)) as SavedViewPayload | null;
  const moduleSlug =
    typeof body?.module === "string" ? body.module.trim() : "";
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  const query = typeof body?.query === "string" ? body.query.slice(0, 500) : "";
  const definition = getErpModuleDefinition(moduleSlug);
  if (
    (moduleSlug !== "dashboard" &&
      moduleSlug !== ADMIN_NAVIGATION_MODULE &&
      !definition) ||
    !name ||
    name.length > 80
  ) {
    return NextResponse.json(
      { error: "Modul i naziv pogleda su obavezni (najviše 80 znakova)." },
      { status: 400 },
    );
  }

  const knownColumns = new Set(
    moduleSlug === ADMIN_NAVIGATION_MODULE
      ? allowedNavFor(admin.role).flatMap((group) =>
          group.items.map((item) => item.href),
        )
      : (definition?.columns.map((column) => column.key) ?? []),
  );
  const cleanColumns = (value: unknown) =>
    Array.isArray(value)
      ? Array.from(
          new Set(
            value.filter(
              (item): item is string =>
                typeof item === "string" && knownColumns.has(item),
            ),
          ),
        )
      : [];
  const visibleColumns = cleanColumns(body?.visibleColumns);
  const searchColumn =
    typeof body?.searchColumn === "string" && knownColumns.has(body.searchColumn)
      ? body.searchColumn
      : "";
  const columnOrder = cleanColumns(body?.columnOrder);
  const filters = Array.isArray(body?.filters)
    ? body.filters.flatMap((value) => {
        if (!value || typeof value !== "object" || Array.isArray(value)) return [];
        const row = value as Record<string, unknown>;
        if (
          typeof row.id !== "string" ||
          typeof row.columnKey !== "string" ||
          !knownColumns.has(row.columnKey) ||
          typeof row.operator !== "string" ||
          !GRID_OPERATORS.has(row.operator) ||
          typeof row.value !== "string" ||
          row.value.length > 500
        ) {
          return [];
        }
        return [
          {
            id: row.id.slice(0, 100),
            columnKey: row.columnKey,
            operator: row.operator,
            value: row.value,
          },
        ];
      })
    : [];
  const sorting = Array.isArray(body?.sorting)
    ? body.sorting.flatMap((value) => {
        if (!value || typeof value !== "object" || Array.isArray(value)) return [];
        const row = value as Record<string, unknown>;
        if (
          typeof row.columnKey !== "string" ||
          !knownColumns.has(row.columnKey) ||
          (row.direction !== "asc" && row.direction !== "desc")
        ) {
          return [];
        }
        return [{ columnKey: row.columnKey, direction: row.direction }];
      })
    : [];
  const columnWidths =
    body?.columnWidths &&
    typeof body.columnWidths === "object" &&
    !Array.isArray(body.columnWidths)
      ? Object.fromEntries(
          Object.entries(body.columnWidths).flatMap(([key, value]) =>
            knownColumns.has(key) &&
            typeof value === "number" &&
            Number.isFinite(value) &&
            value >= 60 &&
            value <= 1_200
              ? [[key, Math.round(value)]]
              : [],
          ),
        )
      : {};
  const contextKeys = new Set(
    moduleSlug === "dashboard"
      ? DASHBOARD_CONTEXT_KEYS
      : moduleSlug === ADMIN_NAVIGATION_MODULE
        ? []
      : moduleSlug === "artikli"
      ? ["warehouseId"]
      : (definition?.contextFilters ?? []).map((filter) => filter.key),
  );
  const rawContextEntries =
    body?.context && typeof body.context === "object" && !Array.isArray(body.context)
      ? Object.entries(body.context)
      : [];
  if (
    moduleSlug === "dashboard" &&
    rawContextEntries.some(
      ([key, value]) =>
        !contextKeys.has(key) || !isDashboardContextEntry(key, value),
    )
  ) {
    return NextResponse.json(
      { error: "Dashboard pogled sadrži nedozvoljen ili neispravan filter." },
      { status: 400 },
    );
  }
  const context =
    rawContextEntries.length
      ? Object.fromEntries(
          rawContextEntries.filter(
            ([key, value]) =>
              typeof value === "string" &&
              value.length <= 120 &&
              contextKeys.has(key),
          ),
        )
      : {};

  const row = await db.$transaction(async (tx) => {
    if (body?.isDefault === true) {
      // Serialize default changes per admin/module without adding a migration.
      await tx.$executeRaw(Prisma.sql`
        SELECT pg_advisory_xact_lock(
          hashtextextended(${`${admin.id}:${moduleSlug}`}, 0)
        )
      `);
      await tx.adminSavedView.updateMany({
        where: {
          adminUserId: admin.id,
          module: moduleSlug,
          isDefault: true,
        },
        data: { isDefault: false },
      });
    }

    return tx.adminSavedView.upsert({
      where: {
        adminUserId_module_name: {
          adminUserId: admin.id,
          module: moduleSlug,
          name,
        },
      },
      create: {
        adminUserId: admin.id,
        module: moduleSlug,
        name,
        query,
        filters: filters as Prisma.InputJsonValue,
        sorting: sorting as Prisma.InputJsonValue,
        columns: {
          visibleColumns,
          columnOrder,
          columnWidths,
          searchColumn,
          context,
        } as Prisma.InputJsonValue,
        pageSize: 100,
        isDefault: body?.isDefault === true,
      },
      update: {
        query,
        filters: filters as Prisma.InputJsonValue,
        sorting: sorting as Prisma.InputJsonValue,
        columns: {
          visibleColumns,
          columnOrder,
          columnWidths,
          searchColumn,
          context,
        } as Prisma.InputJsonValue,
        pageSize: 100,
        isDefault: body?.isDefault === true,
      },
      select: {
        id: true,
        name: true,
        query: true,
        filters: true,
        sorting: true,
        columns: true,
        isDefault: true,
      },
    });
  });

  return NextResponse.json({ view: toView(row) });
}

export async function DELETE(request: Request) {
  const admin = await requireAdminAction();
  const body = (await request.json().catch(() => null)) as { id?: unknown } | null;
  const id = typeof body?.id === "string" ? body.id : "";
  if (!id) return NextResponse.json({ error: "Nedostaje pogled." }, { status: 400 });
  const deleted = await db.adminSavedView.deleteMany({
    where: { id, adminUserId: admin.id },
  });
  if (!deleted.count) {
    return NextResponse.json({ error: "Pogled nije pronađen." }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
