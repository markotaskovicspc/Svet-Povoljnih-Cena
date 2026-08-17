import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { erpModules, getErpModule, getErpModuleDefinition } from "@/lib/admin/erp";
import { PageHeader } from "@/components/admin/page-header";
import { ErpGrid } from "@/components/admin/erp-grid";
import { requireAdminAction } from "@/lib/admin";
import { allowedRolesForErpModule } from "@/lib/admin/erp-access";

export const dynamic = "force-dynamic";

export async function generateStaticParams() {
  return erpModules.map((module) => ({ module: module.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ module: string }>;
}) {
  const { module: slug } = await params;
  const erpModule = getErpModuleDefinition(slug);
  return {
    title: erpModule ? `${erpModule.title} · ERP` : "ERP",
    robots: { index: false, follow: false },
  };
}

export default async function ErpModulePage({
  params,
  searchParams,
}: {
  params: Promise<{ module: string }>;
  searchParams: Promise<{ view?: string }>;
}) {
  const { module: slug } = await params;
  const search = await searchParams;
  await requireAdminAction(allowedRolesForErpModule(slug));
  if (slug === "mobilni-tabovi") redirect("/admin/tabovi#mobile-tabs");
  const definition = getErpModuleDefinition(slug);
  if (definition?.redirectHref) redirect(definition.redirectHref);
  const isStocktakeArchive = slug === "popisi" && search.view === "archive";
  const erpModule = await getErpModule(slug, {
    stocktakeArchived: isStocktakeArchive,
  });
  if (!erpModule) notFound();
  const isRabaluxStockView =
    slug === "artikli" && search.view === "rabalux-stock";
  const rabaluxStockColumns = [
    "photo",
    "status",
    "sku",
    "supplierExternalId",
    "shortName",
    "supplier",
    "rabaluxStock",
    "rabaluxReserved",
    "rabaluxSafetyStock",
    "rabaluxSellableStock",
    "rabaluxStockStatus",
    "rabaluxStockSyncedAt",
    "rabaluxNextArrivalAt",
    "deliveryDays",
  ];

  return (
    <>
      <PageHeader
        title={erpModule.title}
        description={erpModule.description}
        crumbs={[
          { href: "/admin", label: "Admin" },
          { href: "/admin/erp", label: "ERP" },
          { label: `Tačka ${erpModule.number}` },
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
      <div className="px-8 py-6">
        <ErpGrid
          key={`${erpModule.slug}:${isRabaluxStockView ? "rabalux-stock" : isStocktakeArchive ? "archive" : "default"}`}
          module={erpModule}
          initialVisibleColumns={
            isRabaluxStockView ? rabaluxStockColumns : undefined
          }
          initialQuery={isRabaluxStockView ? "Rabalux" : ""}
          initialSearchColumn={
            isRabaluxStockView ? "supplierIntegrationKey" : ""
          }
          initialContext={isStocktakeArchive ? { archive: "1" } : undefined}
        />
      </div>
    </>
  );
}
