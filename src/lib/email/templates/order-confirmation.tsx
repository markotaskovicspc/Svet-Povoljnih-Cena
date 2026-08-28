import { MERCHANT_LEGAL_INFO } from "@/lib/merchant";
import type { Order } from "@/types";
import {
  EmailButton,
  EmailDivider,
  EmailEyebrow,
  EmailHeading,
  EmailLayout,
  EmailNotice,
  EmailParagraph,
  EmailSectionHeading,
} from "./_layout";

const INK = "#172B36";
const MUTED = "#5F6F78";
const BLUE = "#123F5A";
const LINE = "#DCE6EA";
const SOFT = "#F5F8F9";
const RED = "#B42332";

const fmt = (value: number) =>
  new Intl.NumberFormat("sr-Latn-RS", {
    style: "currency",
    currency: "RSD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);

const dateFmt = new Intl.DateTimeFormat("sr-Latn-RS", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  timeZone: "Europe/Belgrade",
});

const PAYMENT_LABELS: Record<Order["paymentMethod"], string> = {
  ips: "IPS Skeniraj",
  kartica: "Platna kartica",
  google_pay: "Google Pay",
  apple_pay: "Apple Pay",
  uplata_na_racun: "Uplata na račun",
  pouzece_gotovina: "Pouzeće - gotovina",
  pouzece_kartica: "Pouzeće - kartica",
};

const PAYMENT_STATUS_LABELS: Record<string, string> = {
  pending: "Čeka potvrdu",
  authorized: "Autorizovano",
  paid: "Plaćeno",
  failed: "Neuspešno",
  refunded: "Refundirano",
  partial_refund: "Delimično refundirano",
};

export interface OrderConfirmationProps {
  order: Order;
  baseUrl?: string;
  accessToken?: string;
  includesPurchaseDocuments?: boolean;
  includesWithdrawalForm?: boolean;
  guaranteeTermText?: string;
  previewMode?: boolean;
}

export function OrderConfirmation({
  order,
  baseUrl = "https://www.svetpovoljnihcena.rs",
  accessToken,
  includesPurchaseDocuments = true,
  includesWithdrawalForm = true,
  guaranteeTermText,
  previewMode = false,
}: OrderConfirmationProps) {
  const buyer = order.billingAddress ?? order.shippingAddress;
  const businessName = buyer.companyName?.trim();
  const businessPib = buyer.pib?.trim();
  const isBusiness = Boolean(businessName || businessPib);
  const contactName = `${buyer.firstName} ${buyer.lastName}`.trim();
  const businessDisplayName = businessName || contactName;
  const orderUrl = order.userId
    ? `${baseUrl}/nalog/porudzbine/${encodeURIComponent(order.id)}`
    : `${baseUrl}/checkout/potvrda?order=${encodeURIComponent(order.id)}${
        accessToken ? `&token=${encodeURIComponent(accessToken)}` : ""
      }`;
  const guestReclamationUrl =
    !order.userId && accessToken
      ? `${baseUrl}/reklamacije/prijava?order=${encodeURIComponent(order.id)}&token=${encodeURIComponent(accessToken)}`
      : null;
  const createdAt = new Date(order.createdAt);
  const hasValidDate = !Number.isNaN(createdAt.getTime());

  return (
    <EmailLayout preview={`Porudžbina ${order.id} je uspešno primljena`}>
      <EmailEyebrow>Porudžbina je primljena</EmailEyebrow>
      <EmailHeading>Hvala vam na kupovini!</EmailHeading>
      {previewMode ? (
        <EmailNotice>
          <strong>Kontrolni pregled — nije poslato kupcu.</strong>
          <br />
          Ova poruka prikazuje kako će izgledati potvrda za pravno lice.
        </EmailNotice>
      ) : null}
      <EmailParagraph>
        {isBusiness ? (
          <>
            Poštovani, porudžbina za <strong>{businessDisplayName}</strong> je uspešno
            evidentirana. Priprema počinje nakon evidentirane uplate na račun.
          </>
        ) : (
          <>
            Poštovani/a {order.shippingAddress.firstName}, vaša porudžbina je
            uspešno evidentirana i započeli smo njenu pripremu.
          </>
        )}
      </EmailParagraph>

      <table
        role="presentation"
        cellPadding={0}
        cellSpacing={0}
        width="100%"
        style={{
          width: "100%",
          marginTop: 20,
          borderCollapse: "separate",
          backgroundColor: SOFT,
          border: `1px solid ${LINE}`,
          borderRadius: 8,
        }}
      >
        <tbody>
          <tr>
            <td style={{ width: "66%", padding: "13px 14px" }}>
              <MetaLabel>Broj porudžbine</MetaLabel>
              <MetaValue>{order.id}</MetaValue>
            </td>
            <td style={{ width: "34%", padding: "13px 14px", textAlign: "right" }}>
              <MetaLabel>Datum</MetaLabel>
              <MetaValue>{hasValidDate ? dateFmt.format(createdAt) : "-"}</MetaValue>
            </td>
          </tr>
        </tbody>
      </table>

      <EmailDivider />
      <EmailSectionHeading>Pregled porudžbine</EmailSectionHeading>
      <table
        role="presentation"
        cellPadding={0}
        cellSpacing={0}
        width="100%"
        style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}
      >
        <tbody>
          {order.items.map((item, index) => (
            <tr key={`${item.sku}-${index}`}>
              <td
                style={{
                  padding: "12px 8px 12px 0",
                  borderTop: index === 0 ? `1px solid ${LINE}` : undefined,
                  borderBottom: `1px solid ${LINE}`,
                  color: INK,
                  lineHeight: 1.45,
                }}
              >
                <strong>
                  {item.qty} × {item.name}
                </strong>
                {item.withAssembly ? (
                  <>
                    <br />
                    <span style={{ color: MUTED, fontSize: 11 }}>Sa montažom</span>
                  </>
                ) : null}
                <br />
                <span style={{ color: MUTED, fontSize: 11 }}>Šifra: {item.sku}</span>
              </td>
              <td
                style={{
                  padding: "12px 0 12px 8px",
                  borderTop: index === 0 ? `1px solid ${LINE}` : undefined,
                  borderBottom: `1px solid ${LINE}`,
                  color: INK,
                  fontWeight: 700,
                  textAlign: "right",
                  whiteSpace: "nowrap",
                }}
              >
                {fmt(item.unitPriceSale * item.qty)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <table
        role="presentation"
        cellPadding={0}
        cellSpacing={0}
        width="100%"
        style={{ width: "100%", marginTop: 14, borderCollapse: "collapse", fontSize: 13 }}
      >
        <tbody>
          <TotalRow label="Vrednost artikala" value={fmt(order.subtotal + order.savings)} />
          {order.savings > 0 ? (
            <TotalRow label="Ušteda" value={`-${fmt(order.savings)}`} discount />
          ) : null}
          <TotalRow label="Isporuka" value={fmt(order.shipping)} />
          {order.assemblyTotal > 0 ? (
            <TotalRow label="Montaža" value={fmt(order.assemblyTotal)} />
          ) : null}
          {order.voucherDiscount && order.voucherCode ? (
            <TotalRow
              label={`Vaučer „${order.voucherCode}”`}
              value={`-${fmt(order.voucherDiscount)}`}
              discount
            />
          ) : null}
          {order.firstPurchaseDiscount ? (
            <TotalRow
              label="Popust za prvu kupovinu"
              value={`-${fmt(order.firstPurchaseDiscount)}`}
              discount
            />
          ) : null}
          {order.savedCardDiscount ? (
            <TotalRow
              label="Popust za sačuvanu karticu"
              value={`-${fmt(order.savedCardDiscount)}`}
              discount
            />
          ) : null}
          <tr>
            <td
              style={{
                paddingTop: 12,
                borderTop: `2px solid ${BLUE}`,
                color: INK,
                fontSize: 17,
                fontWeight: 800,
              }}
            >
              Ukupno
            </td>
            <td
              style={{
                paddingTop: 12,
                borderTop: `2px solid ${BLUE}`,
                color: INK,
                fontSize: 17,
                fontWeight: 800,
                textAlign: "right",
                whiteSpace: "nowrap",
              }}
            >
              {fmt(order.total)}
            </td>
          </tr>
        </tbody>
      </table>

      <EmailDivider />
      <EmailSectionHeading>Isporuka i plaćanje</EmailSectionHeading>
      <table
        role="presentation"
        cellPadding={0}
        cellSpacing={0}
        width="100%"
        style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}
      >
        <tbody>
          <DetailRow
            label="Kupac"
            value={businessName || contactName}
          />
          {businessPib ? <DetailRow label="PIB" value={businessPib} /> : null}
          {isBusiness && contactName ? (
            <DetailRow label="Kontakt" value={contactName} />
          ) : null}
          <DetailRow
            label="Adresa isporuke"
            value={`${order.shippingAddress.street}, ${order.shippingAddress.postalCode} ${order.shippingAddress.city}`}
          />
          <DetailRow label="Telefon" value={order.shippingAddress.phone} />
          <DetailRow label="Način plaćanja" value={PAYMENT_LABELS[order.paymentMethod]} />
          <DetailRow label="Status plaćanja" value={paymentStatusLabel(order)} />
          {order.payment?.paymentReference ? (
            <DetailRow label="Referenca plaćanja" value={order.payment.paymentReference} />
          ) : null}
        </tbody>
      </table>

      {order.paymentMethod === "uplata_na_racun" ? (
        <>
          <EmailDivider />
          <EmailSectionHeading>Podaci za uplatu</EmailSectionHeading>
          <EmailNotice>
            Uplatite <strong>{fmt(order.total)}</strong> na račun{" "}
            <strong>{MERCHANT_LEGAL_INFO.bankAccount}</strong> kod{" "}
            {MERCHANT_LEGAL_INFO.bankName}. Kao poziv na broj navedite{" "}
            <strong>{order.id}</strong>. Porudžbina ide u pripremu nakon što
            evidentiramo uplatu.
          </EmailNotice>
        </>
      ) : null}

      {includesPurchaseDocuments || guaranteeTermText ? (
        <>
          <EmailDivider />
          <EmailSectionHeading>Dokumenta u prilogu</EmailSectionHeading>
          <table
            role="presentation"
            cellPadding={0}
            cellSpacing={0}
            width="100%"
            style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}
          >
            <tbody>
              {includesPurchaseDocuments ? (
                <>
                  <AttachmentRow label="Predračun sa pregledom cena i PDV-a" />
                  {includesWithdrawalForm ? (
                    <AttachmentRow label="Obrazac za odustanak od kupovine" />
                  ) : null}
                </>
              ) : null}
              {guaranteeTermText ? (
                <AttachmentRow label={`Garantni list - garancija ${guaranteeTermText}`} />
              ) : null}
            </tbody>
          </table>
        </>
      ) : null}

      {guaranteeTermText ? (
        <>
          <EmailDivider />
          <EmailNotice>
            <strong>Garantni list je popunjen.</strong>
            <br />
            Sačuvajte ga zajedno sa računom. Sadrži proizvode iz porudžbine na
            koje se odnosi garancija.
          </EmailNotice>
        </>
      ) : null}

      {previewMode ? null : (
        <>
          <EmailDivider />
          <EmailButton href={orderUrl}>Pogledaj porudžbinu</EmailButton>
        </>
      )}

      {!previewMode && guestReclamationUrl ? (
        <>
          <EmailDivider />
          <EmailParagraph>
            Kupili ste bez naloga? Sačuvajte ovu poruku. Preko bezbednog linka
            možete prijaviti reklamaciju za artikal iz ove porudžbine.
          </EmailParagraph>
          <EmailButton href={guestReclamationUrl}>Prijavi reklamaciju</EmailButton>
        </>
      ) : null}

      <EmailDivider />
      <p style={{ margin: 0, color: MUTED, fontSize: 11, lineHeight: 1.55 }}>
        Trgovac: {MERCHANT_LEGAL_INFO.name} · PIB {MERCHANT_LEGAL_INFO.pib} ·{" "}
        {MERCHANT_LEGAL_INFO.shortAddress} · račun {MERCHANT_LEGAL_INFO.bankAccount}
      </p>
    </EmailLayout>
  );
}

function paymentStatusLabel(order: Order) {
  const status = order.payment?.status ?? "pending";
  if (status !== "pending") return PAYMENT_STATUS_LABELS[status] ?? "Čeka potvrdu";
  if (
    order.paymentMethod === "pouzece_gotovina" ||
    order.paymentMethod === "pouzece_kartica"
  ) {
    return "Plaćanje prilikom isporuke";
  }
  if (order.paymentMethod === "uplata_na_racun") return "Čeka uplatu";
  return "Čeka potvrdu";
}

function MetaLabel({ children }: { children: string }) {
  return (
    <span
      style={{
        display: "block",
        marginBottom: 4,
        color: MUTED,
        fontSize: 9,
        fontWeight: 700,
        letterSpacing: "0.08em",
        textTransform: "uppercase",
      }}
    >
      {children}
    </span>
  );
}

function MetaValue({ children }: { children: string }) {
  return (
    <strong style={{ color: INK, fontSize: 12, lineHeight: 1.35, wordBreak: "break-word" }}>
      {children}
    </strong>
  );
}

function TotalRow({
  label,
  value,
  discount = false,
}: {
  label: string;
  value: string;
  discount?: boolean;
}) {
  return (
    <tr style={{ color: discount ? RED : MUTED }}>
      <td style={{ padding: "4px 0" }}>{label}</td>
      <td style={{ padding: "4px 0", textAlign: "right", whiteSpace: "nowrap" }}>
        {value}
      </td>
    </tr>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <tr>
      <td
        style={{
          width: "36%",
          padding: "6px 10px 6px 0",
          color: MUTED,
          verticalAlign: "top",
        }}
      >
        {label}
      </td>
      <td style={{ padding: "6px 0", color: INK, fontWeight: 600, lineHeight: 1.45 }}>
        {value}
      </td>
    </tr>
  );
}

function AttachmentRow({ label }: { label: string }) {
  return (
    <tr>
      <td style={{ width: 46, padding: "5px 10px 5px 0", verticalAlign: "top" }}>
        <span
          style={{
            display: "inline-block",
            width: 36,
            height: 22,
            borderRadius: 4,
            backgroundColor: BLUE,
            color: "#FFFFFF",
            fontSize: 9,
            fontWeight: 800,
            lineHeight: "22px",
            letterSpacing: "0.04em",
            textAlign: "center",
          }}
        >
          PDF
        </span>
      </td>
      <td style={{ padding: "7px 0", color: INK, lineHeight: 1.45 }}>{label}</td>
    </tr>
  );
}
