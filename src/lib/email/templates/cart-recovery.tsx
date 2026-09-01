import { formatRsd } from "@/lib/format";
import {
  EmailButton,
  EmailDivider,
  EmailEyebrow,
  EmailHeading,
  EmailLayout,
  EmailParagraph,
} from "./_layout";

export type CartRecoveryEmailItem = {
  name: string;
  sku: string;
  qty: number;
  unitPrice: number;
};

export function CartRecoveryEmail({
  step,
  items,
  cartTotal,
  resumeUrl,
  unsubscribeUrl,
  voucherCode,
  discountPercent,
}: {
  step: number;
  items: CartRecoveryEmailItem[];
  cartTotal: number;
  resumeUrl: string;
  unsubscribeUrl: string;
  voucherCode?: string | null;
  discountPercent?: number;
}) {
  const heading =
    step === 1
      ? "Sačuvali smo vašu korpu"
      : step === 2
        ? "Još uvek možete da nastavite kupovinu"
        : voucherCode
          ? `Evo ${discountPercent}% popusta za vašu korpu`
          : "Poslednji podsetnik za vašu korpu";
  const intro =
    step === 1
      ? "Niste završili porudžbinu. Jednim klikom možete da nastavite tamo gde ste stali."
      : step === 2
        ? "Proizvodi koje ste odabrali i dalje su sačuvani. Proverićemo aktuelnu cenu i dostupnost kada nastavite."
        : "Ako i dalje želite ove proizvode, vratite se u korpu i završite kupovinu.";

  return (
    <EmailLayout
      preview={`${heading} — ${formatRsd(cartTotal)}`}
      footer={
        <>
          Ovu poruku dobijate jer ste zatražili podsetnik za nezavršenu
          kupovinu. Možete se odjaviti jednim klikom.
          <br />
          <a href={unsubscribeUrl} style={{ color: "#123F5A" }}>
            Isključi podsetnike za nezavršenu kupovinu
          </a>
        </>
      }
    >
      <EmailEyebrow>Vaša korpa</EmailEyebrow>
      <EmailHeading>{heading}</EmailHeading>
      <EmailParagraph>{intro}</EmailParagraph>
      <EmailDivider />
      {items.slice(0, 4).map((item) => (
        <EmailParagraph key={item.sku}>
          <strong>{item.name}</strong>
          <br />
          {item.qty} × {formatRsd(item.unitPrice)} · SKU {item.sku}
        </EmailParagraph>
      ))}
      {items.length > 4 ? (
        <EmailParagraph>I još {items.length - 4} proizvoda.</EmailParagraph>
      ) : null}
      <EmailParagraph>
        Trenutna vrednost artikala: <strong>{formatRsd(cartTotal)}</strong>
      </EmailParagraph>
      {voucherCode ? (
        <EmailParagraph>
          Vaš jednokratni kod: <strong>{voucherCode}</strong>. Kod važi 48 sati
          i biće automatski primenjen kada otvorite korpu.
        </EmailParagraph>
      ) : null}
      <EmailButton href={resumeUrl}>Nastavi kupovinu</EmailButton>
      <EmailParagraph>
        Artikli nisu rezervisani. Konačna cena, popust i dostupnost proveravaju
        se pre potvrde porudžbine.
      </EmailParagraph>
    </EmailLayout>
  );
}
