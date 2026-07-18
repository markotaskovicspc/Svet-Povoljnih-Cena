import Link from "next/link";
import { PageHeader } from "@/components/admin/page-header";
import { requireAdminAction } from "@/lib/admin";
import { ArticleImportForm } from "./article-import-form";

export const dynamic = "force-dynamic";

export default async function ArticleImportPage() {
  await requireAdminAction(["CONTENT"]);
  return (
    <>
      <PageHeader
        title="XLSX unos artikala"
        description="Atomski unos sa validacijom cele datoteke i greškama po redu."
        crumbs={[
          { href: "/admin", label: "Admin" },
          { href: "/admin/erp", label: "ERP" },
          { href: "/admin/erp/artikli", label: "Artikli" },
          { label: "XLSX unos" },
        ]}
        actions={
          <Link
            href="/admin/erp/artikli"
            className="inline-flex h-8 items-center rounded-lg border border-border px-3 text-sm"
          >
            Nazad na artikle
          </Link>
        }
      />
      <div className="px-8 py-6">
        <ArticleImportForm />
      </div>
    </>
  );
}
