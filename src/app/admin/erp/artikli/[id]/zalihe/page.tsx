import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requireAdminAction } from "@/lib/admin";
import { computeArticleStock } from "@/lib/article-stock";
import { PageHeader } from "@/components/admin/page-header";
import { Card, CardTitle, StatCard } from "@/components/admin/card";
import { Input } from "@/components/ui/input";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Stanje i kretanje artikla",
  robots: { index: false, follow: false },
};

const FINAL_ORDER_STATUSES = ["ISPORUCENO", "OTKAZANO", "VRACENO"] as const;

function formatDate(value: Date) {
  return new Intl.DateTimeFormat("sr-Latn-RS", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(value);
}

function customerLabel(order: {
  customer: {
    firstName: string | null;
    lastName: string | null;
    companyName: string | null;
    email: string | null;
  } | null;
  shipFirstName: string;
  shipLastName: string;
  shipCompanyName: string | null;
  guestEmail: string | null;
}) {
  return (
    order.customer?.companyName ||
    [order.customer?.firstName, order.customer?.lastName].filter(Boolean).join(" ") ||
    order.shipCompanyName ||
    [order.shipFirstName, order.shipLastName].filter(Boolean).join(" ") ||
    order.customer?.email ||
    order.guestEmail ||
    "Kupac"
  );
}

export default async function ArticleStockPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ warehouseId?: string; customer?: string }>;
}) {
  await requireAdminAction(["CONTENT", "OPS"]);
  const [{ id }, search] = await Promise.all([params, searchParams]);
  const warehouseId = search.warehouseId?.trim() || "";
  const customer = search.customer?.trim() || "";
  const customerTokens = customer.split(/\s+/).filter(Boolean);
  const [product, warehouses, movements] = await Promise.all([
    db.product.findUnique({
      where: { id },
      select: {
        id: true,
        sku: true,
        name: true,
        stock: true,
        availableWebManual: true,
        availableWholesaleManual: true,
        availableExportManual: true,
        warehouseStocks: { select: { warehouseId: true, qty: true } },
        orderItems: {
          where: {
            warehouseReservedQty: { gt: 0 },
            order: { status: { notIn: [...FINAL_ORDER_STATUSES] } },
          },
          orderBy: { order: { createdAt: "desc" } },
          select: {
            id: true,
            warehouseId: true,
            warehouseReservedQty: true,
            order: {
              select: {
                id: true,
                number: true,
                status: true,
                guestEmail: true,
                shipFirstName: true,
                shipLastName: true,
                shipCompanyName: true,
                customer: {
                  select: {
                    firstName: true,
                    lastName: true,
                    companyName: true,
                    email: true,
                  },
                },
              },
            },
          },
        },
        partnerReservations: {
          where: {
            status: "ACTIVE",
            OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
          },
          orderBy: { createdAt: "desc" },
          select: {
            id: true,
            warehouseId: true,
            qty: true,
            externalRef: true,
            expiresAt: true,
            client: { select: { name: true } },
          },
        },
      },
    }),
    db.warehouse.findMany({
      where: { active: true },
      orderBy: [{ isDefault: "desc" }, { name: "asc" }],
      select: { id: true, code: true, name: true, isDefault: true },
    }),
    db.stockMovement.findMany({
      where: {
        productId: id,
        ...(warehouseId ? { warehouseId } : {}),
        ...(customerTokens.length
          ? {
              order: {
                AND: customerTokens.map((token) => ({
                  OR: [
                    { number: { contains: token, mode: "insensitive" } },
                    { guestEmail: { contains: token, mode: "insensitive" } },
                    { shipFirstName: { contains: token, mode: "insensitive" } },
                    { shipLastName: { contains: token, mode: "insensitive" } },
                    { shipCompanyName: { contains: token, mode: "insensitive" } },
                    {
                      customer: {
                        email: { contains: token, mode: "insensitive" },
                      },
                    },
                    {
                      customer: {
                        companyName: { contains: token, mode: "insensitive" },
                      },
                    },
                    {
                      customer: {
                        firstName: { contains: token, mode: "insensitive" },
                      },
                    },
                    {
                      customer: {
                        lastName: { contains: token, mode: "insensitive" },
                      },
                    },
                  ],
                })),
              },
            }
          : {}),
      },
      orderBy: { createdAt: "desc" },
      take: 500,
      select: {
        id: true,
        kind: true,
        qty: true,
        note: true,
        balanceAfterWarehouse: true,
        balanceAfterTotal: true,
        createdAt: true,
        warehouse: { select: { code: true, name: true } },
        order: {
          select: {
            id: true,
            number: true,
            guestEmail: true,
            shipFirstName: true,
            shipLastName: true,
            shipCompanyName: true,
            customer: {
              select: {
                firstName: true,
                lastName: true,
                companyName: true,
                email: true,
              },
            },
          },
        },
      },
    }),
  ]);
  if (!product) notFound();

  const stockByWarehouse = new Map(
    product.warehouseStocks.map((row) => [row.warehouseId, row.qty]),
  );
  const stock = computeArticleStock({
    aggregateStock: product.stock,
    warehouses: warehouses.map((warehouse) => ({
      warehouseId: warehouse.id,
      warehouseName: warehouse.name,
      isDefault: warehouse.isDefault,
      qty:
        stockByWarehouse.get(warehouse.id) ??
        (!stockByWarehouse.size && warehouse.isDefault ? product.stock : 0),
    })),
    orderReservations: product.orderItems.map((row) => ({
      warehouseId: row.warehouseId,
      qty: row.warehouseReservedQty,
    })),
    partnerReservations: product.partnerReservations,
    manualWeb: product.availableWebManual,
    manualWholesale: product.availableWholesaleManual,
    manualExport: product.availableExportManual,
    selectedWarehouseId: warehouseId,
  });

  return (
    <>
      <PageHeader
        title={`Zalihe · ${product.sku}`}
        description={product.name}
        crumbs={[
          { href: "/admin", label: "Admin" },
          { href: "/admin/erp/artikli", label: "Artikli" },
          { href: `/admin/proizvodi/${product.id}`, label: product.sku },
          { label: "Zalihe" },
        ]}
        actions={
          <Link
            href={`/admin/proizvodi/${product.id}`}
            className="inline-flex h-8 items-center rounded-lg border border-border bg-background px-2.5 text-sm font-medium hover:bg-muted"
          >
            Matični karton
          </Link>
        }
      />

      <div className="space-y-6 px-8 py-6">
        <div className="grid gap-4 md:grid-cols-3">
          <StatCard label="Fizičko stanje" value={String(stock.contextual.physical)} />
          <StatCard
            label="Rezervisano"
            value={String(stock.contextual.reserved)}
            tone={stock.contextual.reserved ? "warning" : "default"}
          />
          <StatCard
            label="Raspoloživo"
            value={String(stock.contextual.available)}
            tone={stock.contextual.available ? "success" : "danger"}
            hint={stock.contextual.warehouseName}
          />
        </div>

        <Card>
          <CardTitle description="Fizičko stanje, aktivne rezervacije porudžbina i B2B rezervacije.">
            Stanje po magacinima
          </CardTitle>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="border-b border-border text-left text-xs uppercase tracking-wider text-ink-500">
                <tr>
                  <th className="px-3 py-2">Magacin</th>
                  <th className="px-3 py-2 text-right">Fizičko</th>
                  <th className="px-3 py-2 text-right">Rezervisano</th>
                  <th className="px-3 py-2 text-right">Raspoloživo</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {stock.warehouses.map((row) => (
                  <tr key={row.warehouseId}>
                    <td className="px-3 py-2">
                      {row.warehouseName} {row.isDefault ? "· DC" : ""}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{row.physical}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{row.reserved}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{row.available}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        <Card>
          <CardTitle description="Kupac/partner i dokument iz kog je nastala aktivna rezervacija.">
            Aktivne rezervacije
          </CardTitle>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="border-b border-border text-left text-xs uppercase tracking-wider text-ink-500">
                <tr>
                  <th className="px-3 py-2">Izvor</th>
                  <th className="px-3 py-2">Kupac / partner</th>
                  <th className="px-3 py-2">Magacin</th>
                  <th className="px-3 py-2 text-right">Količina</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {product.orderItems.map((item) => (
                  <tr key={item.id}>
                    <td className="px-3 py-2">
                      <Link
                        href={`/admin/narudzbine/${item.order.id}`}
                        className="text-walnut hover:underline"
                      >
                        {item.order.number}
                      </Link>
                    </td>
                    <td className="px-3 py-2">{customerLabel(item.order)}</td>
                    <td className="px-3 py-2">
                      {warehouses.find((row) => row.id === item.warehouseId)?.name ?? "DC"}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {item.warehouseReservedQty}
                    </td>
                  </tr>
                ))}
                {product.partnerReservations.map((reservation) => (
                  <tr key={reservation.id}>
                    <td className="px-3 py-2">{reservation.externalRef}</td>
                    <td className="px-3 py-2">{reservation.client.name}</td>
                    <td className="px-3 py-2">
                      {warehouses.find((row) => row.id === reservation.warehouseId)?.name ?? "DC"}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{reservation.qty}</td>
                  </tr>
                ))}
                {!product.orderItems.length && !product.partnerReservations.length ? (
                  <tr>
                    <td colSpan={4} className="px-3 py-6 text-center text-ink-500">
                      Nema aktivnih rezervacija.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </Card>

        <Card>
          <CardTitle description="Ulazi, izlazi i stanje posle promene; filter kupca pretražuje i broj porudžbine.">
            Kretanje zaliha
          </CardTitle>
          <form className="mb-4 grid gap-3 md:grid-cols-[minmax(220px,1fr)_minmax(220px,1fr)_auto]">
            <select
              name="warehouseId"
              defaultValue={warehouseId}
              className="h-8 rounded-lg border border-input bg-surface px-2.5 text-sm"
              aria-label="Magacin"
            >
              <option value="">Svi magacini</option>
              {warehouses.map((warehouse) => (
                <option key={warehouse.id} value={warehouse.id}>
                  {warehouse.name} ({warehouse.code})
                </option>
              ))}
            </select>
            <Input
              name="customer"
              defaultValue={customer}
              placeholder="Kupac, e-mail ili broj porudžbine"
              aria-label="Kupac"
            />
            <button
              type="submit"
              className="h-8 rounded-lg bg-ink-900 px-4 text-sm font-medium text-canvas hover:bg-walnut"
            >
              Primeni
            </button>
          </form>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="border-b border-border text-left text-xs uppercase tracking-wider text-ink-500">
                <tr>
                  <th className="px-3 py-2">Datum</th>
                  <th className="px-3 py-2">Magacin</th>
                  <th className="px-3 py-2">Vrsta</th>
                  <th className="px-3 py-2">Kupac / dokument</th>
                  <th className="px-3 py-2 text-right">Ulaz</th>
                  <th className="px-3 py-2 text-right">Izlaz</th>
                  <th className="px-3 py-2 text-right">Stanje</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {movements.map((movement) => (
                  <tr key={movement.id}>
                    <td className="px-3 py-2 whitespace-nowrap">{formatDate(movement.createdAt)}</td>
                    <td className="px-3 py-2">{movement.warehouse.name}</td>
                    <td className="px-3 py-2">{movement.kind.replaceAll("_", " ")}</td>
                    <td className="px-3 py-2">
                      {movement.order ? (
                        <Link
                          href={`/admin/narudzbine/${movement.order.id}`}
                          className="text-walnut hover:underline"
                        >
                          {movement.order.number} · {customerLabel(movement.order)}
                        </Link>
                      ) : (
                        movement.note ?? "—"
                      )}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {movement.qty > 0 ? movement.qty : "—"}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {movement.qty < 0 ? Math.abs(movement.qty) : "—"}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {movement.balanceAfterWarehouse ?? "—"}
                    </td>
                  </tr>
                ))}
                {!movements.length ? (
                  <tr>
                    <td colSpan={7} className="px-3 py-6 text-center text-ink-500">
                      Nema kretanja za izabrane filtere.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </>
  );
}
