import { notFound } from "next/navigation";
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
}: {
  params: Promise<{ module: string }>;
}) {
  const { module: slug } = await params;
  await requireAdminAction(allowedRolesForErpModule(slug));
  const erpModule = await getErpModule(slug);
  if (!erpModule) notFound();

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
        <ErpGrid key={erpModule.slug} module={erpModule} />
      </div>
    </>
  );
}
