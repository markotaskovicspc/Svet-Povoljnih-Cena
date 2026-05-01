import type { Reclamation } from "@/types";
import {
  EmailButton,
  EmailDivider,
  EmailHeading,
  EmailLayout,
  EmailParagraph,
} from "./_layout";

export interface ReclamationReceiptProps {
  reclamation: Reclamation;
  baseUrl?: string;
}

export function ReclamationReceipt({
  reclamation,
  baseUrl = "https://www.svetpovoljnihcena.rs",
}: ReclamationReceiptProps) {
  const url = `${baseUrl}/nalog/reklamacije`;
  return (
    <EmailLayout preview={`Reklamacija ${reclamation.id} je primljena`}>
      <EmailHeading>Reklamacija je primljena</EmailHeading>
      <EmailParagraph>
        Poštovani/a {reclamation.customer.firstName}, primili smo vašu
        reklamaciju pod brojem <strong>{reclamation.id}</strong>. Naš tim je
        pregleda i javiće vam se u zakonskom roku (15 dana).
      </EmailParagraph>
      <EmailDivider />
      <EmailParagraph>
        SKU artikla: {reclamation.sku}
        <br />
        Broj porudžbine: {reclamation.orderId}
        <br />
        Kanal obaveštenja:{" "}
        {reclamation.notifyVia === "email" ? "e-pošta" : "telefon"}
      </EmailParagraph>
      <EmailParagraph>
        Opis problema: <em>{reclamation.description}</em>
      </EmailParagraph>
      <EmailButton href={url}>Pregled mojih reklamacija</EmailButton>
    </EmailLayout>
  );
}
