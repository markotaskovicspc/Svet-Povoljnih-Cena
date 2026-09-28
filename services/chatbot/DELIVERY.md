# Delivery pricing before checkout

Facebook/Instagram inbox and comment agents use `get_delivery_quote` for the current cart, quantities and Serbian destination town. It requires no name, street, phone, email or purchase confirmation. Unknown quantities ask for clarification; a city not supplied by the customer/history is rejected locally. Courier is the default; truck requires an explicit request and ERP eligibility.

The signed social integration action `delivery_quote` validates published SKUs and bounded quantities, checks any existing channel-bound loyalty proof, then calls the same `resolveDeliveryQuote` used by order checkout. The model cannot set membership or a delivery fee. Duplicate SKU lines are combined. It returns the whole cart's shipping charge in RSD, pricing basis, method, destination and timestamp. It creates no order, quote token, reservation or membership. An unavailable price is not evidence that delivery itself is impossible. Zero is a valid free-delivery result for that exact cart. Later cart/membership changes require a fresh calculation; final order preparation checks the amount again.

Email draft behavior is unchanged. Automated shipping totals do not include assembly or the merchandise total; those remain in the final order quote.

Checks: `node --test test/delivery-quote.test.mjs`; synthetic real-model checks: `node --env-file=.env.local scripts/delivery-quote-smoke.mjs`. The smoke script mocks ERP and never sends customer messages or writes orders. ERP tests are in `tests/unit/social-delivery.test.ts` and `social-route.test.ts`.
