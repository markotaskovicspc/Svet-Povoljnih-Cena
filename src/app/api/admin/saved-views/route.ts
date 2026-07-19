import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { requireAdminAction } from "@/lib/admin";
import { db } from "@/lib/db";
import { getErpModuleDefinition } from "@/lib/admin/erp";

type SavedViewPayload = {
  module?: unknown;
  name?: unknown;
  query?: unknown;
  filters?: unknown;
  sorting?: unknown;
  visibleColumns?: unknown;
  columnOrder?: unknown;
  columnWidths?: unknown;
  isDefault?: unknown;
};

function toView(row: {
  id: string;
  name: string;
  query: Prisma.JsonValue;
  filters: Prisma.JsonValue;
  sorting: Prisma.JsonValue;
  columns: Prisma.JsonValue;
}) {
  const columns =
    row.columns && typeof row.columns === "object" && !Array.isArray(row.columns)
      ? (row.columns as Record<string, Prisma.JsonValue>)
      : {};
  return {
    id: row.id,
    name: row.name,
    query: typeof row.query === "string" ? row.query : "",
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
  };
}

export async function GET(request: Request) {
  const admin = await requireAdminAction();
  const moduleSlug =
    new URL(request.url).searchParams.get("module")?.trim() ?? "";
  if (!getErpModuleDefinition(moduleSlug)) {
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
  const query = typeof body?.query === "string" ? body.query : "";
  const definition = getErpModuleDefinition(moduleSlug);
  if (!definition || !name || name.length > 80) {
    return NextResponse.json(
      { error: "Modul i naziv pogleda su obavezni (najviše 80 znakova)." },
      { status: 400 },
    );
  }

  const knownColumns = new Set(definition.columns.map((column) => column.key));
  const cleanColumns = (value: unknown) =>
    Array.isArray(value)
      ? value.filter((item): item is string => typeof item === "string" && knownColumns.has(item))
      : [];
  const visibleColumns = cleanColumns(body?.visibleColumns);
  const columnOrder = cleanColumns(body?.columnOrder);
  const filters = Array.isArray(body?.filters) ? body.filters : [];
  const sorting = Array.isArray(body?.sorting) ? body.sorting : [];
  const columnWidths =
    body?.columnWidths &&
    typeof body.columnWidths === "object" &&
    !Array.isArray(body.columnWidths)
      ? body.columnWidths
      : {};

  if (body?.isDefault === true) {
    await db.adminSavedView.updateMany({
      where: {
        adminUserId: admin.id,
        module: moduleSlug,
        isDefault: true,
      },
      data: { isDefault: false },
    });
  }

  const row = await db.adminSavedView.upsert({
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
    },
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
