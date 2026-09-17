import type { Order } from "@/types";
import { formatRsd } from "@/lib/format";
import {
  EmailButton,
  EmailDivider,
  EmailHeading,
  EmailLayout,
  EmailParagraph,
} from "./_layout";

export function PartialDelivery({
  order,
  itemName,
  sku,
  packageValue,
  remainingCod,
  baseUrl = "https://www.svetpovoljnihcena.rs",
}: {
  order: Order;
  itemName: string;
  sku: string;
  packageValue: number;
  remainingCod: number;
  baseUrl?: string;
}) {
  const orderUrl = order.userId
    ? `${baseUrl}/nalog/porudzbine/${encodeURIComponent(order.id)}`
    : baseUrl;
  return (
    <EmailLayout preview={`Parcijalna isporuka porudžbine ${order.id}`}>
      <EmailHeading>Porudžbina će biti isporučena parcijalno</EmailHeading>
      <EmailParagraph>
        Paket sa artiklom <strong>{itemName}</strong> (SKU {sku}) neće biti
        preuzet u ovoj turi. Artikal ostaje rezervisan za vašu porudžbinu i
        biće zakazan za naknadnu isporuku bez ponovne naplate dostave.
      </EmailParagraph>
      <EmailDivider />
      <EmailParagraph>
        Vrednost odloženog paketa: <strong>{formatRsd(packageValue)}</strong>
      </EmailParagraph>
      <EmailParagraph>
        Otkupnina trenutne pošiljke: <strong>{formatRsd(remainingCod)}</strong>
      </EmailParagraph>
      <EmailParagraph>
        Broj porudžbine: <strong>{order.id}</strong>
      </EmailParagraph>
      {order.userId ? <EmailButton href={orderUrl}>Pregled porudžbine</EmailButton> : null}
    </EmailLayout>
  );
}
