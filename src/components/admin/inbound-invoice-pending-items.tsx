import Link from "next/link";
import { purchaseOrderGoodsTotal } from "@/lib/admin/purchase-order";

type Item = {
  id: string;
  sku: string;
  name: string;
  qty: number;
  purchasePrice: number;
};

const money = (value: number) => value.toLocaleString("sr-Latn-RS", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** Keep source lines visible when the receipt cannot safely convert them to RSD. */
export function InboundInvoicePendingItems({ items, currency, purchaseOrderId }: {
  items: Item[];
  currency: string;
  purchaseOrderId: string;
}) {
  return (
    <div>
      <p className="mb-3 text-sm text-ink-600">
        Artikli su prikazani po sačuvanim cenama iz porudžbenice. COGS u RSD nije obračunat dok se valuta i vrednost fakture ne usklade.
      </p>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-sm">
          <caption className="sr-only">Stavke porudžbenice bez obračuna COGS</caption>
          <thead className="bg-muted-bg/70 text-left text-xs uppercase tracking-[0.08em] text-ink-500">
            <tr>
              <th className="px-3 py-3">Šifra</th>
              <th className="px-3 py-3">Naziv</th>
              <th className="px-3 py-3 text-right">Nabavna cena ({currency})</th>
              <th className="px-3 py-3 text-right">Količina</th>
              <th className="px-3 py-3 text-right">Vrednost robe ({currency})</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/60">
            {items.map((item) => (
              <tr key={item.id}>
                <td className="px-3 py-3 font-medium">{item.sku}</td>
                <td className="px-3 py-3">{item.name}</td>
                <td className="px-3 py-3 text-right tabular-nums">{money(item.purchasePrice)}</td>
                <td className="px-3 py-3 text-right tabular-nums">{item.qty}</td>
                <td className="px-3 py-3 text-right tabular-nums">{money(item.purchasePrice * item.qty)}</td>
              </tr>
            ))}
            {!items.length ? <tr><td colSpan={5} className="px-3 py-6">Porudžbenica nema stavke.</td></tr> : null}
          </tbody>
          <tfoot className="border-t border-border font-semibold">
            <tr>
              <td colSpan={3} className="px-3 py-3">Ukupno</td>
              <td className="px-3 py-3 text-right tabular-nums">{items.reduce((sum, item) => sum + item.qty, 0)}</td>
              <td className="px-3 py-3 text-right tabular-nums">{money(purchaseOrderGoodsTotal(items))} {currency}</td>
            </tr>
          </tfoot>
        </table>
      </div>
      <Link href={`/admin/erp/porudzbenice/${purchaseOrderId}`} className="mt-3 inline-block text-sm text-walnut hover:underline">
        Otvori porudžbenicu i proveri cene i količine →
      </Link>
    </div>
  );
}
