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
    body: "Hvala vam na poverenju! Ako je nešto oštećeno, neispravno ili nedostaje, prijavite reklamaciju preko linka ispod i priložite fotografije — tako je rešavamo najbrže.",
  },
  otkazano: {
    title: "Porudžbina je otkazana",
    body: "Vaša porudžbina je otkazana. Ako mislite da je ovo greška ili i dalje želite artikle, poručite ih ponovo na sajtu ili nam pišite u chat na sajtu.",
  },
  vraceno: {
    title: "Pošiljka se vraća",
    body: "Pošiljka se vraća nama (nije uručena ili ste je vratili). Ako ste porudžbinu platili unapred, novac vraćamo kada pošiljka stigne u magacin i o tome dobijate poseban mejl. Ako i dalje želite artikle, možete ih ponovo poručiti na sajtu.",
  },
};

export interface OrderStatusChangedProps {
  order: Order;
  status: OrderStatus;
  baseUrl?: string;
  trackingUrl?: string;
  /** Link ka porudžbini, i za kupce bez naloga (potpisan link iz orderLinkForEmail). */
  orderUrl?: string | null;
}

/** Većina pitanja („gde je paket“, „kada stiže“) chat na sajtu reši odmah. */
const CHAT_NOTE =
  "Za pitanja o porudžbini najbrže odgovara chat na sajtu (ikonica u donjem desnom uglu): dostupan je non-stop i vidi status vaše porudžbine.";

export function OrderStatusChanged({
  order,
  status,
  baseUrl = "https://www.svetpovoljnihcena.rs",
  trackingUrl,
  orderUrl: signedOrderUrl,
}: OrderStatusChangedProps) {
  const copy = STATUS_COPY[status];
  const orderUrl = order.userId
    ? `${baseUrl}/nalog/porudzbine/${encodeURIComponent(order.id)}`
    : signedOrderUrl ?? null;
  const actionUrl = trackingUrl || orderUrl;
  const body =
    status === "u_isporuci" && !trackingUrl
      ? "Kurir je preuzeo paket. Vaša porudžbina je na putu ka vama."
      : copy.body;
  return (
    <EmailLayout preview={`${copy.title} — ${order.id}`} footerNote={CHAT_NOTE}>
      <EmailHeading>{copy.title}</EmailHeading>
      <EmailParagraph>{body}</EmailParagraph>
      <EmailParagraph>
        Broj porudžbine: <strong>{order.id}</strong>
        {order.payment?.paymentReference ? (
          <>
            <br />
            RP referenca: <strong>{order.payment.paymentReference}</strong>
          </>
        ) : null}
      </EmailParagraph>
      {actionUrl ? (
        <EmailButton href={actionUrl}>
          {trackingUrl ? "Prati pošiljku" : "Pregled porudžbine"}
        </EmailButton>
      ) : null}
      {status === "isporuceno" ? (
        <EmailButton href={`${baseUrl}/reklamacije`}>Prijavi reklamaciju</EmailButton>
      ) : null}
    </EmailLayout>
  );
}
