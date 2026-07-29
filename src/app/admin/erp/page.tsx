import Link from "next/link";
import { Boxes, ChevronRight, FileSpreadsheet, Package, ReceiptText, Truck } from "lucide-react";
import { getErpDashboardModules } from "@/lib/admin/erp";
import { PageHeader } from "@/components/admin/page-header";
import { Card, CardTitle, StatCard } from "@/components/admin/card";
import { requireAdminAction, isAuthorized } from "@/lib/admin";
import { allowedRolesForErpModule } from "@/lib/admin/erp-access";
import { ERP_REQUIREMENTS } from "@/lib/admin/erp-requirements";
import { DataTable } from "@/components/admin/data-table";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "ERP",
  robots: { index: false, follow: false },
};

const ICONS = [Package, Truck, FileSpreadsheet, Boxes, FileSpreadsheet, FileSpreadsheet];

export default async function ErpDashboardPage() {
  const admin = await requireAdminAction();
  const visibleModules = (await getErpDashboardModules()).filter((module) =>
    isAuthorized(admin.role, allowedRolesForErpModule(module.slug)),
  );
  const ready = visibleModules.filter((m) => m.status === "ready");
  const blocked = visibleModules.filter((m) => m.status === "blocked_external");
  const implementedRequirements = ERP_REQUIREMENTS.filter((item) => item.status === "implemented").length;
  const partialRequirements = ERP_REQUIREMENTS.filter((item) => item.status === "partial").length;
  const externalRequirements = ERP_REQUIREMENTS.filter((item) => item.status === "blocked_external").length;
  const deferredRequirements = ERP_REQUIREMENTS.filter((item) => item.status === "deferred_user").length;

  return (
    <>
      <PageHeader
        title="ERP sistem"
        description="Jedinstven operativni admin prostor za katalog, nabavku, cene, zalihe, prodaju, logistiku, kupce, sadržaj i izveštavanje."
        actions={
          <Link
            href="/admin/erp/artikli"
            className="inline-flex h-8 items-center rounded-lg border border-border bg-background px-2.5 text-sm font-medium transition hover:bg-muted"
          >
            Otvori artikle
          </Link>
        }
      />
      <div className="space-y-8 px-8 py-6">
        <div className="grid grid-cols-3 gap-4">
          <StatCard
            label="Moduli"
            value={String(visibleModules.length)}
            hint="Dostupno vašoj ulozi"
          />
          <StatCard
            label="Operativno"
            value={String(ready.length)}
            hint="Podaci, filteri, pogledi i export"
            tone="success"
          />
          <StatCard label="Spoljne blokade" value={String(blocked.length)} hint="Vidljiv tačan razlog konfiguracije" tone="warning" />
        </div>

        <Card>
          <CardTitle description="Svaki modul koristi isti obrazac: dinamički filteri, komande, izbor kolona, pogledi i export.">
            ERP moduli
          </CardTitle>
          <div className="grid gap-3 lg:grid-cols-2">
            {visibleModules.map((module, index) => {
              const Icon = module.slug === "fiskalizacija"
                ? ReceiptText
                : (ICONS[index] ?? FileSpreadsheet);
              return (
                <Link
                  key={module.slug}
                  href={module.href}
                  className="group rounded-xl border border-border/60 bg-surface p-4 transition hover:border-walnut/40 hover:bg-muted-bg/30"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex gap-3">
                      <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-muted-bg text-walnut">
                        <Icon className="size-5" aria-hidden />
                      </span>
                      <div>
                        <p className="text-xs font-medium uppercase tracking-[0.16em] text-ink-500">
                          Tačka {module.number}
                        </p>
                        <h2 className="mt-1 font-display text-lg text-ink-900">
                          {module.title}
                        </h2>
                        <p className="mt-1 max-w-2xl text-sm text-ink-500">
                          {module.description}
                        </p>
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <span
                        className={
                          module.status === "ready"
                            ? "rounded-full bg-success/10 px-2 py-0.5 text-xs text-success"
                            : "rounded-full bg-warning/10 px-2 py-0.5 text-xs text-warning"
                        }
                      >
                        {module.status === "ready" ? "Operativno" : "Spoljna konfiguracija"}
                      </span>
                      <ChevronRight className="size-4 text-ink-300 transition group-hover:translate-x-0.5 group-hover:text-walnut" />
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        </Card>

        <Card>
          <CardTitle description="Status se zasniva na konkretnom acceptance scenariju; postojanje rute samo po sebi nije dokaz implementacije.">
            Dokaziva matrica stanja
          </CardTitle>
          <p className="mb-4 text-sm text-ink-500">
            Implementirano {implementedRequirements} · delimično {partialRequirements} · spoljno blokirano {externalRequirements} · odloženo odlukom korisnika {deferredRequirements}
          </p>
          <DataTable
            columns={[
              { key: "id", label: "#", align: "right" },
              { key: "section", label: "Stavka" },
              { key: "status", label: "Status" },
              { key: "route", label: "Kanonska ruta" },
              { key: "evidence", label: "Acceptance dokaz" },
              { key: "note", label: "Napomena" },
            ]}
            rows={ERP_REQUIREMENTS.map((requirement) => ({
              id: String(requirement.id),
              cells: {
                id: requirement.id,
                section: requirement.section,
                status: requirementStatusLabel(requirement.status),
                route: <Link href={requirement.route} className="font-mono text-xs text-walnut hover:underline">{requirement.route}</Link>,
                evidence: <code className="text-[11px] text-ink-600">{requirement.evidence}</code>,
                note: requirement.note,
              },
            }))}
            empty="Matrica nije učitana."
          />
        </Card>
      </div>
    </>
  );
}

function requirementStatusLabel(status: (typeof ERP_REQUIREMENTS)[number]["status"]) {
  switch (status) {
    case "implemented":
      return "Implementirano";
    case "partial":
      return "Delimično";
    case "blocked_external":
      return "Spolja blokirano";
    case "deferred_user":
      return "Odloženo odlukom korisnika";
  }
}
