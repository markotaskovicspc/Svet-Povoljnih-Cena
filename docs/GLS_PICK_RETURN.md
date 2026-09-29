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

## Repeatable acceptance checks

Run the provider and private-storage HTTP mocks against a temporary PostgreSQL
schema (the runner removes it afterwards):

```sh
MYGLS_E2E_SCHEMA_MODE=sql MYGLS_E2E_RUNNER=vitest \
  MYGLS_E2E_SPECS=tests/integration/mygls-return.integration.test.ts \
  node scripts/run-mygls-acceptance.mjs
```

The suite covers multiple parcels, home-address pickup despite a parcel-shop
selection, zero COD, database-level concurrent clicks, explicit rejection and
retry, ambiguous HTTP/partial responses, PDF-upload recovery without rebooking,
live-status cancellation and recreation, invalid prerequisites, idempotent
warehouse receipt, legacy labels, and separate forward replacement delivery.
Unit tests additionally cover Serbian midnight/weekend dates and control digits
in tracking numbers. COD changes for reclamation shipments are blocked in both
the order UI and the shared service.

For interactive local browser checks, use `MYGLS_E2E_RUNNER=browser` with the
same spec. After the tests, the runner starts localhost:3026 and writes synthetic
login/claim fixtures to `output/playwright/gls-prs-fixtures.json`. The local mocks'
`POST /scenario` can simulate provider rejection, ambiguous responses, shipment
progress, and storage failure. Stop with Ctrl+C or create
`output/playwright/gls-prs-stop`; the runner then removes its temporary schema.
Never run these scenarios against a live courier endpoint.

Multi-parcel P&R receipt also requires a dated `DELIVERED` status for every
expected parcel number in the saved GLS snapshot. One parcel's delivery scan
cannot authorize receipt of the whole reclamation quantity. Refresh courier
status to obtain this proof for older multi-parcel shipments.

The reclamation action refreshes its server-rendered state even after an error:
accepted bookings with missing PDFs show document recovery, and ambiguous
bookings show their reference without a new-booking button. The shared courier
registry enforces these checks even when called without the reclamation facade.

## Acceptance record — 2026-09-29

- Unit suite: 1,960 passed, 5 pre-existing skips.
- Integration: 24 relevant scenarios passed across P&R, reclamation fulfillment,
  repeated claims, and ordinary GLS parcel handover. Tests used temporary schemas
  and local courier/storage mocks, with no live courier requests.
- Existing browser suites: ordinary MyGLS booking/printing and reclamation
  replacement picking both passed.
- Interactive browser checks: desktop and 390px mobile; confirmation dismissal,
  PRS creation, private PDF access, rejected-request retry, ambiguous-response
  blocking, storage recovery without rebooking, legacy-label cancellation and
  replacement, cancellation before/after pickup, status refresh, zero-COD UI,
  single/multi-parcel receipt and duplicate-receipt prevention. Anonymous PDF
  access redirected to login.
- During acceptance, fixed tracking control-digit consistency, Serbian midnight
  dates, COD modification on reclamations, shared-registry legacy/unknown reuse,
  stale UI after provider/storage errors, and partial multi-parcel receipt.
  Refreshing a cancelled P&R number is also rejected at the service boundary.
- Final `npm run build`, TypeScript checking, email-PDF asset verification,
  lint on all changed code/tests, and `git diff --check` passed.
