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

export default async function PurchaseOrdersOverviewPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string }>;
}) {
  await requireAdminAction(["OPS"], "/admin/erp/porudzbenice");
  const isArchive = (await searchParams).view === "archive";
  const erpModule = await getErpModule("porudzbenice", { purchaseOrderArchived: isArchive });
  if (!erpModule) notFound();

  return (
    <>
      <PageHeader
        title={isArchive ? "Arhivirane porudžbenice" : erpModule.title}
        description={erpModule.description}
        crumbs={[
          { href: "/admin", label: "Admin" },
          { href: "/admin/erp", label: "ERP" },
          { label: "Tačka 4" },
        ]}
        actions={
          <div className="flex flex-wrap gap-2">
            <Link
              href={isArchive ? "/admin/erp/porudzbenice" : "/admin/erp/porudzbenice?view=archive"}
              className="inline-flex h-8 items-center rounded-lg border border-border bg-background px-2.5 text-sm font-medium transition hover:bg-muted"
            >
              {isArchive ? "Aktivne porudžbenice" : "Arhiva porudžbenica"}
            </Link>
            <Link
              href="/admin/erp"
              className="inline-flex h-8 items-center rounded-lg border border-border bg-background px-2.5 text-sm font-medium transition hover:bg-muted"
            >
              Svi ERP moduli
            </Link>
          </div>
        }
      />
      <div className="px-4 py-6 md:px-8">
        <ErpGrid
          key={isArchive ? "archive" : "active"}
          module={erpModule}
          initialContext={{ archive: isArchive ? "1" : "" }}
        />
      </div>
    </>
  );
}
