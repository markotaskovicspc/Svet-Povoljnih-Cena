# SPC Facebook / Instagram chatbot

Node.js 22 service + protected integration route in the existing SPC Next.js app.
The worker uses the OpenAI Agents SDK because the application owns message ordering,
customer confirmation and business-side effects. No hosted shell/sandbox is exposed.

## Implemented

- Signed Meta webhook with immediate durable PostgreSQL receipt and deduplication.
- PostgreSQL LISTEN/NOTIFY wakes a continuously running worker. A 2-second recovery
  timer catches lost notifications and transient failures; conversation replies do
  not depend on cron. Persistent advisory locks serialize each conversation.
- Facebook and Instagram adapters. Configure only the exact business account IDs.
- Serbian AI sales/support, live SPC product search, collection of delivery data.
- Signed 15-minute quotes produced by SPC's actual checkout calculation.
- Exact customer confirmation code, replay-safe checkoutSessionId, server price check.
- Order status and text complaints for orders created in the same conversation.
- Complaint confirmation and quarantine after uncertain writes (no unsafe retries).
- Encrypted conversation state, order access tokens and webhook bodies at rest.
- Operator inbox at `/`, pause/resume and manual reply, automatic pause for human echoes.
- Images/attachments and outside-conversation orders hand off to staff. No refund tool.
- Send-window checks and quarantine for uncertain sends. No automated HUMAN_AGENT tags.

## Deliberate first-release boundaries

Chat checkout currently requires the guest email used by SPC. Payment methods are
cash on delivery and bank transfer; it does not collect payment card information.
No loyalty is automatically granted through chat. Existing membership can be used
through the website flow. Image identification and uploading complaint images into
SPC require staff; the inbox displays attachment links received from Meta.

Facebook/Instagram source is recorded in the SPC order notes with the conversation
ID. Existing `SalesChannel` remains WEB to preserve ERP behavior. A dedicated ERP
social-source filter is a subsequent schema/UI change, not included here.

For security, status/complaint access is limited to orders whose access token was
created and retained in this conversation. The bot cannot retrieve arbitrary orders
using only a guessed order number, telephone or email. Staff handle those cases.

## Local checks

```
cd services/chatbot
npm ci
npm test
npm run smoke
node --env-file-if-exists=.env.local scripts/agent-smoke.mjs
```

The smoke checks call OpenAI; agent-smoke uses synthetic catalog/order data and
cannot create a real order. Tests use embedded PostgreSQL and stub external APIs.
Cross-process advisory locking, real Meta delivery, production DB transactions and
container deployment must also be checked in staging before public activation.

## Deploy later to the user's OTHER Railway account

The current Railway account was explicitly excluded. No deployment was requested
for this stage. No live customer automation has been activated.

1. Merge/apply the SPC integration change and deploy the normal SPC app. Set
   `SOCIAL_INTEGRATION_SECRET` there to the same random 32+ character secret as the bot.
   The route `/api/integrations/social` returns 503 until this is configured.
2. In the intended Railway account, create an isolated PostgreSQL database and one
   service. Set the repo root directory to `services/chatbot`. The Dockerfile and
   railway.json build/start the continuously running service. Disable Serverless/sleep.
3. Set variables listed in `ENVIRONMENT.example`. `CHAT_DATA_KEY` must be 32 random
   bytes encoded as 64 hex characters. Keep it stable and back it up with DB backups;
   losing it loses the ability to decrypt conversations. `CHAT_ADMIN_TOKEN` is the
   operator console credential. Do not put either into URLs or frontend source.
4. Set `META_ACCOUNTS_JSON` to a JSON array. For example, with actual private tokens:
   `[{"channel":"facebook","id":"PAGE_ID","login":"facebook","token":"PAGE_TOKEN"},
   {"channel":"instagram","id":"IG_ID","login":"instagram","token":"IG_TOKEN"}]`.
   For Instagram with Facebook Login use `"login":"facebook"` and its Page token.
5. Use the API version supported by the Meta app; `v25.0` is an example until checked
   in that app. Generate the public HTTPS domain and check `/health`.
6. Set Meta callback URL to `https://SERVICE_DOMAIN/webhooks/meta` and the matching
   `META_VERIFY_TOKEN`. Subscribe the business accounts to message events and echoes
   where available. Recipient/account IDs must match configuration.
7. Keep `BOT_ENABLED=false`. Set a consenting tester's scoped sender ID in
   `TEST_SENDER_IDS` and test both channels through their real inboxes. Check echo
   behavior and operator takeover, especially for Instagram, which may omit metadata.
8. Complete Meta business ownership, required access review and privacy/deletion
   details. Do not enable public traffic until approved for the chosen access model.
9. With client approval and successful staging purchase/reclamation/cancellation
   tests, set `BOT_ENABLED=true`. Check key expiry: the initially supplied OpenAI
   key was described as expiring on 2026-09-24 and must be replaced after that date.

## Operations

Operator console uses an authorization header; no credentials are stored in the
browser after reload. All operators with the token can read conversations; integrate
with SPC's employee authentication before broad staff rollout. For lost/uncertain
Meta sends, inspect the platform inbox rather than blindly replaying the outbox.
For uncertain complaints, reconcile against SPC before clearing the in-flight flag.

Database backups and a retention/deletion policy must be configured for customer data.
No destructive retention timer is enabled by default. Logs intentionally omit raw
messages, customer addresses, upstream error bodies and credentials. Rotate and revoke
expired credentials in their providers and replace service variables.

The application acknowledges webhooks only after database commit. During DB outage it
returns an error so Meta can retry. For rollout, include a monitoring alert on failed
events, paused conversations, service health and expired provider credentials.

## Meta app setup status

The original app `955130280916178` offers Facebook Login only; its add-use-case dialog
did not offer Messenger or Instagram. User authorized a new app named `SPC Chat Prodaja`.
Final app ID, account subscriptions and callback verification must be recorded after
the Meta setup succeeds. These are not implied by a passing local test.
