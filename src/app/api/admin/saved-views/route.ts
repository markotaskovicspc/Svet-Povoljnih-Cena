import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { requireAdminAction, isAuthorized } from "@/lib/admin";
import { db } from "@/lib/db";
import { getErpModuleDefinition } from "@/lib/admin/erp";
import {
  DASHBOARD_CONTEXT_KEYS,
  isDashboardContextEntry,
} from "@/lib/admin/dashboard-context";
import { allowedNavFor, articleSavedViewHref } from "@/lib/admin/nav";

import { allowedRolesForErpModule } from "@/lib/admin/erp-access";
import {
  compareSavedViews,
  savedViewLocation,
  savedViewMetadata,
  viewColumns,
} from "@/lib/admin/saved-views";

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
  id?: unknown;
  showInSidebar?: unknown;
  pagePath?: unknown;
  routeContext?: unknown;
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
  module: string;
  name: string;
  query: Prisma.JsonValue;
  filters: Prisma.JsonValue;
  sorting: Prisma.JsonValue;
  columns: Prisma.JsonValue;
  isDefault: boolean;
}) {
  const columns =
    row.columns &&
    typeof row.columns === "object" &&
    !Array.isArray(row.columns)
      ? (row.columns as Record<string, Prisma.JsonValue>)
      : {};
  return {
    ...savedViewMetadata(row.module, row.columns),
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
    return NextResponse.json(
      { error: "Nepoznat admin modul." },
      { status: 400 },
    );
  }
  if (
    getErpModuleDefinition(moduleSlug) &&
    !isAuthorized(admin.role, allowedRolesForErpModule(moduleSlug))
  ) {
    return NextResponse.json(
      { error: "Nemate pristup ovom modulu." },
      { status: 403 },
    );
  }
  const rows = await db.adminSavedView.findMany({
    where: { adminUserId: admin.id, module: moduleSlug },
    orderBy: [{ isDefault: "desc" }, { name: "asc" }],
    select: {
      id: true,
      module: true,
      name: true,
      query: true,
      filters: true,
      sorting: true,
      columns: true,
      isDefault: true,
    },
  });
  return NextResponse.json({ views: rows.map(toView).sort(compareSavedViews) });
}

export async function POST(request: Request) {
  const admin = await requireAdminAction();
  const body = (await request
    .json()
    .catch(() => null)) as SavedViewPayload | null;
  const moduleSlug = typeof body?.module === "string" ? body.module.trim() : "";
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

  if (
    definition &&
    !isAuthorized(admin.role, allowedRolesForErpModule(moduleSlug))
  ) {
    return NextResponse.json(
      { error: "Nemate pristup ovom modulu." },
      { status: 403 },
    );
  }
  const id = typeof body?.id === "string" ? body.id : undefined;
  const existing = id
    ? await db.adminSavedView.findFirst({
        where: { id, adminUserId: admin.id, module: moduleSlug },
      })
    : null;
  if (id && !existing)
    return NextResponse.json(
      { error: "Pogled nije pronađen." },
      { status: 404 },
    );
  if (definition) {
    const duplicate = await db.adminSavedView.findFirst({
      where: {
        adminUserId: admin.id,
        module: moduleSlug,
        name,
        ...(id ? { id: { not: id } } : {}),
      },
    });
    if (duplicate)
      return NextResponse.json(
        {
          error:
            "Već postoji pogled sa ovim nazivom. Izaberite drugi naziv ili sačuvajte izmene postojećeg pogleda.",
        },
        { status: 409 },
      );
  }

  const articleSavedViewHrefs =
    moduleSlug === ADMIN_NAVIGATION_MODULE
      ? (
          await db.adminSavedView.findMany({
            where: { adminUserId: admin.id, module: "artikli" },
            select: { id: true },
          })
        ).map((view) => articleSavedViewHref(view.id))
      : [];
  const knownColumns = new Set(
    moduleSlug === ADMIN_NAVIGATION_MODULE
      ? [
          ...allowedNavFor(admin.role).flatMap((group) =>
            group.items.map((item) => item.href),
          ),
          ...articleSavedViewHrefs,
        ]
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
    typeof body?.searchColumn === "string" &&
    knownColumns.has(body.searchColumn)
      ? body.searchColumn
      : "";
  const columnOrder = cleanColumns(body?.columnOrder);
  const filters = Array.isArray(body?.filters)
    ? body.filters.flatMap((value) => {
        if (!value || typeof value !== "object" || Array.isArray(value))
          return [];
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
        if (!value || typeof value !== "object" || Array.isArray(value))
          return [];
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
    body?.context &&
    typeof body.context === "object" &&
    !Array.isArray(body.context)
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
  const context = rawContextEntries.length
    ? Object.fromEntries(
        rawContextEntries.filter(
          ([key, value]) =>
            typeof value === "string" &&
            value.length <= 120 &&
            contextKeys.has(key),
        ),
      )
    : {};

  const metadata = definition
    ? {
        ...savedViewMetadata(moduleSlug, existing?.columns),
        showInSidebar:
          typeof body?.showInSidebar === "boolean"
            ? body.showInSidebar
            : existing
              ? savedViewMetadata(moduleSlug, existing.columns).showInSidebar
              : true,
        ...savedViewLocation(moduleSlug, body?.pagePath, body?.routeContext),
      }
    : {};
  let row;
  try {
    row = await db.$transaction(async (tx) => {
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

      const args = {
        where: id
          ? { id }
          : {
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
            ...metadata,
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
          name,
          query,
          filters: filters as Prisma.InputJsonValue,
          sorting: sorting as Prisma.InputJsonValue,
          columns: {
            ...metadata,
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
          module: true,
          name: true,
          query: true,
          filters: true,
          sorting: true,
          columns: true,
          isDefault: true,
        },
      };
      return definition && !id
        ? tx.adminSavedView.create({ data: args.create, select: args.select })
        : tx.adminSavedView.upsert(args);
    });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      return NextResponse.json(
        { error: "Već postoji pogled sa ovim nazivom." },
        { status: 409 },
      );
    }
    throw error;
  }
  return NextResponse.json({ view: toView(row) });
}

export async function DELETE(request: Request) {
  const admin = await requireAdminAction();
  const body = (await request.json().catch(() => null)) as {
    id?: unknown;
  } | null;
  const id = typeof body?.id === "string" ? body.id : "";
  if (!id)
    return NextResponse.json({ error: "Nedostaje pogled." }, { status: 400 });
  const deleted = await db.adminSavedView.deleteMany({
    where: { id, adminUserId: admin.id },
  });
  if (!deleted.count) {
    return NextResponse.json(
      { error: "Pogled nije pronađen." },
      { status: 404 },
    );
  }
  return NextResponse.json({ ok: true });
}

export async function PATCH(request: Request) {
  const admin = await requireAdminAction();
  const body = (await request.json().catch(() => null)) as {
    id?: unknown;
    name?: unknown;
    showInSidebar?: unknown;
    move?: unknown;
  } | null;
  const id = typeof body?.id === "string" ? body.id : "";
  const existing = await db.adminSavedView.findFirst({
    where: { id, adminUserId: admin.id },
  });
  if (!existing)
    return NextResponse.json(
      { error: "Pogled nije pronađen." },
      { status: 404 },
    );
  if (
    !getErpModuleDefinition(existing.module) ||
    !isAuthorized(admin.role, allowedRolesForErpModule(existing.module))
  ) {
    return NextResponse.json(
      { error: "Nemate pristup ovom modulu." },
      { status: 403 },
    );
  }
  const name =
    body?.name === undefined
      ? existing.name
      : typeof body.name === "string"
        ? body.name.trim()
        : "";
  if (
    !name ||
    name.length > 80 ||
    (body?.move !== undefined && body.move !== "up" && body.move !== "down") ||
    (body?.showInSidebar !== undefined &&
      typeof body.showInSidebar !== "boolean")
  ) {
    return NextResponse.json(
      { error: "Proverite naziv i podešavanja pogleda." },
      { status: 400 },
    );
  }
  try {
    await db.$transaction(async (tx) => {
      await tx.$executeRaw(
        Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${`${admin.id}:${existing.module}`}, 0))`,
      );
      const current = await tx.adminSavedView.findFirstOrThrow({
        where: { id, adminUserId: admin.id },
      });
      await tx.adminSavedView.update({
        where: { id: current.id },
        data: {
          name,
          columns: {
            ...viewColumns(current.columns),
            ...(typeof body?.showInSidebar === "boolean"
              ? { showInSidebar: body.showInSidebar }
              : {}),
          } as Prisma.InputJsonValue,
        },
      });
      if (body?.move) {
        const rows = (
          await tx.adminSavedView.findMany({
            where: { adminUserId: admin.id, module: current.module },
          })
        )
          .map((row) => ({
            ...row,
            ...savedViewMetadata(row.module, row.columns),
          }))
          .sort(compareSavedViews);
        const index = rows.findIndex((row) => row.id === id);
        const target = index + (body.move === "up" ? -1 : 1);
        if (target >= 0 && target < rows.length) {
          [rows[index], rows[target]] = [rows[target]!, rows[index]!];
          for (const [position, row] of rows.entries())
            await tx.adminSavedView.update({
              where: { id: row.id },
              data: {
                columns: {
                  ...viewColumns(row.columns),
                  sidebarOrder: position,
                } as Prisma.InputJsonValue,
              },
            });
        }
      }
    });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      return NextResponse.json(
        { error: "Već postoji pogled sa ovim nazivom." },
        { status: 409 },
      );
    }
    throw error;
  }
  const rows = await db.adminSavedView.findMany({
    where: { adminUserId: admin.id, module: existing.module },
  });
  return NextResponse.json({ views: rows.map(toView).sort(compareSavedViews) });
}
