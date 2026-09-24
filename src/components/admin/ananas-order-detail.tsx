import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { formatRsd } from "@/lib/format";
import type { AnanasOrderItem, AnanasOrderShipment } from "@/lib/ananas/orders";
import { PageHeader } from "./page-header";
import { Card, CardTitle } from "./card";
const date = (d: Date) => d.toLocaleString("sr-Latn-RS", { timeZone: "Europe/Belgrade" });
export async function AnanasOrderDetail({ id }: { id: string }) {
  const order = await db.ananasOrder.findUnique({ where: { id } });
  if (!order) notFound();
  const docs = await db.ananasDocument.findMany({ where: { orderNumber: id }, orderBy: { issuedAt: "desc" } });
  const items = order.items as AnanasOrderItem[], shipments = order.shipments as AnanasOrderShipment[];
  const address = order.billingAddress as Record<string, string | null>;
  return <>
    <PageHeader title={`Ananas porudžbina ${id}`} description={`${order.status} · ${date(order.createdAt)}`} actions={<Link className="underline" href="/admin/erp/prodajni-nalozi">Nazad na prodajne naloge</Link>} />
    <div className="space-y-5 px-4 py-6 md:px-8">
      <Card><CardTitle>Podaci sa Ananasa</CardTitle><p className="text-sm">Porudžbinu, isporuku i fiskalizaciju obrađuje Ananas. Ovaj pregled se automatski ažurira i ne menja SPC lager.</p>
        <div className="mt-4 grid gap-4 md:grid-cols-3"><div><p className="text-sm text-ink-500">Ukupno prema Ananasu</p><strong className="text-xl">{formatRsd(Number(order.total))}</strong></div><div><p className="text-sm text-ink-500">Način plaćanja</p>{order.paymentMethods || "Nije dostavljeno"}</div><div><p className="text-sm text-ink-500">Kupac / podaci za račun</p>{order.customerName ?? "Ananas nije dostavio podatke o kupcu"}<p>{[address.streetName, address.streetNumber, address.postcode, address.city].filter(Boolean).join(" ")}</p></div></div>
        <p className="mt-4 text-xs text-ink-500">Podaci osveženi: {date(order.updatedAt)}. Status proveren: {order.lastCheckedAt.getTime() > 0 ? date(order.lastCheckedAt) : "čeka prvo osvežavanje"}.</p>
      </Card>
      <Card><CardTitle>Artikli</CardTitle><div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr>{["Šifra / EAN", "Artikal", "Naručeno", "Potvrđeno", "Upakovano", "Cena", "Ukupno sa PDV", "Provizija"].map(t => <th className="p-3" key={t}>{t}</th>)}</tr></thead><tbody>{items.map(i => <tr className="border-t" key={i.id}><td className="p-3">{i.sku}<p className="text-xs text-ink-500">{i.ean}</p></td><td className="p-3">{i.name}</td><td className="p-3">{i.quantity}</td><td className="p-3">{i.confirmed ?? "—"}</td><td className="p-3">{i.packed ?? "—"}</td><td className="p-3">{formatRsd(i.unitPrice)}</td><td className="p-3">{formatRsd(i.gross)}</td><td className="p-3">{i.commission == null ? "—" : formatRsd(i.commission)}</td></tr>)}</tbody></table></div></Card>
      <Card><CardTitle>Pošiljke i statusi</CardTitle>{shipments.length ? shipments.map(s => <div className="border-b py-3 text-sm" key={s.suborderId}><strong>{s.suborderId}</strong> · {s.status}<p>{s.warehouseName ?? s.warehouseId ?? "Magacin nije dostavljen"} · {s.carrierName ?? "Kurir nije dostavljen"}</p></div>) : <p className="text-sm">Ananas još nije vratio podatke o pošiljkama. Porudžbina ostaje u redu za proveru.</p>}</Card>
      <Card><CardTitle>Fiskalni računi i refundacije</CardTitle>{docs.length ? docs.map(d => <div className="flex flex-wrap justify-between gap-3 border-b py-3 text-sm" key={d.id}><span>{d.kind === "REFUND" ? "Refundacija" : "Račun"} · {d.fiscalNumber} · {date(d.issuedAt)} · {formatRsd(Number(d.gross))}</span><a className="underline" href={`/api/admin/ananas/${d.id}/pdf`} target="_blank" rel="noopener noreferrer">Otvori PDF</a></div>) : <p className="text-sm">Još nema preuzetog računa za ovu porudžbinu. Računi se preuzimaju zasebnim automatskim uvozom.</p>}</Card>
    </div>
  </>;
}
