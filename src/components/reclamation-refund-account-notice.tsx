const NOTICES: Record<string, string> = {
  ZAMENA_DELA:
    "Za zamenu dela upišite koji deo Vam treba i koliko komada u polje „Komentar / opis problema“ ispod.",
};

/** Broj računa i procenat umanjenja imaju posebna polja; ovde ostaje samo uputstvo za zamenu dela. */
export function ReclamationRefundAccountNotice({
  request,
}: {
  request: string;
}) {
  const text = NOTICES[request];
  if (!text) return null;

  return (
    <p
      role="status"
      aria-live="polite"
      className="rounded-lg border border-warning/30 bg-warning/10 p-3 text-sm text-warning"
    >
      {text}
    </p>
  );
}
