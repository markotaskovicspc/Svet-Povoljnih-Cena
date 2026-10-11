import Link from "next/link";
import { notFound } from "next/navigation";
import { ErpGrid } from "@/components/admin/erp-grid";
import { PageHeader } from "@/components/admin/page-header";
import { requireAdminAction } from "@/lib/admin";
import { getErpModule } from "@/lib/admin/erp";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Pregled porudžbina · ERP",
  robots: { index: false, follow: false },
};

export default async function SalesOrdersOverviewPage({ searchParams }: { searchParams: Promise<{ channel?: string; loyalty?: string }> }) {
  await requireAdminAction(["OPS"]);
  const params = await searchParams;
  const loyalty = params.loyalty === "guest";
  const requestedChannel = loyalty ? "WEB" : params.channel;
  const channel = ["WEB", "ANANAS", "MP", "VP", "INO"].includes(requestedChannel ?? "") ? requestedChannel : undefined;
  const erpModule = await getErpModule("prodajni-nalozi", { deferRows: true });
  if (!erpModule) notFound();
  return (
    <>
      <PageHeader
        title={erpModule.title}
        description={erpModule.description}
        crumbs={[
          { href: "/admin", label: "Admin" },
          { href: "/admin/erp", label: "ERP" },
          { label: "Pregled porudžbina" },
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
      <div className="px-4 py-6 md:px-8">
        <nav aria-label="Kanal prodajnih naloga" className="mb-5 flex flex-wrap gap-2">
          {[{ value: "", label: "Sve porudžbine" }, { value: "WEB", label: "Web" }, { value: "ANANAS", label: "Ananas" }, { value: "MP", label: "Maloprodaja" }, { value: "VP", label: "Veleprodaja" }, { value: "INO", label: "Inostranstvo" }].map(item => (
            <Link key={item.value} href={`/admin/erp/prodajni-nalozi?channel=${item.value || "ALL"}`} aria-current={(channel ?? "") === item.value ? "page" : undefined}
              className={`inline-flex h-9 items-center rounded-lg border px-4 text-sm font-medium transition ${(channel ?? "") === item.value ? "border-foreground bg-foreground text-background" : "border-border bg-background hover:bg-muted"}`}>
              {item.label}
            </Link>
          ))}
        <Link href="/admin/erp/prodajni-nalozi?channel=WEB&loyalty=guest" aria-current={loyalty ? "page" : undefined} className="inline-flex h-9 items-center rounded-lg border px-4 text-sm font-medium hover:bg-muted">Gosti sa loyalty saglasnošću</Link>
        </nav>
        {loyalty && <p className="mb-4 text-sm text-ink-500">Kupovine gostiju sa zabeleženom loyalty saglasnošću. Broj porudžbina i zbir iznosa nalaze se ispod tabele; datum i status možete dodatno filtrirati. Starije porudžbine bez sačuvane saglasnosti nisu naknadno procenjene prema ceni.</p>}
        {channel === "ANANAS" && <p className="mb-4 text-sm text-ink-500">Porudžbine preuzete sa Ananasa. Klik na broj otvara artikle, status pošiljke i povezane fiskalne račune. <Link className="underline" href="/admin/erp/ananas?view=orders">Ananas statistika i preuzimanje</Link></p>}
        <ErpGrid key={`${channel ?? "ALL"}:${loyalty}`} module={erpModule} fixedFilters={[...(channel ? [{ id: "sales-channel", columnKey: "channel", operator: "equals" as const, value: channel }] : []), ...(loyalty ? [{ id: "loyalty", columnKey: "loyaltyType", operator: "equals" as const, value: "Gost — loyalty" }] : [])]} />
      </div>
    </>
  );
}
