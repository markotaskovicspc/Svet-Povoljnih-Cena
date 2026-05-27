import type { Order, OrderStatus } from "@/types";
import {
  EmailButton,
  EmailHeading,
  EmailLayout,
  EmailParagraph,
} from "./_layout";

const STATUS_COPY: Record<OrderStatus, { title: string; body: string }> = {
  kreirano: {
    title: "Porudžbina je primljena",
    body: "Vaša porudžbina je uspešno kreirana i čeka potvrdu plaćanja.",
  },
  potvrdjeno: {
    title: "Porudžbina je potvrđena",
    body: "Plaćanje je potvrđeno. Krećemo sa pripremom paketa.",
  },
  u_pripremi: {
    title: "Porudžbina je u pripremi",
    body: "Pakujemo vaše artikle. Uskoro ćemo ih predati kuriru.",
  },
  spremno_za_isporuku: {
    title: "Porudžbina je spremna za isporuku",
    body: "Paket je spreman i očekuje preuzimanje od strane kurirske službe.",
  },
  u_isporuci: {
    title: "Porudžbina je krenula ka vama",
    body: "Kurir je preuzeo paket. Pratite status u realnom vremenu klikom ispod.",
  },
  isporuceno: {
    title: "Porudžbina je isporučena",
    body: "Hvala vam na poverenju! Ako vam je nešto potrebno, pišite nam.",
  },
  otkazano: {
    title: "Porudžbina je otkazana",
    body: "Vaša porudžbina je otkazana. Ako mislite da je ovo greška, kontaktirajte nas.",
  },
  vraceno: {
    title: "Porudžbina je vraćena",
    body: "Primili smo vaš povraćaj i pokrećemo refundaciju u skladu sa uslovima.",
  },
};

export interface OrderStatusChangedProps {
  order: Order;
  status: OrderStatus;
  baseUrl?: string;
  trackingUrl?: string;
}

export function OrderStatusChanged({
  order,
  status,
  baseUrl = "https://www.svetpovoljnihcena.rs",
  trackingUrl,
}: OrderStatusChangedProps) {
  const copy = STATUS_COPY[status];
  const orderUrl = `${baseUrl}/nalog/porudzbine/${encodeURIComponent(order.id)}`;
  return (
    <EmailLayout preview={`${copy.title} — ${order.id}`}>
      <EmailHeading>{copy.title}</EmailHeading>
      <EmailParagraph>{copy.body}</EmailParagraph>
      <EmailParagraph>
        Broj porudžbine: <strong>{order.id}</strong>
        {order.payment?.paymentReference ? (
          <>
            <br />
            RP referenca: <strong>{order.payment.paymentReference}</strong>
          </>
        ) : null}
      </EmailParagraph>
      <EmailButton href={trackingUrl ?? orderUrl}>
        {trackingUrl ? "Prati pošiljku" : "Pregled porudžbine"}
      </EmailButton>
    </EmailLayout>
  );
}
