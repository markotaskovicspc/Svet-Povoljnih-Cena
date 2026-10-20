# NTH Viber integration

Contract: https://developers.nth.ch/ (Omni-channel API; OpenAPI 2.8.0.1-SNAPSHOT).

## Verified 2026-10-14

- Omni Manager login and Viber service `Svet povoljnih cena` work.
- Dedicated Lightsail instance: `spc-nth-messaging`, Frankfurt, static IPv4 `63.179.161.153`.
- `GET /v1/common/ping` succeeds from that instance. The same credentials return HTTP 401 from the Mac; the IP restriction is effective.
- One authorized promotional test to Stefan's supplied number was accepted and the status API confirmed `DELIVERED`. Message ID: `38cd0a66-fe58-49e9-9178-dc60b24215aa`.
- API credentials and worker token are server-side secrets. No SMS fallback is configured. SMS sender registration is independent of Viber.

## Delivery architecture

Vercel queues `NTH_VIBER_OUTBOUND` rows in the existing `BackgroundJob` table.
Dedicated `VIBER_*` statuses exclude them from the ordinary background worker.
The Lightsail Python worker calls `POST /api/viber/worker` over HTTPS using a
dedicated token, submits Viber-only payloads from the whitelisted IPv4, and
acknowledges the result. It has no direct database credentials and exposes no
listening HTTP port. No database migration is needed.

The worker records its submission intent **before** the NTH write in
`/var/lib/spc-nth/messages.sqlite`. Reclaimed leases replay the saved outcome.
An interrupted or ambiguous submission is marked `VIBER_UNKNOWN` and must be
reconciled in NTH Reporting before a manual resend. Never remove the journal
or run additional workers against a different journal. `requestId` is correlation;
the integration does not assume NTH guarantees deduplication.

`VIBER_SENT` means accepted by NTH, not confirmed delivered. The worker polls delivery status and records
`VIBER_DELIVERED` and `VIBER_SEEN` without resending the message. It checks
accepted/delivered jobs from the last seven days; status never moves backward.
Delivery is also available in NTH Reporting and `GET /v1/omni-channel/message/{messageId}/status`. The legacy
bot webhook is not used for NTH, and NTH callback authentication is not assumed.

## Configuration and activation

Application environment:

```dotenv
VIBER_PROVIDER=nth
NTH_DELIVERY_MODE=worker
VIBER_SENDER_NAME="Svet povoljnih cena"
VIBER_PRODUCTION_ACCEPTED=true
NTH_WORKER_TOKEN=<dedicated secret, at least 32 characters>
VIBER_ORDER_NOTIFICATIONS_ENABLED=false
VIBER_SCHEDULED_CAMPAIGNS_ENABLED=false
```

Worker configuration is in `/etc/spc-nth/worker.env` (root:spc-nth, mode 0640),
with `NTH_API_USERNAME`, `NTH_API_PASSWORD`, `NTH_API_BASE_URL`,
`NTH_WORKER_TOKEN`, and `NTH_WORKER_APP_URL`. The service runs as the unprivileged
`spc-nth` account. Install sources are `scripts/nth-worker.py` and
`scripts/nth-worker.service`. Inspect with `systemctl status spc-nth-worker` and
`journalctl -u spc-nth-worker`; logs omit phone numbers and message contents.

Manual promotional campaigns are sent from `/admin/viber` and resolve only
recipients with Viber marketing consent. Campaigns claim their state atomically;
already started campaigns cannot be sent again. Audit existing scheduled
campaigns before setting `VIBER_SCHEDULED_CAMPAIGNS_ENABLED=true`.

Transaktionski šabloni su prijavljeni u Omni Manageru i bili su `Pending` na dan
prijave. Aktivirati ih **tek kada status bude Approved**:

| Purpose | External ID | Language | Parameters |
| --- | --- | --- | --- |
| SPC Potvrda porudzbine | `a8e4c54d-13ac-42d8-a1d8-1fee84248d7c` | `sr` | `order_number` |
| SPC Status porudzbine | `917406ad-f19c-492f-8b74-af316b1ac17f` | `sr` | `order_number`, `status` |

After approval, set `NTH_ORDER_CONFIRMATION_TEMPLATE_ID` and
`NTH_ORDER_STATUS_TEMPLATE_ID`, then `VIBER_ORDER_NOTIFICATIONS_ENABLED=true`
and redeploy. Confirmation is queued after checkout commits; status notifications
are connected to the existing order-status background flow and MyGLS/X Express
sync/webhook flows, including orders without a buyer email. Order messages contain
only the approved transactional template; marketing messages use separate consent.

## Verification and rollback

Run the Viber unit tests and `npm run build`. Build production source with
`tsconfig.build.json`; the broad `tsconfig.json` also includes existing test errors.

To pause outgoing work, set `VIBER_PRODUCTION_ACCEPTED=false` and redeploy, and
stop `spc-nth-worker` on Lightsail. Preserve the SQLite journal. Roll back the app
to the prior deployment if needed. Do not reset `VIBER_UNKNOWN` to queued without
checking the NTH report.

This integration does not change supplier stock or storefront availability.
Keep `ENFORCE_WEB_AUTO_AVAILABILITY=false` until DC stock has been imported and
audited, as required by the project instructions.

## Admin experience (2026-10-14)

`/admin/viber` has Campaigns, Automatic messages, and Results sections. Campaign
creation follows Audience → Message → Review and send, using plain fields and
a phone preview. Operators verify the consenting audience count, save a draft,
optionally send a test to their own number, then explicitly confirm launch.
Images are uploaded to the existing public `product-media` bucket. No customer
files or private receipt buckets are exposed. Dates use Europe/Belgrade.

Results show localized queued, accepted, delivered, seen, failed, and uncertain
statuses, masked phone numbers, and a 30-day summary. Automatic order messages
and scheduled campaigns show their actual disabled configuration. Template
approval remains in Omni Manager because the documented NTH API has no template
management endpoint. The panel does not pretend approval or delivery.

The browser flow was verified on desktop and 390px mobile with an explicitly
marked isolated fixture and no real sends. The fixture is excluded from release.
Viber-related unit checks: 24 passing tests; scoped ESLint and production
typecheck passed.

## All stored phone numbers (2026-10-14)

Stefan explicitly confirmed in this chat that all existing phone contacts have
Viber promotional consent. The explicit all-phone audience covers users,
Customer records, and shipping phones from orders, including guest orders.
Its declaration cutoff is 2026-10-14T20:38:02Z; later contacts are not silently
covered. Saved all-phone audiences retain the source and date in their filter.
No individual account consent flags are fabricated or overwritten.

Numbers are normalized to Serbia format and deduplicated across sources.
Recorded Viber=false preferences and deleted accounts suppress matching numbers
from every source, including at worker claim time. Guest recipients use stable
hashed identifiers, with campaign-basis and phone matching checked before claim.
No campaign was launched to validate this change.

NTH service 38413 is currently named `Svet povoljnih cena`. Its Services screen
exposes Templates only, with no rename control. The requested capitalization
`Svet Povoljnih Cena` requires NTH to rename the registered service; do not change
the routing sender string or pretend the phone preview proves a provider rename.

## Recovery and verification — 2026-10-20

The October 14 integration had been deployed directly to Vercel without its
commits reaching GitHub. Subsequent Git-triggered deployments therefore restored
the legacy bot adapter and `/api/viber/worker` returned 404. Recovered the existing
integration and UI from the saved implementation history, preserving the current
checkout, return, picking, and courier changes. No schema migration is required.

Recovered sources passed 29 Viber/checkout tests and ESLint; the final expanded
run passed 39 Viber/checkout/picking tests and `npm run build`. A separate
in-memory worker-journal check verified duplicate and interrupted submissions do
not issue another provider write. These checks do not prove live delivery.

NTH email dated October 19 confirms SMS sender `SvetPovCena`. Omni Manager synchronization on October 20 refreshed both transactional templates
to Approved. Automatic order messages and scheduled campaigns remain disabled.

One live Viber test to the operator-provided number ending 5045 was submitted
through the production admin at 18:32 Europe/Belgrade and subsequently confirmed
as VIBER_DELIVERED. This exercised the admin action, outbox, existing AWS worker,
NTH API, and delivery report. The draft was not launched as a customer campaign.
One separate SMS test was sent from the existing whitelisted `spc-nth-messaging`
server using the NTH API and registered sender `SvetPovCena`. NTH confirmed
DELIVERED at 2026-10-20T16:43:12.607Z (one SMS part). An exclusive-create
persistent test journal prevented duplicate submission; the follow-up check
used GET only. This validates SMS provider delivery, not an SMS campaign UI.
Exactly one Viber and one SMS test were sent to the operator-provided number.
No customer campaign or automatic order notification was enabled.

Desktop and 390px mobile UI were checked using an isolated fixture without real
sends. The fixture was removed. The expired-purpose Ananas inspection endpoint
and its helper/tests were also removed; its completed field-schema findings
remain documented in docs/returns-2026-10-20.md.
