import type { Metadata } from "next";
import { ConfirmationView } from "@/components/checkout/confirmation-view";

export const metadata: Metadata = {
  title: "Potvrda porudžbine",
  description: "Vaša porudžbina je primljena. Hvala vam na poverenju.",
  robots: { index: false, follow: false },
};

export default function CheckoutPotvrdaPage() {
  return (
    <div className="mx-auto max-w-[var(--container-content)] px-4 pt-6 pb-24 md:px-6">
      <ConfirmationView />
    </div>
  );
}
