# Support email drafts

This worker uses IMAP TLS on mail.svetpovoljnihcena.rs:993 for podrska@svetpovoljnihcena.rs. It never opens an SMTP transport. Drafts use the mailbox's existing special-use Drafts folder and the IMAP Draft flag. No existing draft is overwritten or removed, and source mail is read without setting Seen.

Set EMAIL_DRAFTS_ENABLED=true and enter EMAIL_IMAP_PASSWORD directly in Railway Variables. Existing DATABASE_URL, CHAT_DATA_KEY, OPENAI_API_KEY, SPC_BASE_URL and SOCIAL_INTEGRATION_SECRET are reused. Never put the mailbox password in chat or source control. Missing password leaves email in waiting_for_password; Messenger remains available. Disable with EMAIL_DRAFTS_ENABLED=false.

Deploy the ERP /api/integrations/email-drafts route first. It returns only the latest five orders matching the sender email, with items/status/tracking/case status and no address, phone, private order access token, or mutation capabilities. Incoming From is context for a human, not authentication for automated order changes. Only a person sends the prepared response.

On first successful connection, the cursor starts after existing INBOX messages. New arrivals are handled using IMAP IDLE notifications and a 30-second reconnect/recovery timer (no scheduled job). Reference-linked INBOX/Sent messages are included, limited to the same correspondent. Each new incoming message gets its own draft; it does not update an employee's existing draft. Replies already present in Sent are skipped. Original quoted content is retained; attachment content is not analyzed.

List/auto/spam headers and own replies are skipped. Messages over 10 MB and repeated failures require manual review. An encrypted PostgreSQL ledger prevents normal duplicate processing. An ambiguous APPEND is reconciled by deterministic Message-ID in Drafts/Sent; if missing it is marked review instead of appending again. UIDVALIDITY change blocks ingest for manual reconciliation rather than replaying the inbox. Payloads of completed/skipped rows are cleared after seven days; original messages remain in IMAP.

Authenticated GET /admin/email-drafts reports connection status and aggregate drafted/skipped/review counts without message content. Inspect review reasons, especially append_outcome_uncertain, processing_failed and message_too_large, in the ledger. Do not reset these blindly: check the mailbox first. IMAP errors and startup failures never stop the Meta worker.

Tests: node --test test/email-drafts.test.mjs. Synthetic model test: node --env-file=.env.local scripts/email-draft-smoke.mjs (no mailbox writes or sends).

## Confirmed ERP operations

Deploy `/api/integrations/email-actions` before enabling `EMAIL_ACTIONS_ENABLED=true` on the worker. All email answers remain drafts for employees to send. No SMTP transport is used. This flag allows purchase, cancellation, and delivered-order reclamation operations only after the employee sends the server-generated summary and the customer replies affirmatively to that exact sent email.

The worker checks the actual Sent folder, recipient, direct In-Reply-To, original request parent, and unchanged summary. Outlook may replace the draft Message-ID: the actual Sent Message-ID is used. Editing the summary or adding text outside the standard signature fails closed; generate a new summary instead. Sent copies must be saved in the mailbox's shared Sent folder. A draft, From address, quoted confirmation, or unrelated "yes" cannot authorize a write. Existing conversations need a new generated confirmation summary; old generic confirmations are not replayed.

The encrypted operation ledger persists confirmation before the ERP call. A timeout retries the same token; purchase checkout-session and claim identifiers are deterministic. Completed operations return the existing receipt. Price/availability and cancellation eligibility are checked again by ERP. A changed request invalidates the old offer. Offers expire after 24 hours; completed writes remain recoverable. Payment refunds and carrier interception require staff review; reclamations require recorded delivery and create a ticket, not an approved remedy. Attachments stay in the original mailbox for staff review.

Disable actions separately with `EMAIL_ACTIONS_ENABLED=false`; drafts and Messenger continue. An uncertain in-flight operation must be reconciled before re-enabling. Tests: `node --test test/email-actions.test.mjs` plus ERP `tests/unit/email-actions.test.ts`.
