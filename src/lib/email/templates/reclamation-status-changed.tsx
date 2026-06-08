import type { Reclamation, ReclamationStatus } from "@/types";
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
    body: "Reklamacija je rešena. Ako je potrebna dodatna komunikacija, naš tim će vas kontaktirati.",
  },
  odbijeno: {
    title: "Reklamacija je odbijena",
    body: "Reklamacija je odbijena nakon provere. Za dodatna pitanja obratite se korisničkoj podršci.",
  },
};

export interface ReclamationStatusChangedProps {
  reclamation: Reclamation;
  status: ReclamationStatus;
  baseUrl?: string;
}

export function ReclamationStatusChanged({
  reclamation,
  status,
  baseUrl = "https://www.svetpovoljnihcena.rs",
}: ReclamationStatusChangedProps) {
  const copy = STATUS_COPY[status];
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
      <EmailButton href={url}>Pregled reklamacija</EmailButton>
    </EmailLayout>
  );
}
