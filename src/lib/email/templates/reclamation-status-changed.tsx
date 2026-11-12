import type { Reclamation, ReclamationStatus } from "@/types";
import type { ReclamationAcceptedResolution } from "./reclamation-accepted";
import {
  EmailButton,
  EmailHeading,
  EmailLayout,
  EmailParagraph,
} from "./_layout";

const STATUS_COPY: Record<ReclamationStatus, { title: string; body: string }> = {
  primljeno: {
    title: "Reklamacija je primljena",
    body: "Vaša reklamacija je evidentirana i čeka obradu.",
  },
  u_obradi: {
    title: "Reklamacija je u obradi",
    body: "Naš tim proverava podatke i priprema odgovor.",
  },
  reseno: {
    title: "Reklamacija je rešena",
    body: "Reklamacija je rešena. Ako je potrebna dodatna komunikacija, naš tim će Vas kontaktirati.",
  },
  odbijeno: {
    title: "Reklamacija je odbijena",
    body: "Reklamacija je odbijena nakon provere. Za dodatna pitanja obratite se korisničkoj podršci.",
  },
};

/** Kad je reklamacija prihvaćena, „rešena“ kaže kako je rešena. */
const RESOLVED_COPY: Record<ReclamationAcceptedResolution, string> = {
  POVRAT_NOVCA: "Reklamacija je rešena povraćajem novca. Novac je uplaćen na Vaš račun.",
  POPUST: "Reklamacija je rešena umanjenjem cene. Iznos umanjenja je uplaćen na Vaš račun.",
  ZAMENA_ARTIKLA: "Reklamacija je rešena zamenom artikla. Zamenski artikal Vam je isporučen.",
  ZAMENA_DELA: "Reklamacija je rešena zamenom dela. Zamenski deo Vam je isporučen.",
};

export interface ReclamationStatusChangedProps {
  reclamation: Reclamation;
  status: ReclamationStatus;
  /** Način rešavanja samo ako je reklamacija prihvaćena. */
  resolution?: ReclamationAcceptedResolution | null;
  baseUrl?: string;
  guest?: boolean;
}

export function ReclamationStatusChanged({
  reclamation,
  status,
  resolution = null,
  baseUrl = "https://www.svetpovoljnihcena.rs",
  guest = false,
}: ReclamationStatusChangedProps) {
  const base = STATUS_COPY[status];
  const copy = status === "reseno" && resolution ? { ...base, body: RESOLVED_COPY[resolution] } : base;
  const url = `${baseUrl}/nalog/reklamacije`;
  return (
    <EmailLayout preview={`${copy.title} — ${reclamation.id}`}>
      <EmailHeading>{copy.title}</EmailHeading>
      <EmailParagraph>{copy.body}</EmailParagraph>
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
