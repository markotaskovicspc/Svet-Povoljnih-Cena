# Staff order failure notifications

Confirmed: Railway `OPENAI_MODEL` is `gpt-5.4-mini`; the shared setting supplies the sales chat, staff command and email workers. Staff extraction additionally sets reasoning effort to `medium`. No model or API credential was changed.

Requested behavior: a staff `/porudzbina` command is authority to create the agreed order without another buyer confirmation. Buyer-visible technical failure messages are inappropriate; failures must notify the seller by email with a conversation link.

Implementation:

- Only an order receipt backed by a recorded order goes into the Messenger outbox. Preparation/ERP rejections go into the existing encrypted `spc_chat_support` queue and private `staffOrderAttention` state, not the assistant conversation history.
- Existing `support_handoff` sends to `podrska@svetpovoljnihcena.rs`, including the resolved Business Suite link (when available), authenticated SPC conversation panel link, exact failure reason and recent transcript.
- Preparation errors (incomplete extraction, invalid price/contact citations, failed cart check) receive up to three read-only attempts before notifying the seller. Actual price conflicts or definite business rejections notify immediately.
- Persistent exceptions also notify after three attempts. An uncertain ERP write retains its original signed quote; the email requires checking ERP before manual entry to prevent duplicates.
- Email queue uses one idempotency key per command, survives process restarts and retries delivery on outage. Successful orders keep the normal chat receipt. Human pauses and price/ownership/stock checks remain in place.

Validation: new PostgreSQL integration tests cover preparation rejection, transient extraction recovery, exhausted checks plus mail outage, unknown ERP outcome with unchanged quote, and definite ERP rejection. No real customer messages, support emails or orders were sent during tests.

Limits: no service can guarantee creation through an ERP outage or contradictory/missing data. The command either records an actual order or privately asks staff to finish/reconcile it; it never fabricates success. This does not include pending additional-discount change `ae580475` or the separate apartment/entrance schema work.
