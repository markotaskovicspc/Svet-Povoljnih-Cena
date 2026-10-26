import { requireAdminAction } from "@/lib/admin";
import { allowedRolesForErpModule } from "@/lib/admin/erp-access";
import { PageHeader } from "@/components/admin/page-header";
import { PurchasePriceImport } from "@/components/admin/purchase-price-import";

export const dynamic = "force-dynamic";
export const metadata = { title: "Uvoz nabavnih cena · ERP", robots: { index: false, follow: false } };

export default async function PurchasePriceImportPage() {
  await requireAdminAction(allowedRolesForErpModule("nabavne-cene"), "/admin/erp/nabavne-cene");
  return <>
    <PageHeader title="Uvoz nabavnih cena" description="Pregledajte CSV ili XLSX datoteku pre upisa cena." crumbs={[{ href: "/admin", label: "Admin" }, { href: "/admin/erp/nabavne-cene", label: "Nabavne cene" }, { label: "Uvoz" }]} />
    <div className="px-4 py-6 md:px-8"><PurchasePriceImport /></div>
  </>;
}
