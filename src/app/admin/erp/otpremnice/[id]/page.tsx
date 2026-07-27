import Link from "next/link";
import { notFound } from "next/navigation";
import { DispatchNoteForm } from "@/components/admin/dispatch-note-form";
import { PageHeader } from "@/components/admin/page-header";
import { requireAdminAction } from "@/lib/admin";
import {
  getDispatchNoteDetail,
  getDispatchNoteFormOptions,
} from "@/lib/admin/dispatch-note.server";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Otpremnica · ERP",
  robots: { index: false, follow: false },
};

export default async function DispatchNoteDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ mode?: string }>;
}) {
  await requireAdminAction(["OPS"]);
  const { id } = await params;
  const search = await searchParams;
  const [detail, options] = await Promise.all([
    getDispatchNoteDetail(id),
    getDispatchNoteFormOptions(),
  ]);
  if (!detail) notFound();
  const readOnly = search.mode !== "edit" || !detail.canEdit;
  return (
    <>
      <PageHeader
        title={`Otpremnica ${detail.number}`}
        description={`${detail.type === "INTERNAL" ? "Interni prenos" : "Otpremnica kupcu"} · ${detail.status}`}
        crumbs={[
          { href: "/admin", label: "Admin" },
          { href: "/admin/erp", label: "ERP" },
          {
            href: "/admin/erp/otpremnice",
            label: "Pregled otpremnica",
          },
          { label: detail.number },
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
        <DispatchNoteForm
          options={options}
          detail={detail}
          readOnly={readOnly}
        />
      </div>
    </>
  );
}
