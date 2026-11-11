export function ReclamationRefundAccountNotice({
  request,
}: {
  request: string;
}) {
  if (request !== "POVRACAJ_NOVCA" && request !== "UMANJENJE_CENE") {
    return null;
  }

  return (
    <p
      role="status"
      aria-live="polite"
      className="rounded-lg border border-warning/30 bg-warning/10 p-3 text-sm text-warning"
    >
      Za povraćaj novca ili umanjenje cene navedite broj računa za uplatu u
      polju „Komentar / opis problema“ ispod.
    </p>
  );
}
