import type { Reclamation } from "@/types";
import {
  EmailButton,
  EmailHeading,
  EmailLayout,
  EmailParagraph,
} from "./_layout";

export type ReclamationAcceptedResolution =
  | "POVRAT_NOVCA"
  | "ZAMENA_ARTIKLA"
  | "ZAMENA_DELA"
  | "POPUST";

const RESOLUTION_COPY: Record<ReclamationAcceptedResolution, { label: string; body: string }> = {
  POVRAT_NOVCA: {
    label: "Povraćaj novca",
    body: "Novac vraćamo na Vaš račun nakon što vraćeni artikal stigne u naš magacin.",
  },
  ZAMENA_ARTIKLA: {
    label: "Zamena artikla",
    body: "Poslaćemo Vam ispravan artikal kao zamenu.",
  },
  ZAMENA_DELA: {
    label: "Zamena dela",
    body: "Poslaćemo Vam zamenski deo.",
  },
  POPUST: {
    label: "Umanjenje cene",
    body: "Iznos umanjenja cene vraćamo na Vaš račun. Artikal ne morate da vraćate.",
  },
};

export interface ReclamationAcceptedProps {
  reclamation: Reclamation;
  resolution: ReclamationAcceptedResolution | null;
  baseUrl?: string;
  guest?: boolean;
}

export function ReclamationAccepted({
  reclamation,
  resolution,
  baseUrl = "https://www.svetpovoljnihcena.rs",
  guest = false,
}: ReclamationAcceptedProps) {
  const copy = resolution ? RESOLUTION_COPY[resolution] : null;
  const url = `${baseUrl}/nalog/reklamacije`;
  return (
    <EmailLayout preview={`Reklamacija je prihvaćena — ${reclamation.id}`}>
      <EmailHeading>Reklamacija je prihvaćena</EmailHeading>
      <EmailParagraph>
        Proverili smo Vašu reklamaciju i prihvatili je.
        {copy ? ` Način rešavanja: ${copy.label}.` : ""}
      </EmailParagraph>
      <EmailParagraph>
        {copy ? copy.body : "Naš tim će Vas kontaktirati u vezi sa daljim koracima."}
      </EmailParagraph>
      <EmailParagraph>
        Broj reklamacije: <strong>{reclamation.id}</strong>
        <br />
        Broj porudžbine: {reclamation.orderId}
        <br />
        SKU artikla: {reclamation.sku}
      </EmailParagraph>
      {guest ? (
        <EmailParagraph>
          Ovo obaveštenje je poslato na adresu korišćenu prilikom kupovine bez
          naloga.
        </EmailParagraph>
      ) : (
        <EmailButton href={url}>Pregled reklamacija</EmailButton>
      )}
    </EmailLayout>
  );
}
