import { revalidatePath } from "next/cache";
import { Prisma, PaymentMethod } from "@prisma/client";
import { db } from "@/lib/db";
import { withAdminState, requireAdminAction } from "@/lib/admin";
import type { AdminActionState } from "@/lib/admin/action-state";
import { num } from "@/lib/api/_helpers";
import { formatRsd } from "@/lib/format";
import {
  ensureDefaultWarehouse,
  issueFiscalRefund,
  issueAndDeliverFiscalReceipt,
} from "@/lib/fiscal";
import { PageHeader } from "@/components/admin/page-header";
import { Card, CardTitle } from "@/components/admin/card";
import { Input } from "@/components/ui/input";
import { FiscalizationClient } from "./fiscalization-client";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Fiskalizacija",
  robots: { index: false, follow: false },
};

const PAGE_LIMIT = 500;

async function manualFiscalizeAction(_state: AdminActionState, formData: FormData) {
  "use server";

  return withAdminState(
    { allowed: ["OPS"], action: "fiscal.sale.manual", entity: "FiscalDocument" },
    async (_actorId, formData: FormData) => {
      const orderId = String(formData.get("orderId") ?? "");
      const orderItemIds = formData.getAll("orderItemIds").map(String).filter(Boolean);
      const paymentMethod = enumValue(PaymentMethod, String(formData.get("paymentMethod") ?? ""));
      if (!orderId || !orderItemIds.length || !paymentMethod) {
        return { ok: false as const, error: "Izaberite porudžbinu, stavke i način plaćanja." };
      }

      const result = await issueAndDeliverFiscalReceipt(orderId, {
        source: "MANUAL",
        paymentMethod,
        orderItemIds,
      });
      revalidatePath("/admin/fiskalizacija");
      revalidatePath(`/admin/narudzbine/${orderId}`);
      if (!result.outcome.ok) return { ok: false as const, error: result.outcome.error };
      return {
        ok: true as const,
        entityId: result.outcome.receipt.id,
        diff: {
          orderId,
          orderItemIds,
          receiptNumber: result.outcome.receipt.receiptNumber,
          emailed: result.emailed,
          emailError: result.emailError,
        },
        message: result.emailed
          ? "Stavke su fiskalizovane i finalni email je poslat kupcu."
          : "Stavke su fiskalizovane.",
      };
    },
  )(formData);
}

async function refundFiscalLinesAction(_state: AdminActionState, formData: FormData) {
  "use server";

  return withAdminState(
    { allowed: ["OPS"], action: "fiscal.refund", entity: "FiscalDocument" },
    async (actorId, formData: FormData) => {
      const fiscalLineIds = formData.getAll("fiscalLineIds").map(String).filter(Boolean);
      const paymentReturnMethod = enumValue(PaymentMethod, String(formData.get("paymentReturnMethod") ?? ""));
      const warehouseId = String(formData.get("warehouseId") ?? "");
      const buyerId = String(formData.get("buyerId") ?? "").trim();
      if (!fiscalLineIds.length || !paymentReturnMethod || !warehouseId) {
        return { ok: false as const, error: "Izaberite redove, način vraćanja novca i magacin." };
      }
      if (!buyerId) {
        return { ok: false as const, error: "Unesite identifikaciju kupca (npr. 10:PIB ili 11:JMBG) — obavezna je za refundaciju." };
      }

      const result = await issueFiscalRefund({
        fiscalLineIds,
        paymentReturnMethod,
        warehouseId,
        buyerId,
        actorId,
      });
      revalidatePath("/admin/fiskalizacija");
      if (!result.ok) return { ok: false as const, error: result.error };
      return {
        ok: true as const,
        diff: {
          fiscalLineIds,
          paymentReturnMethod,
          warehouseId,
          buyerId,
          documents: result.documents.map((document) => document.receiptNumber),
          paymentErrors: result.paymentErrors,
        },
        message: result.paymentErrors.length
          ? `Refundacija je fiskalizovana i lager je vraćen, ali plaćanje ima grešku: ${result.paymentErrors.join("; ")}`
          : `Refundacija je fiskalizovana, a lager je vraćen (${formatRsd(result.refundedGross)}).`,
      };
    },
  )(formData);
}

export default async function FiscalizationPage({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string;
    from?: string;
    to?: string;
    supplier?: string;
    category?: string;
    refunded?: string;
  }>;
}) {
  await requireAdminAction(["OPS"]);
  await ensureDefaultWarehouse();

  const sp = await searchParams;
  const q = sp.q?.trim() ?? "";
  const from = parseDateStart(sp.from);
  const to = parseDateEnd(sp.to);
  const refunded = sp.refunded === "yes" ? "yes" : sp.refunded === "no" ? "no" : "all";

  const where: Prisma.FiscalDocumentLineWhereInput = {
    fiscalDocument: {
      is: {
        kind: "SALE",
        status: "ISSUED",
        ...(from || to
          ? {
              issuedAt: {
                ...(from ? { gte: from } : {}),
                ...(to ? { lte: to } : {}),
              },
            }
          : {}),
      },
    },
    ...(q
      ? {
          OR: [
            { orderNumber: { contains: q, mode: "insensitive" as const } },
            { customerName: { contains: q, mode: "insensitive" as const } },
            { companyName: { contains: q, mode: "insensitive" as const } },
            { phone: { contains: q } },
            { email: { contains: q, mode: "insensitive" as const } },
            { sku: { contains: q, mode: "insensitive" as const } },
            { shortName: { contains: q, mode: "insensitive" as const } },
          ],
        }
      : {}),
    ...(sp.supplier ? { supplierName: { contains: sp.supplier, mode: "insensitive" as const } } : {}),
    ...(sp.category ? { categoryName: { contains: sp.category, mode: "insensitive" as const } } : {}),
    ...(refunded === "yes" ? { refundedQty: { gt: 0 } } : {}),
    ...(refunded === "no" ? { refundedQty: 0 } : {}),
  };

  const [lines, warehouses, manualOrders] = await Promise.all([
    db.fiscalDocumentLine.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: PAGE_LIMIT,
      include: {
        fiscalDocument: { select: { receiptNumber: true, issuedAt: true, paymentMethod: true } },
      },
    }),
    db.warehouse.findMany({
      where: { active: true },
      orderBy: [{ isDefault: "desc" }, { name: "asc" }],
      select: { id: true, code: true, name: true, isDefault: true },
    }),
    loadManualOrders(),
  ]);

  const rows = lines.map((line) => ({
    id: line.id,
    orderNumber: line.orderNumber,
    fiscalReceiptNumber: line.fiscalDocument.receiptNumber ?? "-",
    issuedAt: line.fiscalDocument.issuedAt?.toLocaleString("sr-Latn-RS") ?? "-",
    customerName: line.customerName,
    pib: line.pib ?? "-",
    priceList: line.priceList,
    address: line.address,
    city: line.city,
    postalCode: line.postalCode,
    phone: line.phone,
    email: line.email ?? "-",
    sku: line.sku,
    supplierName: line.supplierName ?? "-",
    categoryName: line.categoryName ?? "-",
    groupName: line.groupName ?? "-",
    subgroupName: line.subgroupName ?? "-",
    collectionName: line.collectionName ?? "-",
    shortDescription: line.shortDescription ?? "-",
    shortName: line.shortName,
    attribute1: line.attribute1 ?? "-",
    attribute2: line.attribute2 ?? "-",
    attribute3: line.attribute3 ?? "-",
    attribute4: line.attribute4 ?? "-",
    color1: line.color1 ?? "-",
    color2: line.color2 ?? "-",
    qty: line.qty,
    unitPriceGross: formatRsd(num(line.unitPriceGross)),
    totalNet: formatRsd(num(line.totalNet)),
    totalGross: formatRsd(num(line.totalGross)),
    warehouseName: line.warehouseName ?? "DC",
    refunded: line.refundedQty >= line.qty,
  }));

  return (
    <>
      <PageHeader
        title="Fiskalizacija"
        description="Pregled fiskalizovanih porudžbina po artikalima i refundacija"
        crumbs={[{ href: "/admin", label: "Admin" }, { label: "Fiskalizacija" }]}
      />
      <div className="space-y-4 px-8 py-6">
        <Card>
          <CardTitle description={`${rows.length.toLocaleString("sr-Latn-RS")} prikazanih redova`}>
            Filteri
          </CardTitle>
          <form className="flex flex-wrap items-end gap-3" method="get">
            <div className="min-w-[260px] flex-1">
              <label className="text-xs font-medium uppercase tracking-[0.12em] text-ink-500">
                Pretraga
              </label>
              <Input name="q" defaultValue={q} placeholder="Porudžbina / kupac / SKU" />
            </div>
            <FilterInput name="supplier" label="Dobavljač" value={sp.supplier} />
            <FilterInput name="category" label="Kategorija" value={sp.category} />
            <div>
              <label className="text-xs font-medium uppercase tracking-[0.12em] text-ink-500">Od</label>
              <Input name="from" type="date" defaultValue={sp.from ?? ""} className="h-8" />
            </div>
            <div>
              <label className="text-xs font-medium uppercase tracking-[0.12em] text-ink-500">Do</label>
              <Input name="to" type="date" defaultValue={sp.to ?? ""} className="h-8" />
            </div>
            <div>
              <label className="text-xs font-medium uppercase tracking-[0.12em] text-ink-500">
                Refundirano
              </label>
              <select
                name="refunded"
                defaultValue={refunded}
                className="h-8 rounded-lg border border-input bg-transparent px-2 text-sm"
              >
                <option value="all">Svi</option>
                <option value="yes">Da</option>
                <option value="no">Ne</option>
              </select>
            </div>
            <button
              type="submit"
              className="h-8 rounded-lg bg-walnut px-4 text-sm font-medium text-white hover:bg-walnut/90"
            >
              Filtriraj
            </button>
          </form>
        </Card>

        <FiscalizationClient
          rows={rows}
          warehouses={warehouses}
          manualOrders={manualOrders}
          paymentMethods={Object.values(PaymentMethod)}
          manualFiscalizeAction={manualFiscalizeAction}
          refundAction={refundFiscalLinesAction}
        />
      </div>
    </>
  );
}

async function loadManualOrders() {
  const orders = await db.order.findMany({
    where: { status: { notIn: ["OTKAZANO", "VRACENO"] } },
    orderBy: { createdAt: "desc" },
    take: 80,
    select: {
      id: true,
      number: true,
      shipFirstName: true,
      shipLastName: true,
      shipCity: true,
      paymentMethod: true,
      items: {
        orderBy: { id: "asc" },
        select: {
          id: true,
          sku: true,
          name: true,
          qty: true,
          unitPriceSale: true,
          fiscalLines: {
            where: { fiscalDocument: { is: { kind: "SALE", status: "ISSUED" } } },
            select: { qty: true },
          },
        },
      },
    },
  });

  return orders
    .map((order) => ({
      id: order.id,
      number: order.number,
      customer: `${order.shipFirstName} ${order.shipLastName}`,
      city: order.shipCity,
      paymentMethod: order.paymentMethod,
      lines: order.items
        .map((item) => {
          const fiscalizedQty = item.fiscalLines.reduce((sum, line) => sum + line.qty, 0);
          const remainingQty = item.qty - fiscalizedQty;
          return remainingQty > 0
            ? {
                id: item.id,
                sku: item.sku,
                name: item.name,
                orderedQty: item.qty,
                remainingQty,
                unitPriceGross: formatRsd(num(item.unitPriceSale)),
              }
            : null;
        })
        .filter((item): item is NonNullable<typeof item> => Boolean(item)),
    }))
    .filter((order) => order.lines.length > 0);
}

function FilterInput({ name, label, value }: { name: string; label: string; value?: string }) {
  return (
    <div>
      <label className="text-xs font-medium uppercase tracking-[0.12em] text-ink-500">{label}</label>
      <Input name={name} defaultValue={value ?? ""} className="h-8" />
    </div>
  );
}

function enumValue<T extends Record<string, string>>(source: T, value?: string) {
  return Object.values(source).includes(value ?? "") ? (value as T[keyof T]) : undefined;
}

function parseDateStart(value?: string) {
  if (!value) return undefined;
  const date = new Date(`${value}T00:00:00.000`);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function parseDateEnd(value?: string) {
  if (!value) return undefined;
  const date = new Date(`${value}T23:59:59.999`);
  return Number.isNaN(date.getTime()) ? undefined : date;
}
