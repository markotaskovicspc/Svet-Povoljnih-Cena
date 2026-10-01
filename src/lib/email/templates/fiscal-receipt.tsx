import type { Order } from "@/types";
import {
  EmailButton,
  EmailHeading,
  EmailLayout,
  EmailParagraph,
} from "./_layout";

export interface FiscalReceiptProps {
  order: Order;
  receiptNumber: string;
  qrUrl?: string | null;
  baseUrl?: string;
  buyerInvoiceAttached?: boolean;
}

export function FiscalReceiptEmail({
  order,
  receiptNumber,
  qrUrl,
  baseUrl = "https://www.svetpovoljnihcena.rs",
  buyerInvoiceAttached = false,
}: FiscalReceiptProps) {
  const orderUrl = order.userId
    ? `${baseUrl}/nalog/porudzbine/${encodeURIComponent(order.id)}`
    : null;
  return (
    <EmailLayout preview={`Fiskalni račun ${receiptNumber}`}>
      <EmailHeading>Fiskalni račun je izdat</EmailHeading>
      <EmailParagraph>
        U prilogu se nalazi fiskalni račun broj <strong>{receiptNumber}</strong>{" "}
        za porudžbinu <strong>{order.id}</strong>.
      </EmailParagraph>
      {buyerInvoiceAttached ? (
        <EmailParagraph>
          U prilogu je i prateći račun sa podacima vaše firme. Promet je već
          evidentiran fiskalnim računom; ovaj dodatni dokument nije poseban
          zahtev za uplatu. Plaćanje se obavlja izabranim načinom plaćanja.
        </EmailParagraph>
      ) : null}
      <EmailParagraph>
        Račun je izdat u trenutku preuzimanja robe iz skladišta i predstavlja
        zvaničan dokument za garanciju i reklamaciju.
      </EmailParagraph>
      {qrUrl ? (
        <EmailParagraph>
          Računsku verifikaciju možete pogledati ovde:{" "}
          <a href={qrUrl}>{qrUrl}</a>
        </EmailParagraph>
      ) : null}
      {orderUrl ? <EmailButton href={orderUrl}>Pregled porudžbine</EmailButton> : null}
    </EmailLayout>
  );
}
