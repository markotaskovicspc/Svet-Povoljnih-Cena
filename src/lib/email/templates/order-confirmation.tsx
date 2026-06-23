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
    maximumFractionDigits: 0,
  }).format(n);

export interface OrderConfirmationProps {
  order: Order;
  baseUrl?: string;
}

export function OrderConfirmation({
  order,
  baseUrl = "https://www.svetpovoljnihcena.rs",
}: OrderConfirmationProps) {
  const orderUrl = order.userId
    ? `${baseUrl}/nalog/porudzbine/${encodeURIComponent(order.id)}`
    : `${baseUrl}/checkout/potvrda?order=${encodeURIComponent(order.id)}`;
  return (
    <EmailLayout preview={`Porudžbina ${order.id} je primljena`}>
      <EmailHeading>Hvala vam na porudžbini!</EmailHeading>
      <EmailParagraph>
        Poštovani/a {order.shippingAddress.firstName}, primili smo vašu
        porudžbinu <strong>{order.id}</strong> i započeli pripremu. U prilogu
        ovog mejla nalazi se PDF predračun i obrazac za odustajanje.
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
          {order.items.map((it) => (
            <tr key={it.sku}>
              <td style={{ padding: "8px 0" }}>
                {it.qty} × {it.name}
                {it.withAssembly ? " (sa montažom)" : ""}
                <br />
                <span style={{ color: "#6B6259", fontSize: 11 }}>SKU {it.sku}</span>
              </td>
              <td
                style={{ padding: "8px 0", textAlign: "right", whiteSpace: "nowrap" }}
              >
                {fmt(it.unitPriceSale * it.qty)}
              </td>
            </tr>
          ))}
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
          <tr>
            <td>Artikli</td>
            <td style={{ textAlign: "right" }}>{fmt(order.subtotal)}</td>
          </tr>
          {order.savings > 0 ? (
            <tr style={{ color: "#D7263D" }}>
              <td>Ušteda</td>
              <td style={{ textAlign: "right" }}>−{fmt(order.savings)}</td>
            </tr>
          ) : null}
          <tr>
            <td>Isporuka</td>
            <td style={{ textAlign: "right" }}>{fmt(order.shipping)}</td>
          </tr>
          {order.assemblyTotal > 0 ? (
            <tr>
              <td>Montaža</td>
              <td style={{ textAlign: "right" }}>{fmt(order.assemblyTotal)}</td>
            </tr>
          ) : null}
          {order.voucherDiscount && order.voucherCode ? (
            <tr style={{ color: "#D7263D" }}>
              <td>Vaučer „{order.voucherCode}”</td>
              <td style={{ textAlign: "right" }}>−{fmt(order.voucherDiscount)}</td>
            </tr>
          ) : null}
          <tr style={{ fontWeight: 600, fontSize: 16, color: "#1A1714" }}>
            <td style={{ paddingTop: 10 }}>Ukupno</td>
            <td style={{ paddingTop: 10, textAlign: "right" }}>
              {fmt(order.total)}
            </td>
          </tr>
        </tbody>
      </table>

      <EmailDivider />

      <EmailParagraph>
        Adresa isporuke: {order.shippingAddress.street},{" "}
        {order.shippingAddress.postalCode} {order.shippingAddress.city}
        <br />
        Kupac: {order.shippingAddress.firstName} {order.shippingAddress.lastName}
        {order.customerEmail ?? order.guestEmail
          ? `, ${order.customerEmail ?? order.guestEmail}`
          : ""}
        <br />
        Način plaćanja: {order.paymentMethod}
        <br />
        Status plaćanja: {order.payment?.status ?? "pending"}
        <br />
        {order.payment?.paymentReference ? (
          <>
            RP referenca: {order.payment.paymentReference}
            <br />
          </>
        ) : null}
        Trgovac: {MERCHANT_LEGAL_INFO.name}, PIB {MERCHANT_LEGAL_INFO.pib},{" "}
        {MERCHANT_LEGAL_INFO.shortAddress}, račun {MERCHANT_LEGAL_INFO.bankAccount}
        <br />
        Telefon: {order.shippingAddress.phone}
      </EmailParagraph>

      <EmailButton href={orderUrl}>Pregled porudžbine</EmailButton>
    </EmailLayout>
  );
}
