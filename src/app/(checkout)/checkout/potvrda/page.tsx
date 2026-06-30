import type { Metadata } from "next";
import { ConfirmationView } from "@/components/checkout/confirmation-view";
import { getPublicOrderForConfirmation } from "@/lib/api/orders";

export const metadata: Metadata = {
  title: "Potvrda porudžbine",
  description: "Vaša porudžbina je primljena. Hvala vam na poverenju.",
  robots: { index: false, follow: false },
};

export default async function CheckoutPotvrdaPage({
  searchParams,
}: {
  searchParams: Promise<{ order?: string; token?: string; status?: string; err?: string }>;
}) {
  const params = await searchParams;
  const initialOrder = params.order
    ? await getPublicOrderForConfirmation(params.order, params.token)
    : null;

  return (
    <div className="mx-auto max-w-[var(--container-content)] px-4 pt-6 pb-24 md:px-6">
      <ConfirmationView
        initialOrder={initialOrder}
        accessToken={params.token}
        paymentStatus={params.status}
        paymentMessage={params.err}
      />
    </div>
  );
}
