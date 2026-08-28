import type { Order } from "@/types";
import { formatRsd } from "@/lib/format";
import {
  EmailButton,
  EmailDivider,
  EmailHeading,
  EmailLayout,
  EmailParagraph,
} from "./_layout";

export interface OrderItemsChangedProps {
  order: Order;
  itemName: string;
  sku: string;
  previousQty: number;
  newQty: number;
  baseUrl?: string;
}

export function OrderItemsChanged({
  order,
  itemName,
  sku,
  previousQty,
  newQty,
  baseUrl = "https://www.svetpovoljnihcena.rs",
}: OrderItemsChangedProps) {
  const orderUrl = order.userId
    ? `${baseUrl}/nalog/porudzbine/${encodeURIComponent(order.id)}`
    : baseUrl;
  const removed = newQty === 0;
  const added = previousQty === 0 && newQty > 0;
  const increased = newQty > previousQty;
  const changeDescription = removed
    ? "Jedan artikal je uklonjen iz vaše porudžbine. Sve ostale stavke ostaju potvrđene."
    : added
      ? "Novi artikal je dodat u vašu porudžbinu. Sve ranije potvrđene stavke ostaju nepromenjene."
      : increased
        ? "Količina jednog artikla u vašoj porudžbini je povećana. Sve ostale stavke ostaju potvrđene."
        : "Količina jednog artikla u vašoj porudžbini je smanjena. Sve ostale stavke ostaju potvrđene.";

  return (
    <EmailLayout preview={`Izmena porudžbine ${order.id}`}>
      <EmailHeading>Porudžbina je izmenjena</EmailHeading>
      <EmailParagraph>{changeDescription}</EmailParagraph>
      <table
        role="presentation"
        cellPadding={0}
        cellSpacing={0}
        width="100%"
        style={{ margin: "18px 0", borderCollapse: "collapse" }}
      >
        <tbody>
          <tr>
            <td style={{ padding: "10px 0", fontSize: 13, color: "#6B6259" }}>
              Artikal
            </td>
            <td style={{ padding: "10px 0", textAlign: "right", fontSize: 13 }}>
              <strong>{itemName}</strong>
              <br />
              <span style={{ color: "#6B6259" }}>SKU {sku}</span>
            </td>
          </tr>
          <tr>
            <td
              style={{
                padding: "10px 0",
                borderTop: "1px solid #E8E0D2",
                fontSize: 13,
                color: "#6B6259",
              }}
            >
              Količina
            </td>
            <td
              style={{
                padding: "10px 0",
                borderTop: "1px solid #E8E0D2",
                textAlign: "right",
                fontSize: 13,
              }}
            >
              {previousQty} → {newQty}
            </td>
          </tr>
        </tbody>
      </table>
      <EmailDivider />
      <EmailParagraph>
        Novi ukupan iznos porudžbine: <strong>{formatRsd(order.total)}</strong>
      </EmailParagraph>
      <EmailParagraph>
        Broj porudžbine: <strong>{order.id}</strong>
      </EmailParagraph>
      {order.userId ? (
        <EmailButton href={orderUrl}>Pregled porudžbine</EmailButton>
      ) : null}
    </EmailLayout>
  );
}
