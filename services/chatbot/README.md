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

## Deployment

Deployment targets the user's approved Railway workspace and project `SPC Chat Prodaja`
(`a713af38-0d74-48f4-aa20-c8ae4dc9dd08`). No live customer automation has been activated.
The service can boot with no Meta secret only while no accounts are configured and
the bot is disabled; the Meta webhook returns 503 until the secret is configured.

1. Merge/apply the SPC integration change and deploy the normal SPC app. Set
   `SOCIAL_INTEGRATION_SECRET` there to the same random 32+ character secret as the bot.
   The route `/api/integrations/social` returns 503 until this is configured.
2. In the intended Railway account, create an isolated PostgreSQL database and one
   service. Set the repo root directory to `services/chatbot` for a GitHub source,
   or upload only that directory through the CLI. Use the Dockerfile, start command
   `node src/main.mjs`, and healthcheck `/health`. Disable Serverless/sleep.
   New Railway services no longer accept legacy Config as Code; set these values
   in service settings instead of relying on the included legacy railway.json.
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

### Conversation context
The worker retains up to 120 messages per customer/channel in encrypted state. Existing conversations recover earlier received messages and delivered replies from the local event archive. On initial recovery, a sender-scoped Meta Conversations read imports up to 100 older text messages when the channel permits it; import failure falls back to local history and never replays historical messages as orders. Staff takeover remains in effect until an operator resumes the conversation.

Completed order receipts separate old purchases from the current selection. Contact details are stored separately from ordered items. A separate cart check validates product names, quantities, and literal customer selection evidence before quoting; legacy quotes are checked before confirmation. Short replies refer to the latest question, and the duplicate-order notice applies only immediately after an order receipt.

Regression smoke: node --env-file=.env.local scripts/context-smoke.mjs (synthetic data and mock ERP only).

### Customer cancellation and catalog verification
A customer may request cancellation of an entire order created in the same conversation. Preparation verifies the stored order access token and returns a signed, channel/conversation/order-bound 15-minute request. The worker displays the order and items, then requires a separate natural-language confirmation immediately after that prompt. Negative, partial, conditional and unrelated replies never cancel. The agent has no cancellation-write tool. ERP reuses the existing locked, idempotent cancellation transaction, reservation release, refund review and notification jobs. Fiscalized/ineligible orders and partial cancellations go to support; unknown orders require a protected order link or staff verification. Uncertain writes retry the same request, and operator resume is blocked until cancellation is reconciled.

Search results are refreshed by exact SKU and availability is checked for the requested quantity. A checkout stock/publication rejection is retained for 15 minutes and escalated to support instead of offering the same item as a new alternative. Customer contact details remain available. No production customer orders are created or cancelled by smoke tests.

Additional model regressions: `scripts/cancellation-smoke.mjs` and `scripts/catalog-smoke.mjs` (synthetic conversations, mock ERP).

## Reklamacije kroz chat

Bot razlikuje kvar, fizičko oštećenje, nedostajući/pogrešan artikal, upit o isporuci i otkazivanje. `begin_reclamation` čita stvarne stavke i postojeće reklamacije uz dokaz pristupa. Za porudžbinu sa drugog kanala `verify_reclamation_order` šalje kod isključivo na podudarni mejl porudžbine. Provera važi 10 minuta i najviše 5 pokušaja; rezultujući pristup važi 2 sata, vezan za kanal i razgovor i ne daje pravo otkazivanja/kupovine.

`request_reclamation` pravi potpisan sažetak, bez upisa. Kupac ga potvrđuje prirodnim odgovorom na poslednji sažetak. Izmena, negacija, uslov, prilog ili druga tema nisu potvrda. Upis je idempotentan i re-proveren pod ERP zaključavanjem porudžbine; timeout ponavlja isti potpisani zahtev. Prijava se vidi u ERP dnevniku reklamacija sa stanjem PRIMLJENO, željenim ishodom, fotografijama i relevantnom prepiskom. Nedostajući/pogrešan artikal se opisuje u belešci (bez menjanja postojećih ERP enum vrednosti). Podrška dobija email sa direktnim linkom preko trajnog reda; chat nastavlja da radi.

Fotografije: najviše 5, samo HTTPS Meta CDN bez preusmeravanja, najviše 10 MB pri preuzimanju i 40 MP dekodiranja, normalizacija u JPEG do 1600 px, privatni reclamation-uploads bucket i provera pripadnosti porudžbini/artiklu. Ako upload nije moguć, bot prijavljuje neuspeh i prosleđuje proveru podršci. Nema javnog objavljivanja fotografija.

Ako status nije ISPORUCENO, nema automatskog upisa ili menjanja statusa: opis ide zaposlenom na proveru. Bot ne odobrava zamenu, povraćaj, popust ili kurira. Legacy reclamationInFlight pauze ostaju dok operater ne proveri raniji neizvestan upis.

Provera: npm test; scripts/reclamation-smoke.mjs koristi stvarni model sa izmišljenim porudžbinama i lažnim ERP klijentom, bez produkcijskih upisa. ERP testovi: social-reclamations, social-reclamation-record i social-route.
