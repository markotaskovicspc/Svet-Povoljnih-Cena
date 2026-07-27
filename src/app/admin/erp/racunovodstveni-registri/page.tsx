import Link from "next/link";
import { notFound } from "next/navigation";
import { ErpGrid } from "@/components/admin/erp-grid";
import { PageHeader } from "@/components/admin/page-header";
import {
  ACCOUNTING_SECTION_VIEWS,
  getAccountingSectionView,
} from "@/lib/admin/accounting-section";
import { requireAdminAction } from "@/lib/admin";
import { getErpModule } from "@/lib/admin/erp";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Knjigovodstveni izveštaji · ERP",
  robots: { index: false, follow: false },
};

export default async function AccountingReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ prikaz?: string | string[] }>;
}) {
  await requireAdminAction(["OPS"]);
  const selectedView = getAccountingSectionView((await searchParams).prikaz);
  const sourceModule = await getErpModule(selectedView.moduleSlug);
  if (!sourceModule) notFound();
  const viewNotes: string[] = [...selectedView.notes];

  const reportModule = {
    ...sourceModule,
    title: selectedView.label,
    description: selectedView.description,
    notes: [
      ...viewNotes,
      ...(sourceModule.notes ?? []).filter(
        (note) => !viewNotes.includes(note),
      ),
    ],
  };

  return (
    <>
      <PageHeader
        title="15. Knjigovodstveni izveštaji"
        description="Promet, storna i refundacije, kalkulacije, nivelacije i interni KEP pregled na jednom mestu."
        crumbs={[
          { href: "/admin", label: "Admin" },
          { href: "/admin/erp", label: "ERP" },
          { label: "Tačka 15" },
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

      <div className="space-y-6 px-8 py-6">
        <nav
          aria-label="Knjigovodstveni izveštaji u sekciji 15"
          className="grid gap-3 md:grid-cols-2 xl:grid-cols-5"
        >
          {ACCOUNTING_SECTION_VIEWS.map((view) => {
            const active = view.key === selectedView.key;
            return (
              <Link
                key={view.key}
                href={`/admin/erp/racunovodstveni-registri?prikaz=${view.key}`}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "rounded-xl border px-4 py-3 transition",
                  active
                    ? "border-walnut bg-walnut/10 text-walnut shadow-sm"
                    : "border-border/60 bg-surface text-ink-700 hover:border-walnut/40 hover:bg-muted-bg/40",
                )}
              >
                <span className="block text-[10px] font-semibold uppercase tracking-[0.16em] opacity-70">
                  {view.number}
                </span>
                <span className="mt-1 block text-sm font-medium leading-snug">
                  {view.label}
                </span>
              </Link>
            );
          })}
        </nav>

        <section aria-labelledby="accounting-view-title" className="space-y-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-ink-500">
              {selectedView.number}
            </p>
            <h2
              id="accounting-view-title"
              className="mt-1 font-display text-xl text-ink-900"
            >
              {selectedView.label}
            </h2>
            <p className="mt-1 max-w-3xl text-sm text-ink-500">
              {selectedView.description}
            </p>
          </div>

          <ErpGrid
            key={selectedView.key}
            module={reportModule}
            fixedFilters={[...selectedView.fixedFilters]}
            initialVisibleColumns={[...selectedView.visibleColumns]}
          />
        </section>
      </div>
    </>
  );
}
