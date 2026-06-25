import {
  EmailButton,
  EmailDivider,
  EmailHeading,
  EmailLayout,
  EmailParagraph,
} from "./_layout";
import { BRAND } from "@/lib/brand";

export interface EmailConfirmationProps {
  confirmUrl: string;
  expiresInHours?: number;
  includeFirstPurchaseOffer?: boolean;
  marketingUnsubscribeUrl?: string;
}

export function EmailConfirmation({
  confirmUrl,
  expiresInHours = 24,
  includeFirstPurchaseOffer = false,
  marketingUnsubscribeUrl,
}: EmailConfirmationProps) {
  return (
    <EmailLayout preview={`Potvrdite e-poštu za ${BRAND.name} nalog`}>
      <EmailHeading>Potvrdite e-poštu</EmailHeading>
      <EmailParagraph>
        Hvala na registraciji. Kliknite na dugme ispod da potvrdite e-poštu za
        svoj {BRAND.name} nalog. Link važi {expiresInHours} sata.
      </EmailParagraph>
      <EmailButton href={confirmUrl}>Potvrdi e-poštu</EmailButton>
      {includeFirstPurchaseOffer ? (
        <>
          <EmailDivider />
          <EmailHeading>5% popusta za prvu kupovinu je aktivan</EmailHeading>
          <EmailParagraph>
            Nije potreban kod. Popust se automatski obračunava na prvu
            porudžbinu dok ste prijavljeni na nalog.
          </EmailParagraph>
          <EmailParagraph>
            Da ne propustite buduće kupone, prebacite ovaj mejl u inbox ako je
            završio u promocijama i označite ga zvezdicom.
          </EmailParagraph>
          {marketingUnsubscribeUrl ? (
            <EmailParagraph>
              Ako ne želite promotivne mejlove, možete se{" "}
              <a href={marketingUnsubscribeUrl} style={{ color: "#6B4423" }}>
                odjaviti jednim klikom
              </a>
              .
            </EmailParagraph>
          ) : null}
        </>
      ) : null}
      <EmailParagraph>
        Ako niste otvorili nalog, slobodno ignorišite ovaj mejl.
      </EmailParagraph>
    </EmailLayout>
  );
}
