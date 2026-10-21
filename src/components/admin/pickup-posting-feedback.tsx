export function PickupPostingFeedback({
  reasonId,
  blockReason,
  previousIssue,
  showReady,
  myGls,
}: {
  reasonId: string;
  blockReason: string | null;
  previousIssue: string | null;
  showReady: boolean;
  myGls: boolean;
}) {
  if (blockReason || previousIssue) {
    return (
      <div id={reasonId} className="mt-4 space-y-3 rounded-lg border border-warning/25 bg-warning/10 px-3 py-2 text-sm text-warning">
        {blockReason ? (
          <p><strong>„Kreiraj adresnice i pošalji“ je trenutno zaključan:</strong> {blockReason}</p>
        ) : null}
        {previousIssue ? (
          <div>
            <p><strong>Prethodni pokušaj nije uspeo:</strong> {previousIssue}</p>
            <p className="mt-1">
              {blockReason
                ? "Otklonite navedeni razlog zaključavanja pa ponovite slanje."
                : "Dugme „Kreiraj adresnice i pošalji“ je dostupno za bezbedno ponovno slanje."}
              {" "}Već uspešno kreirane pošiljke neće biti duplirane.
            </p>
            <p className="mt-1">
              Ako poruka navodi adresu ili telefon, kliknite broj porudžbine
              u picking listi, ispravite podatke u odeljku „Adresa isporuke“,
              vratite se ovde i ponovite slanje.
            </p>
          </div>
        ) : null}
      </div>
    );
  }
  if (!showReady) return null;
  return (
    <p className="mt-4 rounded-lg border border-success/25 bg-success/10 px-3 py-2 text-sm text-success">
      {myGls ? "MyGLS" : "X Express"} je spreman. Jedan klik kreira
      adresnice i odmah šalje sve pošiljke kuriru.
      {myGls
        ? " Pre prvog MyGLS zahteva sistem proverava ceo nalog, tako da neispravna porudžbina ne ostavlja delimično kreirane adresnice."
        : null}
    </p>
  );
}
