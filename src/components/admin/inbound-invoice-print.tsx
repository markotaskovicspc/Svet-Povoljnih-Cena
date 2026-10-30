import Link from "next/link";
import { AutoPrintOnLoad } from "@/components/admin/auto-print-on-load";
import { PrintPageButton } from "@/components/admin/print-page-button";
import type { ActualInboundCostAllocationLine } from "@/lib/admin/inbound-invoice";
import { MERCHANT_LEGAL_INFO } from "@/lib/merchant";
import styles from "./inbound-invoice-print.module.css";

type Props = {
  id: string;
  number: string;
  date: Date;
  status: string;
  preliminary: boolean;
  supplier: string | null;
  warehouse: string | null;
  purchaseOrderNumber: string | null;
  purchaseCurrency: string;
  currency: string;
  netValue: number;
  vatValue: number;
  grossValue: number;
  notes: string | null;
  warning: string | null;
  rows: Array<ActualInboundCostAllocationLine & { name: string }>;
  pendingItems: Array<{ id: string; sku: string; name: string; qty: number; purchasePrice: number }>;
  autoPrint: boolean;
};

const fmt = (value: number) => value.toLocaleString("sr-Latn-RS", {
  minimumFractionDigits: 2, maximumFractionDigits: 2,
});

export function InboundInvoicePrint(props: Props) {
  const totalQty = (props.rows.length ? props.rows : props.pendingItems)
    .reduce((sum, row) => sum + row.qty, 0);
  const costColumns = ["invoiceValueRsd", "customsRsd", "transportRsd", "otherRelatedCostsRsd", "incomingUnitCogsRsd", "totalActualCostRsd"] as const;
  return (
    <main className={styles.document}>
      {props.autoPrint ? <AutoPrintOnLoad /> : null}
      <nav className={styles.toolbar} aria-label="Štampa prijemnice">
        <Link href={`/admin/erp/ulazne-fakture/${props.id}`}>← Nazad na prijemnicu</Link>
        <PrintPageButton label="Štampaj prijemnicu" />
      </nav>
      <header className={styles.header}>
        <div>
          <strong>{MERCHANT_LEGAL_INFO.name}</strong>
          <p>{MERCHANT_LEGAL_INFO.shortAddress}</p>
          <p>PIB {MERCHANT_LEGAL_INFO.pib} · MB {MERCHANT_LEGAL_INFO.registrationNumber}</p>
        </div>
        <div>
          <h1>PRIJEMNICA</h1>
          <strong>{props.number}</strong>
          <p>Datum prijema: {new Intl.DateTimeFormat("sr-Latn-RS", {
            timeZone: "Europe/Belgrade", dateStyle: "short",
          }).format(props.date)}</p>
          <p>Status: <strong>{props.status}</strong></p>
        </div>
      </header>
      <dl className={styles.details}>
        <div><dt>Dobavljač</dt><dd>{props.supplier ?? "Nije izabran"}</dd></div>
        <div><dt>Magacin prijema</dt><dd>{props.warehouse ?? "Nije izabran"}</dd></div>
        <div><dt>Porudžbenica</dt><dd>{props.purchaseOrderNumber ?? "Nije povezana"}</dd></div>
      </dl>
      {props.preliminary ? <p className={styles.notice}>NACRT — prijemnica nije proknjižena. Prikazane su sačuvane vrednosti.</p> : null}
      {props.status === "Storno" ? <p className={styles.notice}>STORNO — prijemnica je stornirana.</p> : null}
      {props.warning ? <p role="alert" className={styles.notice}>{props.warning}</p> : null}
      {props.rows.length ? (
        <table className={styles.items}>
          <caption>Stavke prijemnice — obračun u RSD</caption>
          <thead><tr>
            {["Šifra", "Naziv artikla", "Količina", "Vrednost robe", "Carina", "Transport", "Ostali troškovi", "COGS / kom", "Ukupno bez PDV-a"].map(label => <th key={label} scope="col">{label}</th>)}
          </tr></thead>
          <tbody>{props.rows.map(row => <tr key={row.sku}>
            <td>{row.sku}</td><td>{row.name}</td><td>{row.qty}</td>
            {costColumns.map(key => <td key={key}>{fmt(row[key])}</td>)}
          </tr>)}</tbody>
          <tfoot><tr>
            <th colSpan={2} scope="row">Ukupno</th><td>{totalQty}</td>
            {costColumns.map(key => <td key={key}>{key === "incomingUnitCogsRsd" ? "—" : fmt(props.rows.reduce((sum, row) => sum + row[key], 0))}</td>)}
          </tr></tfoot>
        </table>
      ) : props.pendingItems.length ? (
        <>
          <p className={styles.notice}>COGS u RSD nije obračunat. Stavke su prikazane po sačuvanim nabavnim cenama iz porudžbenice.</p>
          <table className={styles.items}>
            <caption>Stavke porudžbenice — {props.purchaseCurrency}</caption>
            <thead><tr>{["Šifra", "Naziv artikla", "Količina", "Nabavna cena", "Vrednost robe"].map(label => <th key={label} scope="col">{label}</th>)}</tr></thead>
            <tbody>{props.pendingItems.map(item => <tr key={item.id}>
              <td>{item.sku}</td><td>{item.name}</td><td>{item.qty}</td>
              <td>{fmt(item.purchasePrice)}</td><td>{fmt(item.purchasePrice * item.qty)}</td>
            </tr>)}</tbody>
            <tfoot><tr><th colSpan={2} scope="row">Ukupno</th><td>{totalQty}</td><td /><td>{fmt(props.pendingItems.reduce((sum, item) => sum + item.purchasePrice * item.qty, 0))}</td></tr></tfoot>
          </table>
        </>
      ) : <p className={styles.notice}>Nema stavki. Prijemnica nema povezanu porudžbenicu sa artiklima.</p>}
      <dl className={styles.totals}>
        <div><dt>Ukupno bez PDV-a</dt><dd>{fmt(props.netValue)} {props.currency}</dd></div>
        <div><dt>PDV</dt><dd>{fmt(props.vatValue)} {props.currency}</dd></div>
        <div><dt>Ukupno sa PDV-om</dt><dd>{fmt(props.grossValue)} {props.currency}</dd></div>
      </dl>
      {props.notes ? <section className={styles.notes}><h2>Napomena</h2><p>{props.notes}</p></section> : null}
      <footer className={styles.signatures}><p>Predao</p><p>Primio</p></footer>
    </main>
  );
}
