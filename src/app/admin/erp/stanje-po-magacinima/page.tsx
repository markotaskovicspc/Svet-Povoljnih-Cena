import { Prisma } from "@prisma/client";
import Link from "next/link";
import { createHash, randomUUID } from "node:crypto";
import { revalidatePath, updateTag } from "next/cache";
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
import {
  createInventoryImportToken,
  verifyInventoryImportToken,
} from "@/lib/admin/inventory-import-token";
import { PageHeader } from "@/components/admin/page-header";
import { Card, CardTitle, StatCard } from "@/components/admin/card";
import { Field } from "@/components/admin/field";
import { Input } from "@/components/ui/input";
import { SubmitButton } from "@/components/admin/submit-button";
import { AdminActionForm } from "@/components/admin/action-form";
import { InventoryImportForm } from "@/components/admin/inventory-import-form";
import { ErpGrid } from "@/components/admin/erp-grid";
import { getErpModule } from "@/lib/admin/erp";

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
            select: {
              warehouseId: true,
              warehouseReservedQty: true,
              stockMovements: {
                select: { qty: true },
              },
            },
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
          const legacyDebited = product.orderItems
            .filter(
              (item) =>
                item.stockMovements.reduce(
                  (sum, movement) => sum + movement.qty,
                  0,
                ) < 0 &&
                (item.warehouseId === warehouseRow?.warehouseId || item.warehouseId === null),
            )
            .reduce((sum, item) => sum + item.warehouseReservedQty, 0);
          return [product.sku, (warehouseRow?.qty ?? product.stock) + legacyDebited] as const;
        }),
      );
      const fileHash = createHash("sha256").update(bytes).digest("hex");
      const stateHash = createHash("sha256")
        .update(
          [...currentPhysicalBySku.entries()]
            .sort(([left], [right]) => left.localeCompare(right))
            .map(([sku, qty]) => `${sku}:${qty}`)
            .join("|"),
        )
        .digest("hex");
      const summary = summarizeInventoryImportChanges(
        parsed.rows,
        currentPhysicalBySku,
      );
      const result: InventoryImportPreviewResult = {
        file: file.name,
        rows: parsed.rows.length,
        dimensionsRows: parsed.rows.filter((row) => row.widthCm !== null).length,
        applied: apply,
        ...(!apply
          ? {
              previewToken: createInventoryImportToken({
                adminId: actorId,
                fileHash,
                stateHash,
              }),
            }
          : {}),
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
        const previewToken = String(formData.get("previewToken") ?? "");
        const movementKeys = parsed.rows.map(
          (row) => `dc-import:${fileHash}:${bySku.get(row.sku)!.id}`,
        );
        const alreadyApplied = await db.stockMovement.count({
          where: { idempotencyKey: { in: movementKeys } },
        });
        if (alreadyApplied === movementKeys.length) {
          return {
            ok: true as const,
            diff: { file: file.name, rows: parsed.rows.length, apply, idempotent: true },
            message: "Ovaj identičan lager fajl je već primenjen; dupli upis nije napravljen.",
            result: { ...result, applied: true, changed: 0, unchanged: result.rows },
          };
        }
        if (
          !previewToken ||
          !verifyInventoryImportToken(previewToken, { adminId: actorId, fileHash, stateHash })
        ) {
          return {
            ok: false as const,
            error:
              "Fajl ili lager su promenjeni od pregleda. Ponovo pokrenite Proveri fajl pre uvoza.",
          };
        }
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
        revalidatePath("/admin/erp/stanje-po-magacinima");
        revalidatePath("/admin/erp/artikli");
        updateTag("catalog-products");
        revalidatePath("/p/[slug]", "page");
        revalidatePath("/k/[...slug]", "page");
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

export default async function InventoryPage({
  searchParams,
}: {
  searchParams: Promise<{ prikaz?: string | string[] }>;
}) {
  await requireAdminAction(["OPS"]);
  const requestedView = (await searchParams).prikaz;
  const managementView =
    (Array.isArray(requestedView) ? requestedView[0] : requestedView) ===
    "upravljanje";
  const [warehouse, stockModule, productCount, stockedCount] = await Promise.all([
    db.warehouse.findFirst({ where: { active: true, isDefault: true } }),
    getErpModule("stanje-po-magacinima", { take: 10_000 }),
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
        <nav className="flex flex-wrap gap-2" aria-label="Lager">
          <Link
            href="/admin/erp/stanje-po-magacinima"
            aria-current={!managementView ? "page" : undefined}
            className={
              !managementView
                ? "rounded-full bg-ink-900 px-4 py-2 text-sm font-medium text-canvas"
                : "rounded-full border border-border bg-background px-4 py-2 text-sm font-medium text-ink-900 transition hover:bg-muted"
            }
          >
            Stanje i artikli
          </Link>
          <Link
            href="/admin/erp/stanje-po-magacinima?prikaz=upravljanje"
            aria-current={managementView ? "page" : undefined}
            className={
              managementView
                ? "rounded-full bg-ink-900 px-4 py-2 text-sm font-medium text-canvas"
                : "rounded-full border border-border bg-background px-4 py-2 text-sm font-medium text-ink-900 transition hover:bg-muted"
            }
          >
            Upravljanje lagerom
          </Link>
          <Link
            href="/admin/erp/kretanja-zaliha"
            className="rounded-full border border-border bg-background px-4 py-2 text-sm font-medium text-ink-900 transition hover:bg-muted"
          >
            Promene zaliha
          </Link>
        </nav>
        {managementView ? (
          <>
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
                <AdminActionForm action={adjustStock} className="space-y-3" refreshOnSuccess>
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
          </>
        ) : stockModule ? (
          <ErpGrid module={stockModule} />
        ) : null}
      </div>
    </>
  );
}
