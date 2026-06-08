import {
  EmailButton,
  EmailDivider,
  EmailHeading,
  EmailLayout,
  EmailParagraph,
} from "./_layout";

export interface ProductAlertProps {
  kind: "back_in_stock" | "on_sale";
  product: {
    name: string;
    sku: string;
    price?: string | null;
  };
  productUrl: string;
  manageUrl: string;
}

export function ProductAlert({
  kind,
  product,
  productUrl,
  manageUrl,
}: ProductAlertProps) {
  const title =
    kind === "back_in_stock"
      ? "Proizvod je ponovo na stanju"
      : "Proizvod je sada na akciji";
  const body =
    kind === "back_in_stock"
      ? "Proizvod koji pratite je dostupan za kupovinu."
      : "Proizvod koji pratite ima akcijsku cenu.";

  return (
    <EmailLayout
      preview={`${title}: ${product.name}`}
      footerNote="Dobili ste ovu poruku jer ste uključili obaveštenje za proizvod u listi želja."
    >
      <EmailHeading>{title}</EmailHeading>
      <EmailParagraph>{body}</EmailParagraph>
      <EmailDivider />
      <EmailParagraph>
        <strong>{product.name}</strong>
        <br />
        SKU: {product.sku}
        {product.price ? (
          <>
            <br />
            Cena: {product.price}
          </>
        ) : null}
      </EmailParagraph>
      <EmailButton href={productUrl}>Pogledaj proizvod</EmailButton>
      <EmailParagraph>
        <a href={manageUrl} style={{ color: "#6B4423" }}>
          Isključi ovo obaveštenje
        </a>
      </EmailParagraph>
    </EmailLayout>
  );
}
