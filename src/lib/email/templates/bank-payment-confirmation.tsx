import { EmailButton, EmailDivider, EmailEyebrow, EmailHeading, EmailLayout, EmailNotice, EmailParagraph } from "./_layout";

export interface BankPaymentConfirmationProps {
  orderNumber: string;
  amountMinor: number;
  currency: string;
  firstName?: string;
  orderUrl: string | null;
}

export function BankPaymentConfirmation({ orderNumber, amountMinor, currency, firstName, orderUrl }: BankPaymentConfirmationProps) {
  const amount = new Intl.NumberFormat("sr-Latn-RS", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amountMinor / 100)
    + (currency === "RSD" ? " din" : ` ${currency}`);
  return <EmailLayout preview={`Uplata od ${amount} za porudžbinu ${orderNumber} je evidentirana`}>
    <EmailEyebrow>Potvrda uplate</EmailEyebrow>
    <EmailHeading>Uplata je evidentirana</EmailHeading>
    <EmailParagraph>
      {firstName ? `Poštovani/a ${firstName},` : "Poštovani,"} vaša uplata za porudžbinu <strong>{orderNumber}</strong> uspešno je evidentirana.
    </EmailParagraph>
    <EmailNotice>
      <span style={{ display: "block", fontSize: 11, color: "#5F6F78", marginBottom: 6 }}>EVIDENTIRANI IZNOS</span>
      <strong style={{ display: "block", fontSize: 26, lineHeight: 1.3 }}>{amount}</strong>
      <span style={{ display: "block", marginTop: 8 }}>Način plaćanja: uplata na račun</span>
    </EmailNotice>
    {orderUrl ? <>
      <EmailDivider />
      <EmailButton href={orderUrl}>Pogledaj porudžbinu</EmailButton>
    </> : null}
    <EmailDivider />
    <EmailParagraph>Hvala vam na kupovini i poverenju!</EmailParagraph>
  </EmailLayout>;
}
