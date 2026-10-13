import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdminAction } from "@/lib/admin";
import { db } from "@/lib/db";
import { allowedRolesForErpModule } from "@/lib/admin/erp-access";
import { resolveReportPeriod, REPORT_TIME_ZONE } from "@/lib/admin/report-period";
import {
  getPagePurchaseOrders,
  normalizeAnalyticsGranularity,
  PAGE_PURCHASE_ORDERS_SIZE,
} from "@/lib/admin/analytics-report.server";
import { formatRsd } from "@/lib/format";
import { PageHeader } from "@/components/admin/page-header";
import { Card, CardTitle } from "@/components/admin/card";
import { DataTable } from "@/components/admin/data-table";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Porudžbine iz analitike · ERP",
  robots: { index: false, follow: false },
};

const STATUS_LABELS: Record<string, string> = {
  KREIRANO: "Kreirano",
  POTVRDJENO: "Potvrđeno",
  U_PRIPREMI: "U pripremi",
  SPREMNO_ZA_ISPORUKU: "Spremno za isporuku",
  U_ISPORUCI: "U isporuci",
  ISPORUCENO: "Isporučeno",
};

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function AnalyticsOrdersPage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const admin = await requireAdminAction(allowedRolesForErpModule("posete-konverzije"));
  const params = await searchParams;
  const path = first(params.path);
  const bucket = first(params.bucket);
  if (!path || path.length > 2048 || !bucket || !/^\d{4}-\d{2}-\d{2}$/.test(bucket)) notFound();
  const period = resolveReportPeriod({
    range: first(params.range), from: first(params.from), to: first(params.to),
  });
  const granularity = normalizeAnalyticsGranularity(params.group);
  const requestedPage = Number(first(params.page) ?? "1");
  const page = Number.isSafeInteger(requestedPage) && requestedPage >= 1 && requestedPage <= 100_000
    ? requestedPage : 1;
  const rows = await getPagePurchaseOrders(period, granularity, path, bucket, page);
  const totalCount = rows[0]?.totalCount ?? 0;
  const productSlug = path.match(/^\/p\/([^/]+)$/)?.[1];
  const product = productSlug
    ? await db.product.findUnique({ where: { slug: productSlug }, select: { name: true } })
    : null;
  const query = new URLSearchParams({
    range: "custom", from: period.fromInput, to: period.toInput, group: granularity,
  });
  const backHref = `/admin/erp/posete-konverzije?${query}`;
  query.set("path", path);
  query.set("bucket", bucket);
  const pageHref = (value: number) => {
    const paged = new URLSearchParams(query);
    paged.set("page", String(value));
    return `/admin/erp/posete-konverzije/porudzbine?${paged}`;
  };
  const canOpenOrder = admin.role === "SUPER" || admin.role === "OPS";
  const dateFormatter = new Intl.DateTimeFormat("sr-Latn-RS", {
    dateStyle: "medium", timeStyle: "short", timeZone: REPORT_TIME_ZONE,
  });
  const bucketLabel = granularity === "period" ? period.label
    : granularity === "month" ? `${bucket.slice(5, 7)}.${bucket.slice(0, 4)}.`
    : `${granularity === "week" ? "Nedelja od " : ""}${bucket.split("-").reverse().join(".")}.`;

  return (
    <>
      <PageHeader
        title="Porudžbine iz analitike"
        description={`${product?.name ?? path} · ${bucketLabel}`}
        crumbs={[
          { href: "/admin", label: "Admin" },
          { href: backHref, label: "Posete i konverzije" },
          { label: "Porudžbine" },
        ]}
        actions={<Link href={backHref} className="rounded-lg border border-border px-4 py-2 text-sm font-semibold">Nazad na analitiku</Link>}
      />
      <div className="px-4 py-6 md:px-8">
        <Card>
          <CardTitle description={productSlug
            ? "Web porudžbine koje sadrže artikal, svaka jednom. Vrednost je zbir stavki artikla bez dostave i montaže, pre popusta na celu porudžbinu. Otkazane i vraćene porudžbine su izuzete."
            : "Web porudžbine pripisane poslednjoj posećenoj stranici pre checkout-a. Otkazane i vraćene porudžbine su izuzete."}>
            {totalCount.toLocaleString("sr-Latn-RS")} porudžbina
          </CardTitle>
          <DataTable
            columns={[
              { key: "number", label: "Porudžbina" },
              { key: "createdAt", label: "Datum (Srbija)" },
              { key: "status", label: "Status" },
              ...(productSlug ? [{ key: "quantity", label: "Komada artikla", align: "right" as const }] : []),
              { key: "value", label: productSlug ? "Vrednost artikla" : "Vrednost porudžbine", align: "right" },
            ]}
            rows={rows.map((row) => ({
              id: row.id,
              cells: {
                number: canOpenOrder ? <Link href={`/admin/erp/prodajni-nalozi/${row.id}`} prefetch={false} className="font-semibold text-brand-blue underline underline-offset-4">{row.number}</Link> : row.number,
                createdAt: dateFormatter.format(row.createdAt),
                status: STATUS_LABELS[row.status] ?? row.status,
                quantity: row.quantity,
                value: formatRsd(row.value, true),
              },
            }))}
            empty="Nema porudžbina za izabranu stranicu i period."
          />
          {(page > 1 || totalCount > PAGE_PURCHASE_ORDERS_SIZE) && (
            <nav aria-label="Stranice porudžbina" className="mt-4 flex items-center gap-4 text-sm">
              {page > 1 && <Link href={pageHref(page - 1)} prefetch={false} className="text-brand-blue underline">Prethodna</Link>}
              <span>Stranica {page}{totalCount > 0 ? ` od ${Math.ceil(totalCount / PAGE_PURCHASE_ORDERS_SIZE)}` : ""}</span>
              {page * PAGE_PURCHASE_ORDERS_SIZE < totalCount && <Link href={pageHref(page + 1)} prefetch={false} className="text-brand-blue underline">Sledeća</Link>}
            </nav>
          )}
        </Card>
      </div>
    </>
  );
}
