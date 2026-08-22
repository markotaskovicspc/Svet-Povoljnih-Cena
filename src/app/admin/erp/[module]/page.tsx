import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { erpModules, getErpModule, getErpModuleDefinition } from "@/lib/admin/erp";
import { PageHeader } from "@/components/admin/page-header";
import {
  ErpGrid,
  type ErpGridInitialView,
} from "@/components/admin/erp-grid";
import { requireAdminAction } from "@/lib/admin";
import { allowedRolesForErpModule } from "@/lib/admin/erp-access";
import { db } from "@/lib/db";

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
  const admin = await requireAdminAction(allowedRolesForErpModule(slug));
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
  const selectedSavedView =
    slug === "artikli" && search.view && !isRabaluxStockView
      ? await db.adminSavedView.findFirst({
          where: {
            id: search.view,
            adminUserId: admin.id,
            module: "artikli",
          },
          select: {
            query: true,
            filters: true,
            sorting: true,
            columns: true,
          },
        })
      : null;
  const savedColumns =
    selectedSavedView?.columns &&
    typeof selectedSavedView.columns === "object" &&
    !Array.isArray(selectedSavedView.columns)
      ? (selectedSavedView.columns as Record<string, unknown>)
      : {};
  const stringArray = (value: unknown) =>
    Array.isArray(value)
      ? value.filter((item): item is string => typeof item === "string")
      : [];
  const initialSavedView: ErpGridInitialView | undefined = selectedSavedView
    ? {
        query:
          typeof selectedSavedView.query === "string"
            ? selectedSavedView.query
            : "",
        searchColumn:
          typeof savedColumns.searchColumn === "string"
            ? savedColumns.searchColumn
            : "",
        filters: Array.isArray(selectedSavedView.filters)
          ? (selectedSavedView.filters as ErpGridInitialView["filters"])
          : [],
        sorting: Array.isArray(selectedSavedView.sorting)
          ? (selectedSavedView.sorting as ErpGridInitialView["sorting"])
          : [],
        visibleColumns: stringArray(savedColumns.visibleColumns),
        columnOrder: stringArray(savedColumns.columnOrder),
        columnWidths:
          savedColumns.columnWidths &&
          typeof savedColumns.columnWidths === "object" &&
          !Array.isArray(savedColumns.columnWidths)
            ? Object.fromEntries(
                Object.entries(savedColumns.columnWidths).filter(
                  (entry): entry is [string, number] =>
                    typeof entry[1] === "number" &&
                    Number.isFinite(entry[1]),
                ),
              )
            : {},
        context:
          savedColumns.context &&
          typeof savedColumns.context === "object" &&
          !Array.isArray(savedColumns.context)
            ? Object.fromEntries(
                Object.entries(savedColumns.context).filter(
                  (entry): entry is [string, string] =>
                    typeof entry[1] === "string",
                ),
              )
            : {},
      }
    : undefined;
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
        {slug === "kretanja-zaliha" ? (
          <nav className="mb-6 flex flex-wrap gap-2" aria-label="Lager">
            <Link
              href="/admin/erp/stanje-po-magacinima"
              className="rounded-full border border-border bg-background px-4 py-2 text-sm font-medium text-ink-900 transition hover:bg-muted"
            >
              Stanje
            </Link>
            <Link
              href="/admin/erp/kretanja-zaliha"
              aria-current="page"
              className="rounded-full bg-ink-900 px-4 py-2 text-sm font-medium text-canvas"
            >
              Promene zaliha
            </Link>
          </nav>
        ) : null}
        <ErpGrid
          key={`${erpModule.slug}:${search.view ?? (isStocktakeArchive ? "archive" : "default")}`}
          module={erpModule}
          initialVisibleColumns={
            isRabaluxStockView ? rabaluxStockColumns : undefined
          }
          initialQuery={isRabaluxStockView ? "Rabalux" : ""}
          initialSearchColumn={
            isRabaluxStockView ? "supplierIntegrationKey" : ""
          }
          initialContext={isStocktakeArchive ? { archive: "1" } : undefined}
          initialView={initialSavedView}
        />
      </div>
    </>
  );
}
