import { Prisma } from "@prisma/client";
import { createHash, randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { withAdminState, requireAdminAction } from "@/lib/admin";
import type { AdminActionState } from "@/lib/admin/action-state";
import { adjustInventory, ensureDefaultWarehouse, setDefaultWarehouseStock } from "@/lib/inventory";
import {
  summarizeInventoryImportChanges,
  type InventoryImportPreviewResult,
} from "@/lib/inventory-csv";
import { parseOpeningInventoryFile } from "@/lib/inventory-file";
import { mergeOverrideFields } from "@/lib/rabalux/ownership";
import { PageHeader } from "@/components/admin/page-header";
import { Card, CardTitle, StatCard } from "@/components/admin/card";
import { Field } from "@/components/admin/field";
import { Input } from "@/components/ui/input";
import { SubmitButton } from "@/components/admin/submit-button";
import { AdminActionForm } from "@/components/admin/action-form";
import { InventoryImportForm } from "@/components/admin/inventory-import-form";
import { DataTable } from "@/components/admin/data-table";

export const dynamic = "force-dynamic";
export const metadata = { title: "Lager", robots: { index: false, follow: false } };

async function adjustStock(_state: AdminActionState, formData: FormData) {
  "use server";
  return withAdminState(
    { allowed: ["OPS"], action: "inventory.adjust", entity: "StockMovement" },
    async (actorId, formData: FormData) => {
      const sku = String(formData.get("sku") ?? "").trim();
      const qtyDelta = Number(formData.get("qtyDelta"));
      const note = String(formData.get("note") ?? "").trim();
      const operationId = String(formData.get("operationId") ?? "").trim();
      if (!sku || !Number.isInteger(qtyDelta) || qtyDelta === 0 || !note || !operationId) {
        return { ok: false as const, error: "SKU, nenulta cela promena i razlog su obavezni." };
      }
      const product = await db.product.findUnique({ where: { sku }, select: { id: true } });
      if (!product) return { ok: false as const, error: `SKU ${sku} ne postoji.` };
      await db.$transaction(async (tx) => {
        await adjustInventory(tx, {
          idempotencyKey: `admin-adjustment:${operationId}`,
          productId: product.id,
          sku,
          qtyDelta,
          kind: "ADJUSTMENT",
          note,
          actorId,
        });
      });
      revalidatePath("/admin/lager");
      revalidatePath("/admin/erp/stanje-po-magacinima");
      return {
        ok: true as const,
        entityId: product.id,
        diff: { sku, qtyDelta, note },
        message: `Lager za ${sku} je promenjen za ${qtyDelta}.`,
      };
    },
  )(formData);
}

async function importOpeningInventory(
  _state: AdminActionState<InventoryImportPreviewResult>,
  formData: FormData,
) {
  "use server";
  return withAdminState(
    { allowed: ["OPS"], action: "inventory.openingImport", entity: "WarehouseStock" },
    async (actorId, formData: FormData) => {
      const file = formData.get("file");
      const apply = formData.get("mode") === "apply";
      if (!(file instanceof File) || file.size === 0 || file.size > 5_000_000) {
        return { ok: false as const, error: "Izaberite CSV ili XLSX fajl do 5 MB." };
      }
      const bytes = new Uint8Array(await file.arrayBuffer());
      const parsed = await parseOpeningInventoryFile({
        name: file.name,
        type: file.type,
        bytes,
      });
      if (parsed.errors.length) {
        return { ok: false as const, error: parsed.errors.slice(0, 8).join(" ") };
      }
      if (!parsed.rows.length) {
        return { ok: false as const, error: "Fajl nema nijedan ispravan red za uvoz." };
      }
      const warehouse = await db.warehouse.findFirst({
        where: { active: true, isDefault: true },
        orderBy: { createdAt: "asc" },
        select: { id: true },
      });
      const products = await db.product.findMany({
        where: { sku: { in: parsed.rows.map((row) => row.sku) } },
        select: {
          id: true,
          sku: true,
          stock: true,
          syncOverrides: true,
          warehouseStocks: {
            where: warehouse ? { warehouseId: warehouse.id } : undefined,
            select: { warehouseId: true, qty: true },
            take: 1,
          },
          orderItems: {
            where: {
              warehouseReservedQty: { gt: 0 },
              order: { status: { notIn: ["ISPORUCENO", "OTKAZANO", "VRACENO"] } },
            },
            select: { warehouseId: true, warehouseReservedQty: true },
          },
        },
      });
      const bySku = new Map(products.map((product) => [product.sku, product]));
      const unknown = parsed.rows.filter((row) => !bySku.has(row.sku));
      if (unknown.length) {
        return {
          ok: false as const,
          error: `Nepoznati SKU: ${unknown.slice(0, 12).map((row) => row.sku).join(", ")}.`,
        };
      }
      const currentPhysicalBySku = new Map(
        products.map((product) => {
          const warehouseRow = product.warehouseStocks[0];
          const reserved = product.orderItems
            .filter(
              (item) =>
                item.warehouseId === warehouseRow?.warehouseId || item.warehouseId === null,
            )
            .reduce((sum, item) => sum + item.warehouseReservedQty, 0);
          return [product.sku, (warehouseRow?.qty ?? product.stock) + reserved] as const;
        }),
      );
      const summary = summarizeInventoryImportChanges(
        parsed.rows,
        currentPhysicalBySku,
      );
      const result: InventoryImportPreviewResult = {
        file: file.name,
        rows: parsed.rows.length,
        dimensionsRows: parsed.rows.filter((row) => row.widthCm !== null).length,
        applied: apply,
        ...summary,
        samples: parsed.rows
          .map((row) => {
            const current = currentPhysicalBySku.get(row.sku) ?? 0;
            return {
              sku: row.sku,
              current,
              target: row.qty,
              delta: row.qty - current,
            };
          })
          .filter((sample) => sample.delta !== 0)
          .slice(0, 12),
      };
      if (apply) {
        const fileHash = createHash("sha256").update(bytes).digest("hex");
        await db.$transaction(async (tx) => {
          await ensureDefaultWarehouse(tx);
          for (const row of parsed.rows) {
            const product = bySku.get(row.sku)!;
            if (
              row.widthCm !== null &&
              row.depthCm !== null &&
              row.heightCm !== null
            ) {
              await tx.product.update({
                where: { id: product.id },
                data: {
                  widthCm: new Prisma.Decimal(row.widthCm),
                  depthCm: new Prisma.Decimal(row.depthCm),
                  heightCm: new Prisma.Decimal(row.heightCm),
                  syncOverrides: mergeOverrideFields(
                    product.syncOverrides,
                    ["dimensions"],
                    actorId,
                  ),
                },
              });
            }
            await setDefaultWarehouseStock(tx, {
              idempotencyKey: `dc-import:${fileHash}:${product.id}`,
              productId: product.id,
              targetQty: row.qty,
              actorId,
              note: `DC stanje iz fajla ${file.name}`,
            });
          }
        }, { timeout: 30_000 });
        revalidatePath("/admin/lager");
        revalidatePath("/admin/erp/stanje-po-magacinima");
        revalidatePath("/admin/proizvodi");
      }
      return {
        ok: true as const,
        diff: { file: file.name, rows: parsed.rows.length, apply },
        message: apply
          ? `DC uvoz je završen: ${summary.changed} promena, ${summary.unchanged} bez promene.`
          : `Provera je uspešna: ${summary.changed} promena, ${summary.unchanged} bez promene.`,
        result,
      };
    },
  )(formData);
}

export default async function InventoryPage() {
  await requireAdminAction(["OPS"]);
  const [warehouse, stocks, movements, productCount, stockedCount] = await Promise.all([
    db.warehouse.findFirst({ where: { active: true, isDefault: true } }),
    db.warehouseStock.findMany({
      orderBy: [{ qty: "desc" }, { product: { sku: "asc" } }],
      take: 250,
      include: { product: { select: { sku: true, name: true, stock: true } }, warehouse: true },
    }),
    db.stockMovement.findMany({
      orderBy: { createdAt: "desc" },
      take: 100,
      include: { warehouse: { select: { code: true } } },
    }),
    db.product.count({ where: { deletedAt: null } }),
    db.product.count({ where: { deletedAt: null, stock: { gt: 0 } } }),
  ]);

  return (
    <>
      <PageHeader
        title="Lager i kretanja"
        description="Magacinske količine su izvor istine; svaka promena ostavlja trag."
        crumbs={[{ href: "/admin", label: "Admin" }, { href: "/admin/erp", label: "ERP" }, { label: "Lager" }]}
      />
      <div className="space-y-6 px-4 py-6 md:px-8">
        <div className="grid gap-4 md:grid-cols-3">
          <StatCard label="Magacin" value={warehouse?.code ?? "DC"} hint={warehouse?.name ?? "Kreira se pri prvom unosu"} />
          <StatCard label="Artikli" value={String(productCount)} />
          <StatCard label="Sa zalihom" value={String(stockedCount)} tone={stockedCount ? "success" : "warning"} />
        </div>
        <div className="grid gap-6 xl:grid-cols-2">
          <Card>
            <CardTitle description="CSV ili XLSX; obavezne kolone su sku i qty. Opcione dimenzije: widthCm, depthCm, heightCm.">
              DC stanje iz tabele
            </CardTitle>
            <InventoryImportForm action={importOpeningInventory} />
          </Card>
          <Card>
            <CardTitle>Ručna korekcija</CardTitle>
            <AdminActionForm action={adjustStock} className="space-y-3">
              <input type="hidden" name="operationId" value={randomUUID()} />
              <Field label="SKU"><Input name="sku" required /></Field>
              <Field label="Promena količine" hint="Pozitivno za ulaz, negativno za izlaz."><Input name="qtyDelta" type="number" step="1" required /></Field>
              <Field label="Razlog"><Input name="note" maxLength={300} required /></Field>
              <SubmitButton confirm="Proknjižiti ovu korekciju lagera? Promena će ostaviti trajan magacinski i audit trag.">
                Proknjiži promenu
              </SubmitButton>
            </AdminActionForm>
          </Card>
        </div>
        <Card className="p-0">
          <DataTable
            columns={[{ key: "sku", label: "SKU" }, { key: "name", label: "Naziv" }, { key: "warehouse", label: "Magacin" }, { key: "qty", label: "Količina", align: "right" }, { key: "aggregate", label: "Web zbir", align: "right" }]}
            rows={stocks.map((stock) => ({ id: stock.id, cells: { sku: stock.product.sku, name: stock.product.name, warehouse: stock.warehouse.code, qty: stock.qty, aggregate: stock.product.stock } }))}
            empty="Nema magacinskih stanja. Uvezite početno stanje."
          />
        </Card>
        <Card className="p-0">
          <DataTable
            columns={[{ key: "time", label: "Vreme" }, { key: "sku", label: "SKU" }, { key: "warehouse", label: "Magacin" }, { key: "kind", label: "Vrsta" }, { key: "qty", label: "Promena", align: "right" }, { key: "note", label: "Razlog" }]}
            rows={movements.map((movement) => ({ id: movement.id, cells: { time: movement.createdAt.toLocaleString("sr-Latn-RS"), sku: movement.sku, warehouse: movement.warehouse.code, kind: movement.kind, qty: movement.qty, note: movement.note ?? "—" } }))}
            empty="Nema kretanja lagera."
          />
        </Card>
      </div>
    </>
  );
}
