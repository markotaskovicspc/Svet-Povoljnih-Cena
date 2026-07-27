import Link from "next/link";
import { DispatchNoteForm } from "@/components/admin/dispatch-note-form";
import { PageHeader } from "@/components/admin/page-header";
import { requireAdminAction } from "@/lib/admin";
import { getDispatchNoteFormOptions } from "@/lib/admin/dispatch-note.server";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Nova otpremnica · ERP",
  robots: { index: false, follow: false },
};

export default async function NewDispatchNotePage() {
  await requireAdminAction(["OPS"]);
  const options = await getDispatchNoteFormOptions();
  return (
    <>
      <PageHeader
        title="Nova otpremnica"
        description="Kupčevska ili interna otpremnica sa automatskim podacima artikla, cenom, uvozom VP/INO porudžbina i kontrolisanim knjiženjem lagera."
        crumbs={[
          { href: "/admin", label: "Admin" },
          { href: "/admin/erp", label: "ERP" },
          {
            href: "/admin/erp/otpremnice",
            label: "Pregled otpremnica",
          },
          { label: "Nova" },
        ]}
        actions={
          <Link
            href="/admin/erp/otpremnice"
            className="inline-flex h-8 items-center rounded-lg border border-border bg-background px-2.5 text-sm font-medium transition hover:bg-muted"
          >
            Nazad na pregled
          </Link>
        }
      />
      <div className="px-4 py-6 md:px-8">
        <DispatchNoteForm options={options} />
      </div>
    </>
  );
}
