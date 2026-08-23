"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, XCircle } from "lucide-react";
import { canCustomerCancelStatus } from "@/lib/orders/cancellation";

export function CancelOrderButton({
  orderNumber,
  status,
  accessToken,
}: {
  orderNumber: string;
  status: string;
  accessToken?: string;
}) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [cancelled, setCancelled] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  if (!canCustomerCancelStatus(status) && !cancelled) return null;

  const cancel = async () => {
    if (
      !window.confirm(
        `Da li sigurno želite da otkažete celu porudžbinu ${orderNumber}?`,
      )
    ) {
      return;
    }
    setSubmitting(true);
    setMessage(null);
    try {
      const response = await fetch(
        `/api/orders/${encodeURIComponent(orderNumber)}/cancel`,
        {
          method: "POST",
          headers: accessToken
            ? { "x-order-access-token": accessToken }
            : undefined,
        },
      );
      const result = (await response.json().catch(() => null)) as
        | { ok: true; data: { paymentReviewRequired?: boolean } }
        | { ok: false; message?: string }
        | null;
      if (!response.ok || !result?.ok) {
        throw new Error(
          result && "message" in result && result.message
            ? result.message
            : "Otkazivanje trenutno nije uspelo.",
        );
      }
      setCancelled(true);
      setMessage(
        result.data.paymentReviewRequired
          ? "Porudžbina je otkazana. Povraćaj elektronske uplate je prosleđen na obaveznu proveru."
          : "Porudžbina je otkazana. Potvrda je poslata na e-poštu.",
      );
      router.refresh();
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Otkazivanje trenutno nije uspelo.",
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="rounded-xl border border-action/25 bg-action/5 p-4">
      {cancelled ? (
        <p role="status" className="text-sm text-ink-700">
          {message}
        </p>
      ) : (
        <>
          <p className="text-sm text-ink-700">
            Porudžbinu možete otkazati ovde dok nije fiskalizovana.
          </p>
          <button
            type="button"
            disabled={submitting}
            onClick={cancel}
            className="mt-3 inline-flex items-center gap-2 rounded-full border border-action/35 px-4 py-2 text-sm font-medium text-action transition hover:bg-action/10 disabled:opacity-60"
          >
            {submitting ? (
              <Loader2 className="size-4 animate-spin" aria-hidden />
            ) : (
              <XCircle className="size-4" aria-hidden />
            )}
            Otkaži porudžbinu
          </button>
        </>
      )}
      {!cancelled && message ? (
        <p role="alert" className="mt-3 text-sm text-action">
          {message}
        </p>
      ) : null}
    </div>
  );
}
