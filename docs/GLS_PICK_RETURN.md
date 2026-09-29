# GLS Pick & Return

The shared GLS shipment service sends `ServiceList: [{ Code: "PRS" }]` for
`RECLAMATION_RETURN`. Ordinary order deliveries and replacement deliveries do
not request this service. This applies to the reclamation action and every
caller of the courier registry, including picking workflows.

The pickup address and telephone come from the customer's order address, never
from its parcel shop. COD is zero. The requested date defaults to the next
weekday in the Europe/Belgrade calendar. Each reclamation and physical package
has a distinct stable provider reference.

MyGLS returns a PDF **pickup-request confirmation**, not a shipping barcode label.
The courier brings the label. The UI calls this document a P&R confirmation and
separates request acceptance from physical pickup. Provider acceptance does not
promise a specific arrival hour or prove the package was collected.

## Duplicate prevention and recovery

- Claim the unique reclamation/purpose shipment row before calling GLS. Concurrent
  clicks cannot create multiple requests.
- Do not automatically retry `PrintLabels` or `PrepareLabelsV2` after HTTP 5xx.
- Save accepted provider IDs, parcel numbers and confirmation bytes before
  uploading the PDF to private storage. A failed upload can be recovered from
  the existing request without booking another pickup.
- Timeout, incomplete responses and partial multi-package results remain
  unresolved. Look up the stored reference in MyGLS and reconcile the existing
  request before creating anything else.
- A complete single-parcel validation rejection received on HTTP 200 can be
  corrected and retried. An HTTP failure with a similar body is still ambiguous.
- An older ordinary return label is not proof of a P&R request. The UI warns
  about it. Cancellation checks live pre-pickup status and requires explicit GLS
  acknowledgement before another request can be created.
- For GLS reverse shipments, `RETURNED` does not authorize warehouse receipt:
  the package may have returned to the customer. Require `DELIVERED` and the
  existing operator confirmation of physical receipt.

The shipment's `rawCreateResponse.myGlsReturn` holds request state and the
requested date. Existing audited manual recoveries remain recognizable.
No schema migration is required. All documents stay in private `shipment-labels`
storage and are served through the authenticated admin route.

## Provider references

- [GLS Serbia services](https://gls-group.com/RS/sr/poslovni-korisnici/proizvodi-usluge/)
- [MyGLS API documentation, PRS and service examples](https://api.mygls.hu/docs/mygls_api.pdf)
- [MyGLS portal guide, section 3.5](https://gls-group.com/RS/media/downloads/MyGLS_HR_kratke_upute.pdf)
