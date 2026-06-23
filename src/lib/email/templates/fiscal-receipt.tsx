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
}

export function FiscalReceiptEmail({
  order,
  receiptNumber,
  qrUrl,
  baseUrl = "https://www.svetpovoljnihcena.rs",
}: FiscalReceiptProps) {
  const orderUrl = order.userId
    ? `${baseUrl}/nalog/porudzbine/${encodeURIComponent(order.id)}`
    : `${baseUrl}/checkout/potvrda?order=${encodeURIComponent(order.id)}`;
  return (
    <EmailLayout preview={`Fiskalni račun ${receiptNumber}`}>
      <EmailHeading>Fiskalni račun je izdat</EmailHeading>
      <EmailParagraph>
        U prilogu se nalazi fiskalni račun broj <strong>{receiptNumber}</strong>{" "}
        za porudžbinu <strong>{order.id}</strong>.
      </EmailParagraph>
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
      <EmailButton href={orderUrl}>Pregled porudžbine</EmailButton>
    </EmailLayout>
  );
}
