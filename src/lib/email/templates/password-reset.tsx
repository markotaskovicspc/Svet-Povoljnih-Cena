import {
  EmailButton,
  EmailHeading,
  EmailLayout,
  EmailParagraph,
} from "./_layout";

export interface PasswordResetProps {
  resetUrl: string;
  expiresInMinutes?: number;
}

export function PasswordReset({
  resetUrl,
  expiresInMinutes = 30,
}: PasswordResetProps) {
  return (
    <EmailLayout preview="Resetovanje lozinke">
      <EmailHeading>Resetovanje lozinke</EmailHeading>
      <EmailParagraph>
        Primili smo zahtev za resetovanje lozinke vašeg naloga. Link ispod važi{" "}
        {expiresInMinutes} minuta.
      </EmailParagraph>
      <EmailButton href={resetUrl}>Postavi novu lozinku</EmailButton>
      <EmailParagraph>
        Ako niste tražili reset, slobodno ignorišite ovaj mejl — vaša lozinka
        ostaje nepromenjena.
      </EmailParagraph>
    </EmailLayout>
  );
}
