import { EmailHeading, EmailLayout, EmailParagraph } from "./_layout";

export interface OtpEmailProps {
  code: string;
  expiresInMinutes?: number;
}

export function OtpEmail({ code, expiresInMinutes = 10 }: OtpEmailProps) {
  return (
    <EmailLayout preview={`Vaš jednokratni kod: ${code}`}>
      <EmailHeading>Vaš jednokratni kod</EmailHeading>
      <EmailParagraph>
        Unesite ovaj kod kako biste završili prijavu. Kod važi{" "}
        {expiresInMinutes} minuta.
      </EmailParagraph>
      <p
        style={{
          fontFamily: "JetBrains Mono, Menlo, monospace",
          fontSize: 32,
          letterSpacing: "0.4em",
          color: "#1A1714",
          margin: "16px 0",
          padding: "16px 0",
          backgroundColor: "#FAF7F2",
          borderRadius: 12,
          textAlign: "center",
        }}
      >
        {code}
      </p>
      <EmailParagraph>
        Ako kod niste tražili, ignorišite ovu poruku. Iz bezbednosnih razloga
        nikada nemojte deliti kod sa drugima.
      </EmailParagraph>
    </EmailLayout>
  );
}
