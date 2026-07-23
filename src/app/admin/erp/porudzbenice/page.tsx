import Link from "next/link";
import { notFound } from "next/navigation";
import { ErpGrid } from "@/components/admin/erp-grid";
import { PageHeader } from "@/components/admin/page-header";
import { requireAdminAction } from "@/lib/admin";
import { getErpModule } from "@/lib/admin/erp";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Porudžbenice · ERP",
  robots: { index: false, follow: false },
};

export default async function PurchaseOrdersOverviewPage() {
  await requireAdminAction(["OPS"]);
  const erpModule = await getErpModule("porudzbenice");
  if (!erpModule) notFound();

  return (
    <>
      <PageHeader
        title={erpModule.title}
        description={erpModule.description}
        crumbs={[
          { href: "/admin", label: "Admin" },
          { href: "/admin/erp", label: "ERP" },
          { label: "Tačka 4" },
        ]}
        actions={
          <Link
            href="/admin/erp"
            className="inline-flex h-8 items-center rounded-lg border border-border bg-background px-2.5 text-sm font-medium transition hover:bg-muted"
          >
            Svi ERP moduli
          </Link>
        }
      />
      <div className="px-4 py-6 md:px-8">
        <ErpGrid module={erpModule} />
      </div>
    </>
  );
}
