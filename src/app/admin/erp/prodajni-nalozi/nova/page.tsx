import Link from "next/link";
import { PageHeader } from "@/components/admin/page-header";
import { SalesOrderForm } from "@/components/admin/sales-order-form";
import { requireAdminAction } from "@/lib/admin";
import { getSalesOrderFormOptions } from "@/lib/admin/sales-order.server";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Nova porudžbina · ERP",
  robots: { index: false, follow: false },
};

export default async function NewSalesOrderPage({
  searchParams,
}: {
  searchParams: Promise<{ channel?: string }>;
}) {
  await requireAdminAction(["OPS"]);
  const search = await searchParams;
  const options = await getSalesOrderFormOptions();
  return (
    <>
      <PageHeader
        title="Nova porudžbina"
        description="Ručni unos veleprodajne ili izvozne porudžbine sa automatskim kupcem, cenom, matičnim podacima artikla i pravilom magacina."
        crumbs={[
          { href: "/admin", label: "Admin" },
          { href: "/admin/erp", label: "ERP" },
          {
            href: "/admin/erp/prodajni-nalozi",
            label: "Pregled porudžbina",
          },
          { label: "Nova" },
        ]}
        actions={
          <Link
            href="/admin/erp/prodajni-nalozi"
            className="inline-flex h-8 items-center rounded-lg border border-border bg-background px-2.5 text-sm font-medium transition hover:bg-muted"
          >
            Nazad na pregled
          </Link>
        }
      />
      <div className="px-4 py-6 md:px-8">
        <SalesOrderForm
          options={options}
          initialChannel={search.channel === "INO" ? "INO" : "VP"}
        />
      </div>
    </>
  );
}
