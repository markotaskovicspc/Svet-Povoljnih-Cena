# Delivery pricing before checkout

Facebook/Instagram inbox and comment agents use `get_delivery_quote` for the current cart, quantities and Serbian destination town. It requires no name, street, phone, email or purchase confirmation. Unknown quantities ask for clarification; a city not supplied by the customer/history is rejected locally. Courier is the default; truck requires an explicit request and ERP eligibility.

The signed social integration action `delivery_quote` validates published SKUs and bounded quantities, checks any existing channel-bound loyalty proof, then calls the same `resolveDeliveryQuote` used by order checkout. The model cannot set membership or a delivery fee. Duplicate SKU lines are combined. It returns the whole cart's shipping charge in RSD, pricing basis, method, destination and timestamp. It creates no order, quote token, reservation or membership. An unavailable price is not evidence that delivery itself is impossible. Zero is a valid free-delivery result for that exact cart. Later cart/membership changes require a fresh calculation; final order preparation checks the amount again.

Email draft behavior is unchanged. Automated shipping totals do not include assembly or the merchandise total; those remain in the final order quote.

Checks: `node --test test/delivery-quote.test.mjs`; synthetic real-model checks: `node --env-file=.env.local scripts/delivery-quote-smoke.mjs`. The smoke script mocks ERP and never sends customer messages or writes orders. ERP tests are in `tests/unit/social-delivery.test.ts` and `social-route.test.ts`.

## Loose locality resolution (13.11.2026)

When the exact matchers find no courier town, `src/locality.mjs` tries once more before asking the buyer: it removes leading words such as „opština“/„selo“, reads Serbian genitive after „kod“ (Velike Plane → Velika Plana, Trstenika → Trstenik), suffixes („Petrovac na Mlavi“, „Rača Kragujevačka“), plural „Rudnici“, and uses the buyer's postcode, the postcode prefix or the municipality of another named place to choose between same-named records. „Beograd, X“ is limited to Belgrade municipalities; Belgrade neighbourhoods without their own record (Krnjača, Kotež, Cerak, Železnik, Jajinci, Mirijevo, MML…) map to the borough record. An unknown neighbourhood of a known town („Zabela, Požarevac“) uses the town when the postcode confirms it. A city split into boroughs (Niš) is never guessed: its boroughs are offered as candidates. Only unique real records are returned. Test: `node --test test/locality.test.mjs` (27 addresses the chatbot rejected 14.10.–13.11.2026).

## Order preparation without needless handoffs (13.11.2026)

- House number: „13 stan 1“ → 13/1, „28 ulaz 2“ → 28, „b.b.“ → bb before the ERP call; a number the ERP would still reject (e.g. „c/2“) returns HOUSE_NUMBER_INVALID so the seller asks only for the house number. An ERP 400 on quote returns INVALID_INPUT instead of throwing SPC_HTTP_400.
- Image choice: the seller naming only the model („BON APPETIT“) counts as naming the catalog product, and any later customer text that does not reject it keeps the choice after a new image; checkCart still verifies the whole deal.
- Cart check: one retry (20 s each) before CART_CHECK_UNAVAILABLE; quotes match ignoring case, diacritics and punctuation; „još jedan / isto kao u SPC-…“ followed by the seller naming the item is a valid choice.
Test: `node --test test/order-prepare-fixes.test.mjs`.

## Handoff guard (14.11.2026)

`src/handoff-guard.mjs` refuses a handoff whose reason is a topic the seller answers alone (Marko, 13.11.2026): article not in offer, procurement, new stock or similar model; courier service and shipping options; warranty; personal pickup; colour variant; the store's phone number; price from an old ad. The tool returns the answer rule instead, and the model replies itself. Order context (delay, payment, damage, reclamation), unidentified products from pictures and an explicit request for a person are always forwarded. On the 454 real handoffs from 14.10.–13.11.2026 it refuses 118 and none of the status, technical, reclamation, change, payment or comment handoffs. Test: `node --test test/handoff-guard.test.mjs`.

## Reclamations without staff (14.11.2026)

- `order_status` sends the chat identity; when the ERP finds the order by first and last name plus phone or address, it returns a chat-bound `reclamation_owner` proof (2 h, the same proof as the e-mail code). The chatbot stores it in `state.claimOrders` and never shows it to the model, so `begin_reclamation` works for orders from other channels without an e-mail code. A bare order or parcel number never yields a proof.
- A new claim no longer e-mails podrska@ („Nova reklamacija R-…“): it is in ERP and auto-accepted there. A supplement to an existing claim still does.
- `product_details` returns `manuals` (manual and assembly/maintenance attachments); for assembly and usage questions the seller sends that link and hands off only when there is none.
