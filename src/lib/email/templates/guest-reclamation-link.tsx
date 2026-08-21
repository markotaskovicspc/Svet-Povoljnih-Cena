import type { Order } from "@/types";
import {
  EmailButton,
  EmailHeading,
  EmailLayout,
  EmailParagraph,
} from "./_layout";

export interface GuestReclamationLinkProps {
  order: Order;
  reclamationUrl: string;
}

export function GuestReclamationLink({
  order,
  reclamationUrl,
}: GuestReclamationLinkProps) {
  return (
    <EmailLayout preview={`Bezbedan link za reklamaciju — ${order.id}`}>
      <EmailHeading>Link za prijavu reklamacije</EmailHeading>
      <EmailParagraph>
        Poštovani/a {order.shippingAddress.firstName}, za porudžbinu{" "}
        <strong>{order.id}</strong> zatražen je novi bezbedan link za prijavu
        reklamacije.
      </EmailParagraph>
      <EmailButton href={reclamationUrl}>Prijavi reklamaciju</EmailButton>
      <EmailParagraph>
        Link omogućava pristup samo artiklima iz ove porudžbine. Ako niste vi
        poslali zahtev, zanemarite ovu poruku.
      </EmailParagraph>
    </EmailLayout>
  );
}
