import type { Order } from "@/types";
import { MERCHANT_LEGAL_INFO } from "@/lib/merchant";
import {
  EmailButton,
  EmailDivider,
  EmailHeading,
  EmailLayout,
  EmailParagraph,
} from "./_layout";

const fmt = (n: number) =>
  new Intl.NumberFormat("sr-Latn-RS", {
    style: "currency",
    currency: "RSD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);

const dateFmt = new Intl.DateTimeFormat("sr-Latn-RS", {
  dateStyle: "medium",
  timeStyle: "short",
});

const PAYMENT_STATUS_LABEL: Record<NonNullable<Order["payment"]>["status"], string> = {
  pending: "U obradi",
  authorized: "Autorizovano",
  paid: "Izvršeno",
  failed: "Neizvršeno",
  refunded: "Refundirano",
  partial_refund: "Delimično refundirano",
};

export interface IpsPaymentConfirmationProps {
  order: Order;
  baseUrl?: string;
}

export function IpsPaymentConfirmation({
  order,
  baseUrl = "https://www.svetpovoljnihcena.rs",
}: IpsPaymentConfirmationProps) {
  const payment = order.payment;
  const orderUrl = order.userId
    ? `${baseUrl}/nalog/porudzbine/${encodeURIComponent(order.id)}`
    : `${baseUrl}/checkout/potvrda?order=${encodeURIComponent(order.id)}&status=paid`;
  const customerEmail = order.customerEmail ?? order.guestEmail ?? "—";
  const paidAt = payment?.paidAt ? dateFmt.format(new Date(payment.paidAt)) : "—";

  return (
    <EmailLayout preview={`IPS plaćanje za porudžbinu ${order.id} je potvrđeno`}>
      <EmailHeading>IPS plaćanje je potvrđeno</EmailHeading>
      <EmailParagraph>
        Poštovani/a {order.shippingAddress.firstName}, evidentirali smo uspešno
        IPS Skeniraj plaćanje za porudžbinu <strong>{order.id}</strong>.
      </EmailParagraph>

      <EmailDivider />

      <table
        role="presentation"
        cellPadding={0}
        cellSpacing={0}
        width="100%"
        style={{ fontSize: 13, color: "#3B342D" }}
      >
        <tbody>
          <InfoRow label="Broj porudžbine" value={order.id} mono />
          <InfoRow label="Iznos transakcije" value={fmt(order.total)} mono />
          <InfoRow
            label="Status transakcije"
            value={payment ? PAYMENT_STATUS_LABEL[payment.status] : "Izvršeno"}
          />
          <InfoRow
            label="RP referenca"
            value={payment?.paymentReference ?? "—"}
            mono
          />
          <InfoRow label="Datum uplate" value={paidAt} />
          <InfoRow
            label="Broj računa trgovca"
            value={MERCHANT_LEGAL_INFO.bankAccount}
            mono
          />
        </tbody>
      </table>

      <EmailDivider />

      <table
        role="presentation"
        cellPadding={0}
        cellSpacing={0}
        width="100%"
        style={{ fontSize: 13, color: "#3B342D" }}
      >
        <tbody>
          {order.items.map((it) => (
            <tr key={it.sku}>
              <td style={{ padding: "8px 0" }}>
                {it.qty} × {it.name}
                {it.withAssembly ? " (sa montažom)" : ""}
                <br />
                <span style={{ color: "#6B6259", fontSize: 11 }}>SKU {it.sku}</span>
              </td>
              <td style={{ padding: "8px 0", textAlign: "right", whiteSpace: "nowrap" }}>
                {fmt(it.unitPriceSale * it.qty)}
              </td>
            </tr>
          ))}
          <tr>
            <td style={{ paddingTop: 12 }}>Isporuka</td>
            <td style={{ paddingTop: 12, textAlign: "right" }}>{fmt(order.shipping)}</td>
          </tr>
          {order.assemblyTotal > 0 ? (
            <tr>
              <td>Montaža</td>
              <td style={{ textAlign: "right" }}>{fmt(order.assemblyTotal)}</td>
            </tr>
          ) : null}
          <tr style={{ fontWeight: 600, fontSize: 16, color: "#1A1714" }}>
            <td style={{ paddingTop: 10 }}>Ukupno</td>
            <td style={{ paddingTop: 10, textAlign: "right" }}>{fmt(order.total)}</td>
          </tr>
        </tbody>
      </table>

      <EmailDivider />

      <EmailParagraph>
        Kupac: {order.shippingAddress.firstName} {order.shippingAddress.lastName}
        <br />
        E-pošta kupca: {customerEmail}
        <br />
        Adresa kupca / isporuke: {order.shippingAddress.street},{" "}
        {order.shippingAddress.postalCode} {order.shippingAddress.city}
        <br />
        Trgovac: {MERCHANT_LEGAL_INFO.name}, PIB {MERCHANT_LEGAL_INFO.pib},{" "}
        {MERCHANT_LEGAL_INFO.shortAddress}, {MERCHANT_LEGAL_INFO.email}
        <br />
        {MERCHANT_LEGAL_INFO.pdvNote}
      </EmailParagraph>

      <EmailButton href={orderUrl}>Pregled porudžbine</EmailButton>
    </EmailLayout>
  );
}

function InfoRow({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <tr>
      <td style={{ padding: "5px 0", color: "#6B6259" }}>{label}</td>
      <td
        style={{
          padding: "5px 0",
          textAlign: "right",
          color: "#1A1714",
          fontFamily: mono ? "ui-monospace, SFMono-Regular, Menlo, monospace" : undefined,
          fontWeight: 600,
        }}
      >
        {value}
      </td>
    </tr>
  );
}
