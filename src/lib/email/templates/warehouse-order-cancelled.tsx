import {
  EmailHeading,
  EmailLayout,
  EmailParagraph,
} from "./_layout";

export function WarehouseOrderCancelled({
  orderNumber,
  pickupBatchNumbers,
  removedPickupLines,
  activeShipmentCount,
}: {
  orderNumber: string;
  pickupBatchNumbers: string[];
  removedPickupLines: number;
  activeShipmentCount: number;
}) {
  return (
    <EmailLayout preview={`HITNO: otkazana porudžbina ${orderNumber}`}>
      <EmailHeading>Porudžbina je otkazana</EmailHeading>
      <EmailParagraph>
        Kupac je pre fiskalizacije otkazao porudžbinu <strong>{orderNumber}</strong>.
        Nemojte odvajati, pakovati niti predavati robu kuriru.
      </EmailParagraph>
      {pickupBatchNumbers.length ? (
        <EmailParagraph>
          Nalog za preuzimanje: <strong>{pickupBatchNumbers.join(", ")}</strong>
          <br />
          {removedPickupLines > 0
            ? `${removedPickupLines} reda je automatski uklonjeno iz naloga u nacrtu.`
            : "Nalog je već u obradi; ručno sklonite porudžbinu sa pripreme."}
        </EmailParagraph>
      ) : null}
      {activeShipmentCount > 0 ? (
        <EmailParagraph>
          Postoji {activeShipmentCount} aktivan kurirski nalog/adresnica. Potrebna je
          ručna provera i obustava kod kurira.
        </EmailParagraph>
      ) : null}
    </EmailLayout>
  );
}
