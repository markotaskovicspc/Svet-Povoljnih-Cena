const NOTICES: Record<string, string> = {
  POVRACAJ_NOVCA:
    "Za povraćaj novca upišite broj računa za uplatu (18 cifara, npr. 160-0000000000000-00) u polje „Komentar / opis problema“ ispod.",
  ODUSTANAK:
    "Za odustanak upišite broj računa za uplatu (18 cifara, npr. 160-0000000000000-00) u polje „Komentar / opis problema“ ispod.",
  UMANJENJE_CENE:
    "Za umanjenje cene upišite broj računa za uplatu i iznos umanjenja koji tražite (u dinarima) u polje „Komentar / opis problema“ ispod.",
  ZAMENA_DELA:
    "Za zamenu dela upišite koji deo Vam treba i koliko komada u polje „Komentar / opis problema“ ispod.",
};

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
