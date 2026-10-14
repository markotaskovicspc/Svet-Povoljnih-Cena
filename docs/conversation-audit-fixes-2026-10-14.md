# Conversation audit follow-up — October 12–14

- Recognize Meta stickers, including the duplicate image/sticker representation. They no longer erase a quote, request product selection, or count as order consent. An explicit text DA alongside a sticker still follows the existing confirmation flow.
- Process adjacent queued short customer messages within two seconds as one input when there is no pending consent, order, cancellation, or claim. Mark all consumed events atomically. Suppress rapid identical questions after a delivered processing turn; never suppress confirmations.
- Preserve staff provenance in operator replies, recovered history and deduplication. Backfill provenance from existing local events once per conversation without replaying events. Tell the sales agent when a product clarification was supplied by staff, while retaining ERP price/write checks.
- Courier-only price requests omit locality entirely. Truck quotes retain locality verification. Qualified locality lookup supports `kod` and dictionary-verified genitive municipality spellings (Konjevići kod Čačka); no arbitrary same-name settlement selection.
- Retain existing exhausted ordinary-message recovery and durable support notification, and add bounded error classification without raw errors or customer data. Uncertain ERP writes still pause for reconciliation and do not recreate orders.
- Includes main's existing fix preserving a buyer-supplied postal code despite a courier dictionary mismatch. Email/postcode remain optional; payment remains cash on delivery.

No historical commands are replayed, and no existing order, complaint or conversation is modified by this release. Test scenarios use embedded PostgreSQL and fake ERP/model clients, not real customer sends or orders. Unrelated untracked inbox synchronization scripts are excluded.

Validation: targeted order/recovery regressions and full chatbot suite; see task result for counts. Root `npm run build` reaches the existing Windows/POSIX production migration wrapper failure. Direct Next build is also blocked locally by the newly pulled, not yet installed `web-push` dependency and restricted Google Fonts fetch. This release changes only the independently deployed Node chatbot service, not the Next application or database schema.
