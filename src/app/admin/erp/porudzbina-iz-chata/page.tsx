import { requireAdminAction } from "@/lib/admin";
import { PageHeader } from "@/components/admin/page-header";
import { OrderImportForm } from "@/components/admin/order-import-form";
export const dynamic = "force-dynamic";
export const metadata = { title: "Porudžbina iz chata · ERP", robots: { index: false, follow: false } };
export default async function OrderImportPage() {
  await requireAdminAction(["OPS"]);
  return <><PageHeader title="Porudžbina iz chata" description="Dodajte screenshot ili nalepite prepisku. Proverite pročitane podatke i kreirajte porudžbinu." crumbs={[{ href: "/admin", label: "Admin" }, { href: "/admin/erp", label: "ERP" }, { label: "Porudžbina iz chata" }]} /><div className="px-4 py-6 md:px-8"><OrderImportForm /></div></>;
}
