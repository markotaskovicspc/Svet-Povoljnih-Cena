import Link from "next/link";
import { db } from "@/lib/db";
import { ANANAS_RETURN_STATUSES, ananasReturnShipments } from "@/lib/ananas/returns";
import { ananasOrderHref } from "@/lib/ananas/order-rows";

export async function AnanasReturns({ query, warehouseMode }: { query: string; warehouseMode: boolean }) {
  const rows = await db.ananasOrder.findMany({
    where: { AND: [
      { OR: ANANAS_RETURN_STATUSES.map(status => ({ shipments: { array_contains: [{ status }] } })) },
      ...(query ? [{ OR: [
        { id: { equals: query, mode: "insensitive" as const } },
        { shipments: { array_contains: [{ suborderId: query }] } },
      ] }] : []),
    ] },
    orderBy: [{ updatedAt: "desc" }, { id: "asc" }], take: 51,
    select: { id: true, shipments: true, lastCheckedAt: true },
  });
  return <section className="space-y-3 rounded-xl border border-border p-4" aria-label="Ananas povrati">
    <h2 className="font-semibold">Ananas povrati</h2>
    <p className="text-sm text-ink-500">Pretraga po broju Ananas porudžbine ili ID-u pošiljke (npr. H7SRK-Z2IAO-DS-1). ID pošiljke nije broj povratne adresnice. Za povezivanje kurirskog barkoda potrebna je potvrda Ananasa.</p>
    {rows.slice(0, 50).map(order => <article key={order.id} className="space-y-2 rounded-lg bg-muted p-3 text-sm">
      {warehouseMode ? <strong className="break-all font-mono">{order.id}</strong> : <Link className="break-all font-mono font-semibold underline" href={ananasOrderHref(order.id)}>{order.id}</Link>}
      {ananasReturnShipments(order.shipments).filter(s => !query || order.id.toUpperCase() === query || s.suborderId.toUpperCase() === query).map(s => <div key={s.suborderId}>
        <p className="break-all">ID pošiljke: <strong>{s.suborderId}</strong></p>
        <p>{s.status === "RETURNED_TO_SELLER" ? "Vraćeno prodavcu prema Ananasu" : "Povrat prodavcu prema Ananasu"} · {s.carrierName ?? "Kurir nije dostavljen"} · {s.quantity} kom.</p>
      </div>)}
      <p className="text-xs text-ink-500">Status proveren: {order.lastCheckedAt.getTime() ? order.lastCheckedAt.toLocaleString("sr-Latn-RS", { timeZone: "Europe/Belgrade" }) : "čeka proveru"}. Fizički prijem robe proverava se posebno.</p>
    </article>)}
    {!rows.length && <p className="text-sm">{query ? "Nema uvezenog Ananas povrata sa tim brojem porudžbine ili ID-em pošiljke." : "Nema uvezenih Ananas pošiljki sa statusom povrata prodavcu."}</p>}
    {rows.length > 50 && <p className="text-xs text-ink-500">Prikazano je poslednjih 50 porudžbina. Za stariju pošiljku unesite njen ID ili broj porudžbine.</p>}
  </section>;
}
