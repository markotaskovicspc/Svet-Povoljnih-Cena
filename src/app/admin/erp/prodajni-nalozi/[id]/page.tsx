import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/admin/page-header";
import { SalesOrderForm } from "@/components/admin/sales-order-form";
import { requireAdminAction } from "@/lib/admin";
import {
  getSalesOrderDetail,
  getSalesOrderFormOptions,
} from "@/lib/admin/sales-order.server";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Porudžbina · ERP",
  robots: { index: false, follow: false },
};

export default async function SalesOrderDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ mode?: string }>;
}) {
  await requireAdminAction(["OPS"]);
  const { id } = await params;
  const search = await searchParams;
  const detail = await getSalesOrderDetail(id);
  if (!detail) notFound();
  const options = await getSalesOrderFormOptions();
  const wantsEdit = search.mode === "edit";
  const readOnly = !wantsEdit || !detail.canEdit;
  return (
    <>
      <PageHeader
        title={`Porudžbina ${detail.number}`}
        description={`${detail.channel} · ${detail.status} · kreirana ${new Intl.DateTimeFormat(
          "sr-Latn-RS",
          { dateStyle: "medium", timeStyle: "short" },
        ).format(new Date(detail.createdAt))}`}
        crumbs={[
          { href: "/admin", label: "Admin" },
          { href: "/admin/erp", label: "ERP" },
          {
            href: "/admin/erp/prodajni-nalozi",
            label: "Pregled porudžbina",
          },
          { label: detail.number },
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
          detail={detail}
          readOnly={readOnly}
        />
      </div>
    </>
  );
}
