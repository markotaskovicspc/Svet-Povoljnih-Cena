export type InboundCogsRow = {
  sku: string;
  name: string;
  qty: number;
  purchasePrices: number[];
  customsRates: Array<number | null>;
  invoiceValueRsd: number;
  customsRsd: number;
  transportRsd: number;
  otherRelatedCostsRsd: number;
  incomingUnitCogsRsd: number;
  existingQty: number;
  existingCogs: number;
  finalCogs: number;
};
const fmt = (value: number) => value.toLocaleString("sr-Latn-RS", {
  minimumFractionDigits: 2, maximumFractionDigits: 2,
});

export function InboundCustomsRates({ rates }: { rates: Array<number | null> }) {
  return <>{Array.from(new Set(rates.length ? rates : [null])).map((rate, index) => (
    <span key={index} className={rate == null ? "block font-semibold text-warning" : "block"}>
      {rate == null ? "Nije uneta" : `${fmt(rate)} %`}
    </span>
  ))}</>;
}

export function InboundInvoiceCogsTable({ rows, purchaseCurrency }: {
  rows: InboundCogsRow[];
  purchaseCurrency: string;
}) {
  const missing = rows.filter(row => !row.customsRates.length || row.customsRates.includes(null));
  const hasCustomsWithoutPositiveRate = rows.some(row => row.customsRsd > 0) &&
    !rows.some(row => row.customsRates.some(rate => rate != null && rate > 0));
  return <>
    {hasCustomsWithoutPositiveRate ? <p role="alert" className="mb-3 rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm">
      Unet je iznos carine, ali nijedna stavka nema pozitivnu carinsku stopu. Proverite stope; prikazana carina je raspoređena prema vrednosti robe.
    </p> : null}
    {missing.length ? <p role="alert" className="mb-3 rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm">
      Carinska stopa nije uneta za: {missing.map(row => row.sku).join(", ")}. Proverite stavke porudžbenice pre knjiženja. Nulta stopa (0 %) i neunesena stopa nisu isto.
    </p> : null}
    <div className="overflow-x-auto">
      <table className="w-full min-w-[1400px] text-sm">
        <caption className="sr-only">Detaljan obračun prijemnice u RSD sa izvornim nabavnim cenama i carinskim stopama</caption>
        <thead className="bg-muted-bg/70 text-left text-xs uppercase tracking-[0.08em] text-ink-500">
          <tr>
            {["Šifra", "Naziv", `Nabavna cena (${purchaseCurrency})`, "Količina", "Carinska stopa", "Vrednost robe (RSD)", "Stvarna carina (RSD)", "Transport po zapremini (RSD)", "Ostali vezani troškovi (RSD)", "COGS novog prijema / kom (RSD)", "Postojeće stanje / COGS (RSD)", "Finalni COGS / kom (RSD)"].map((label, index) => <th key={label} className={`px-3 py-3 ${index > 1 ? "text-right" : ""}`}>{label}</th>)}
          </tr>
        </thead>
        <tbody className="divide-y divide-border/60">
          {rows.map(row => <tr key={row.sku}>
            <td className="px-3 py-3 font-medium">{row.sku}</td>
            <td className="px-3 py-3">{row.name}</td>
            <td className="px-3 py-3 text-right tabular-nums">{Array.from(new Set(row.purchasePrices)).map(price => <span className="block" key={price}>{fmt(price)}</span>)}</td>
            <td className="px-3 py-3 text-right tabular-nums">{row.qty}</td>
            <td className="px-3 py-3 text-right tabular-nums"><InboundCustomsRates rates={row.customsRates} /></td>
            {[row.invoiceValueRsd, row.customsRsd, row.transportRsd, row.otherRelatedCostsRsd, row.incomingUnitCogsRsd].map((value, index) => <td key={index} className="px-3 py-3 text-right tabular-nums">{fmt(value)} RSD</td>)}
            <td className="px-3 py-3 text-right tabular-nums">{row.existingQty} × {fmt(row.existingCogs)} RSD</td>
            <td className="px-3 py-3 text-right font-semibold tabular-nums">{fmt(row.finalCogs)} RSD</td>
          </tr>)}
        </tbody>
        <tfoot className="border-t border-border font-semibold">
          <tr>
            <td colSpan={3} className="px-3 py-3">Ukupno</td>
            <td className="px-3 py-3 text-right tabular-nums">{rows.reduce((sum, row) => sum + row.qty, 0)}</td>
            <td />
            {(["invoiceValueRsd", "customsRsd", "transportRsd", "otherRelatedCostsRsd"] as const).map(key => <td key={key} className="px-3 py-3 text-right tabular-nums">{fmt(rows.reduce((sum, row) => sum + row[key], 0))} RSD</td>)}
            <td colSpan={3} />
          </tr>
        </tfoot>
      </table>
    </div>
  </>;
}
