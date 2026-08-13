# Complete Calculation & Financial Logic Audit

**System:** Svet povoljnih cena  
**Audit date:** 2026-08-06  
**Repository root:** `/Users/luka/svet povoljnih cena`  
**Audited revision:** `main` at `c0121d9` plus the user's uncommitted working-tree changes present during the audit  
**Audit mode:** read-only review of production logic and remote persisted data; no production business logic was changed

## Final assessment

**Can the financial results be trusted currently? NO.**

The core arithmetic is generally centralized and many pure calculations are well tested, but two P0 workflows can create financially inconsistent states:

1. a delayed IPS success can confirm an expired/cancelled order after its stock has already been restored; and
2. a fiscal refund and stock return can commit before the payment refund is recorded or sent, with no durable continuation path if the process stops between those steps.

There are also material P1 discrepancies in saved-card discounts, purchasing/COGS, customer-facing total breakdowns, fiscal provider recovery, and reports. Current persisted records passed all reconciliation queries run in this audit, but the database sample is too small to exercise the critical branches.

## Executive summary

| Measure | Result |
|---|---:|
| Calculation inventory entries | 80 |
| PASS | 50 |
| FAIL | 18 |
| UNCERTAIN | 11 |
| NOT TESTABLE in this environment | 1 |
| Grouped findings | 16 |
| P0 findings | 2 |
| P1 findings | 8 |
| P2 findings | 6 |
| Business-rule clarifications required | 10 |
| Baseline unit tests | 472 passed, 2 failed |
| Targeted financial unit tests | 89 passed, 0 failed |
| Temporary deterministic audit probes | 3 passed, 0 failed |
| Read-only persisted-data reconciliation checks | 9 passed, 0 mismatches |

The 18 failed inventory entries are grouped into 16 findings because several affected surfaces share one root cause, such as the checkout/email/PDF breakdown problem and the report-status filtering problem.

## Scope and method

The audit traced formulas and state transitions through:

- storefront pricing, cart, checkout, delivery quoting, vouchers, confirmation views, email and PDF generation;
- API validation, order creation, payment callbacks, payment expiry, payment refunds, fiscal sales and fiscal refunds;
- Prisma fixed-scale money columns, stock counters, reservations, idempotency keys and transaction boundaries;
- ERP purchase orders, inbound invoices, landed cost, weighted-average COGS, manual sales, dispatch notes, stocktake and partner reservations;
- reports, dashboards, GA4 ecommerce values, product feeds and reclamation analytics;
- background/retry jobs, Rabalux supplier availability and import calculations;
- automated tests, local browser behavior and aggregate checks against the configured database.

No admin form, checkout, payment, fiscal request, stock change, or external-provider call was submitted. The configured database is remote, so direct database validation was restricted to a PostgreSQL `READ ONLY` transaction and aggregate counts. Gated E2E suites that create/delete ERP, payment or stock records were not run against that database.

## Critical and high-priority findings

### FIN-P0-01 — Delayed IPS success can resurrect an order after stock restoration

**Priority:** P0  
**Status:** Confirmed by code-path analysis  
**Locations:** `src/lib/payments/ips.ts:504-611`, `src/lib/payments/expiry.ts:15-94`

**Logic now**

- Expiry atomically changes a `KREIRANO` order to `OTKAZANO`, marks pending payments `FAILED`, sets `stockRestoredAt`, and restores reservations.
- A later valid IPS `00` result updates any non-`PAID` payment to `PAID` and unconditionally sets the order to `POTVRDJENO`.
- The payment-success transaction does not require `Order.status = KREIRANO`, does not require `stockRestoredAt IS NULL`, and does not re-reserve stock.

**Impact**

A customer can pay successfully after inventory has been returned to sale. The order becomes confirmed without owning stock, allowing overselling and a shipment/payment state that no longer matches inventory.

**How to reproduce**

1. Create an IPS order and reserve its stock.
2. Let `expiresAt` pass and run `expirePendingPayments()`.
3. Confirm that the order is `OTKAZANO`, `stockRestoredAt` is populated, and stock is restored.
4. Apply an authentic late IPS success result for the same order.
5. Observe that payment becomes `PAID` and order becomes `POTVRDJENO` without a new reservation.

**Expected vs actual**

- Expected: a late success is placed in a durable review state, or the order is re-reserved atomically before confirmation; it must never silently confirm against restored stock.
- Actual: payment and order are confirmed unconditionally.

**Recommended fix**

Lock the order and payment together. Permit confirmation only when the order is still payable and `stockRestoredAt IS NULL`. For a late success, create an explicit `PAID_AFTER_EXPIRY`/review state and either atomically reallocate stock or initiate a controlled refund. Make the state transition a conditional update and add a concurrent expiry-vs-callback integration test.

**Acceptance criteria**

- An expiry and IPS success racing in either order cannot leave `PAID + stockRestoredAt != NULL + POTVRDJENO`.
- Exactly one side effect set is emitted.
- Late money is never lost and stock is never silently oversold.

### FIN-P0-02 — Fiscal refund and stock return commit before payment refund

**Priority:** P0  
**Status:** Confirmed by code-path analysis  
**Location:** `src/lib/fiscal/issue.ts:224-450`, especially `371-438`

**Logic now**

The provider fiscal refund is issued first. A database transaction then marks the fiscal document `ISSUED`, increments refunded quantities, and restores stock. Only after that transaction commits does `recordPaymentRefund()` run. If the process stops, times out, or crashes between the commit and that call, a retry sees the original sale lines as fully refunded and returns `already_refunded`.

**Impact**

The tax receipt and inventory can show a completed refund while the customer has not received money and no durable payment-refund job exists. This is a direct financial reconciliation failure.

**How to reproduce**

1. Issue a fiscal refund for an IPS-paid line.
2. Terminate the process after the transaction at line 429 commits and before `recordPaymentRefund()`.
3. Retry the same refund request.
4. Observe `already_refunded`; no guaranteed payment continuation is created.

**Expected vs actual**

- Expected: successful fiscalization durably schedules/reserves the payment refund in the same transaction, and a worker can safely continue it.
- Actual: the money movement is a non-durable post-commit side effect.

**Recommended fix**

Create a `PaymentRefund`/outbox record in the same transaction that records the issued fiscal refund and stock return. Process the provider refund from that durable record, with explicit `PENDING`, `COMPLETED`, `FAILED`, and `NEEDS_REVIEW` states. A retry of the fiscal command must resume the existing payment task.

**Acceptance criteria**

- Killing the process at every boundary still leaves a resumable payment-refund record.
- A fiscal refund cannot be considered operationally complete until payment settlement is completed or visibly requires review.
- Retrying never duplicates fiscal, stock, or payment effects.

### FIN-P1-01 — Saved-card discount is client-selectable, not tied to the payment method, and unreachable from the normal UI

**Priority:** P1  
**Locations:** `src/lib/api/checkout.ts:85-143`, `604-618`; no storefront caller sends `useSavedCard`

`useSavedCard` is accepted directly from the request. The server only checks whether the signed-in user owns any saved card; it does not require a card payment method or identify the token actually charged. A user with any saved-card row can request the 5% discount while choosing bank transfer or cash on delivery. Conversely, the normal checkout does not send the flag, so the advertised rule is not legitimately reachable.

**Fix:** derive eligibility from the selected, server-verified tokenized payment instrument, never from a standalone boolean. Add positive and adversarial API tests.

### FIN-P1-02 — First-purchase and saved-card discounts are absent from checkout and customer document breakdowns

**Priority:** P1  
**Locations:** `src/components/checkout/order-summary.tsx:18-54,153-198`, `src/lib/api/orders.ts:145-213`, `src/lib/email/templates/order-confirmation.tsx:69-108`, `src/lib/email/pdf.ts:137-200`, `src/lib/analytics/ga4-ecommerce.ts:101-134`

The server stores and charges `firstPurchaseDiscount` and `savedCardDiscount`, but the client summary only knows the voucher; the public-order adapter drops both fields; the order email and PDF show only the voucher. Therefore displayed components can sum to a different number from the displayed/stored total. GA4 purchase value also subtracts only the voucher.

**Fix:** expose a server-authoritative quote before final consent and carry every discount component through the public type, confirmation, account detail, email, PDF, fiscal explanation and analytics allocation.

### FIN-P1-03 — Customs base disagrees between PO planning and received COGS

**Priority:** P1  
**Locations:** `src/lib/admin/purchase-order.ts:114-196`, `src/lib/admin/inbound-invoice.ts:49-111`, `src/lib/admin/po.ts:735-769`

The PO financial calculator applies customs to `purchase price + freight per unit`. Inbound defaults and goods receipt apply customs only to purchase value.

Controlled example: purchase `10 × 120 = 1,200 RSD`, freight `5 × 120 = 600 RSD`, customs `10%`.

- PO/BM calculator customs: `(1,200 + 600) × 10% = 180 RSD`.
- Invoice default and receipt COGS customs: `1,200 × 10% = 120 RSD`.
- Planned landed cost exceeds received COGS by `60 RSD/unit`.

**Fix:** choose and document the legal/accounting customs base, implement it once, and reuse it in planning, preview, receipt and reports.

### FIN-P1-04 — Purchase orders can be received from invalid lifecycle states

**Priority:** P1  
**Location:** `src/lib/admin/po.ts:692-800`

`receivePurchaseOrder()` rejects only `RECEIVED`; its conditional update accepts every other state, including `DRAFT` and `CANCELLED`. A direct server action or future UI path can add stock and COGS from a cancelled or unposted order.

**Fix:** require the explicit allowed state(s), a posted/locked order, and a matching inbound-document state inside the same transaction.

### FIN-P1-05 — Duplicate PO product lines produce an incorrect weighted-average COGS

**Priority:** P1  
**Locations:** `src/lib/admin/po.ts:69-268`, `692-800`; no unique `(purchaseOrderId, productId)` constraint

Duplicate product lines are allowed. Goods receipt processes them sequentially but uses the product COGS snapshot loaded before the transaction for every line. Example with no opening stock: `10 @ 100` followed by `10 @ 200` ends at `200`, while the correct average is `150`.

**Fix:** either prohibit duplicate product lines or group receipt quantities/costs by product and calculate one weighted average using a locked, current COGS/quantity snapshot.

### FIN-P1-06 — Fiscalized product revenue report ignores refunds

**Priority:** P1  
**Location:** `src/app/admin/erp/posete-konverzije/page.tsx:89-126`

The product report labeled `Fiskalizovani promet` sums only issued `SALE` lines and never subtracts issued `REFUND` lines. The dashboard's overall turnover correctly applies sale positive/refund negative, so two internal reports disagree after returns.

**Fix:** net product revenue and sold quantity by fiscal-document kind, or relabel the metric explicitly as gross sales before refunds.

### FIN-P1-07 — Successful badi fiscal dispatch is not atomically recoverable if the local write fails

**Priority:** P1  
**Locations:** `src/lib/fiscal/issue.ts:125-221`, `src/lib/fiscal/badi.ts:54-55`, `src/lib/fiscal/retry.ts:17-31`

badi has no idempotency mechanism. The app marks a document dispatched, calls badi, then stores the receipt locally. If badi succeeds but the local update fails, automatic retry correctly refuses an ambiguous redispatch, but the system has no automated provider reconciliation to import the landed receipt. A manual retry can redispatch the same logical sale.

**Fix:** add provider-journal reconciliation and a review workflow that imports the existing receipt; disable raw manual re-dispatch for ambiguous documents.

### FIN-P1-08 — Current Rabalux threshold policy and tests disagree

**Priority:** P1  
**Locations:** `src/lib/rabalux/availability.ts:3-68`, `src/lib/web-storefront-availability.ts:49-138`, failing `tests/unit/rabalux-availability.test.ts` and `tests/unit/web-storefront-availability.test.ts`

Current uncommitted code requires raw supplier stock to be strictly greater than 10 before any Rabalux supplier availability counts. Existing tests and the documented operating rule expect fresh approved stock minus reservations and a one-unit safety buffer. The second failing test also shows the strict web-auto query contract changed.

**Fix:** obtain explicit client approval for the `>10` threshold and rollout semantics, then update implementation, tests and customer label policy together. Do not turn strict enforcement on before the DC import/audit.

## Medium-priority findings

### FIN-P2-01 — Stack-cap flooring leaves part of the allowed discount unused

**Location:** `src/lib/pricing/engine.ts:414-450`

With subtotal `100`, voucher `30`, first-purchase `5`, saved-card `5`, and a 30% cap, proportional flooring produces `22 + 3 + 3 = 28`, not `30`. The residual can be 1–2 RSD in common cases. Use integer minor units plus a largest-remainder allocation so the components reconcile exactly to the cap.

### FIN-P2-02 — Order confirmation email rounds all money to whole dinars

**Location:** `src/lib/email/templates/order-confirmation.tsx:11-16`

The database, UI note and PDFs use two-decimal money, but the email sets `maximumFractionDigits: 0`. Decimal values can be misstated and independently rounded rows may not add to the rounded total.

### FIN-P2-03 — IPS amount comparison is textual rather than numeric

**Location:** `src/lib/payments/ips.ts:485-528`

The callback requires exact equality such as `"100.00"`. A provider response of `"100"` or `"0100.00"` represents the same amount but is rejected. Parse to fixed minor units after validating the documented provider format.

### FIN-P2-04 — Accepted manual-sales extremes exceed database precision

**Locations:** `src/lib/admin/sales-order.ts:13-25,75-90`, `prisma/schema.prisma` `Decimal(12,2)` totals

The API accepts quantity `999,999` and unit price `999,999,999.99`, whose product is `999,998,999,990,000.00`. A `Decimal(12,2)` column can hold at most `9,999,999,999.99`. Validation accepts an order that persistence cannot represent.

**Fix:** enforce aggregate line/header limits before any database write and align every input maximum with column precision.

### FIN-P2-05 — Partner inventory read and reservation use different warehouse scopes

**Locations:** `src/app/api/partners/v1/inventory/route.ts`, `src/app/api/partners/v1/reservations/route.ts`

Inventory GET sums all active warehouses, while reservation POST locks and checks only the chosen default warehouse. A partner can be told stock is available and then receive an insufficient-stock response for the same SKU. The returned field called `physical` also excludes active web-order reservations because warehouse balances are already decremented for those reservations.

**Fix:** expose per-warehouse availability explicitly or make GET and POST use the same reservable scope and terminology.

### FIN-P2-06 — Dispatch financial totals ignore order-level discounts

**Locations:** `src/lib/admin/dispatch-note.ts`, `src/lib/admin/dispatch-note.server.ts`, migration `0033_dispatch_note_workflow`

Dispatch lines derive gross/net/VAT from `OrderItem.unitPriceSale × dispatched quantity` but do not allocate voucher, first-purchase or saved-card discounts. A priced dispatch note for a discounted web order does not reconcile to the amount paid or fiscalized.

**Fix:** either make web dispatch notes explicitly non-financial/hide prices, or reuse the fiscal discount allocation for the dispatched quantity.

## BUSINESS RULE CLARIFICATION REQUIRED

The following rules cannot be called correct or incorrect from code alone. They need a written decision from the business/accounting owner before implementation changes.

1. **Money precision:** Is customer pricing intentionally whole-dinar even though database money is `Decimal(12,2)` and the checkout says prices have two decimals? Percentage loyalty, vouchers and linear promotions currently round to whole RSD.
2. **VAT model:** Are every product, shipping service, assembly service and inbound cost component always subject to exactly 20% VAT? The data model can store a rate per fiscal/dispatch line, but product and inbound workflows have no multi-rate/exempt rule source.
3. **First purchase:** Does “first purchase” mean first created order, first paid order, first delivered order, or first non-cancelled order? Current logic counts cancelled and expired attempts.
4. **Voucher identity:** Should `perUserLimit` apply to guest shoppers, and can zero-value or over-100% percentage vouchers be created? Guests currently bypass per-user limits.
5. **Delivery pricing:** For mixed carts, should one maximum courier/truck rule be charged, should fees add per item/package, or should another tariff matrix apply? Current logic takes the maximum applicable rule.
6. **Freight allocation:** Is the requested allocation weight `max(normalized volume share, normalized weight share)`, renormalized across lines? It is unusual but consistently implemented and tested.
7. **Inbound invoices and late cost:** Does each linked invoice contain a complete purchase baseline or only incremental costs? When late costs arrive after some units were sold, should the full adjustment be loaded onto remaining stock, expensed, or split?
8. **Non-IPS refunds:** Does a `COMPLETED` internal refund row mean money was actually returned externally for cash, card-on-delivery and bank-transfer methods, or only that an operator accepted responsibility for manual settlement?
9. **Dispatch-note prices:** Must a dispatch document reconcile to the paid/fiscal net price after order-level discounts, or is it intentionally a list-price logistics document?
10. **Rabalux availability:** Is the approved rule “fresh 30 minutes, minus reservations, one-unit safety buffer” or “supplier raw stock must also be >10”? What exact customer label should be shown for supplier stock?

## Complete calculation inventory

Legend: **PASS** = calculation and guards agree with the implemented/documented rule and available evidence; **FAIL** = reproducible defect, inconsistent calculation, or failing contract; **UNCERTAIN** = arithmetic is deterministic but the governing business rule is not established; **NOT TESTABLE** = required live state/provider behavior was intentionally not changed in this environment.

### Pricing, cart, checkout, documents and analytics

| ID | Formula / rule | Modules and layers | Inputs → output / storage | Result and risk |
|---|---|---|---|---|
| CALC-001 | Active retail price list entry, otherwise product fallback | `src/lib/pricing/retail-price.ts`; catalog/API/ERP | price-list windows, entry price, legacy full price → effective full price and source | **PASS** — deterministic active-window selection; catalog query also requires a positive live retail entry. |
| CALC-002 | Highest-priority live action; tie by newest start, lower price, stable ID/name | `src/lib/pricing/engine.ts`; listing, PDP, cart, checkout | action rows + time → action base price | **PASS** — shared helper and precedence tests keep UI/server aligned. |
| CALC-003 | Loyalty = explicit price, else `round(full × (1 − pct/100))` | pricing engine; product/listing/checkout; `Product` Decimal prices | full price, loyalty price/pct → unit payable price | **UNCERTAIN** — rounds to whole RSD despite two-decimal persistence and UI wording. |
| CALC-004 | Linear promotion applies to active base and is capped against full price | pricing engine; admin pricing rules; checkout | base, linear %, product/global cap → effective unit price | **PASS** for the current whole-dinar rule; precedence/cap tests pass. |
| CALC-005 | Line total = unit sale × qty; line saving = (full − sale) × qty | pricing engine; checkout; `OrderItem` | authoritative product prices, integer qty → line/subtotal/savings | **PASS** for normal-range inputs; server re-fetches product data. |
| CALC-006 | Voucher percent = `round(subtotal × pct/100)`; fixed = `min(amount, subtotal)` | `src/lib/api/vouchers.ts`; voucher admin/checkout/DB | voucher amount/kind, subtotal → discount RSD | **UNCERTAIN** — whole-RSD percentage rounding and zero/over-100 values need a rule. |
| CALC-007 | Voucher limits checked under a row lock at order creation | voucher validator + checkout transaction + redemption table | validity window, counts, user, subtotal → accepted redemption | **PASS** — authoritative revalidation closes ordinary usage-limit races. |
| CALC-008 | First-purchase flag = count of all user orders equals zero | `src/lib/api/checkout.ts`; `Order` | user order count → 5% eligibility | **UNCERTAIN** — cancelled/expired attempts permanently consume eligibility. |
| CALC-009 | Saved-card flag supplied by client and allowed if any saved card exists | checkout API; saved-card table; pricing engine | request boolean, user card count → 5% discount | **FAIL** — not bound to the charged method/token and normal UI never sends it. |
| CALC-010 | First and saved-card components = rounded 5% of eligible subtotal | pricing engine/config | eligible subtotal, flags → component discounts | **PASS** under the current whole-RSD rule. |
| CALC-011 | Combined order discounts proportionally scaled to 30% cap | pricing engine | voucher + first + card + eligible subtotal → applied components | **FAIL** — flooring each component leaves a 1–2 RSD residual instead of reconciling to the cap. |
| CALC-012 | Mixed-cart delivery fee = maximum applicable scoped rule | `src/lib/checkout/config.ts`; admin delivery rules; checkout UI/API | city, product/category rules → courier/truck fee | **UNCERTAIN** — deterministic and server-authoritative, but tariff aggregation rule is not documented. |
| CALC-013 | Assembly total = per-SKU rule × qty for selected assembly lines | checkout config, summary and API | allowed flag, scoped price, selection, qty → `assemblyTotal` | **PASS** — server re-resolves and persists per-line price and header total. |
| CALC-014 | Order total = max(0, subtotal + shipping + assembly − all order discounts) | checkout API; `Order.total`; `Payment.amount` | server price quote and eligibility → stored/charged total | **PASS** — read-only DB reconciliation found 0/7 order formula mismatches and 0/6 settled-payment amount mismatches. |
| CALC-015 | Client pre-submit total subtracts voucher only | `src/components/checkout/order-summary.tsx`, checkout local snapshot | cart prices, delivery quote, voucher → displayed total | **FAIL** — first/saved discounts can make the final server charge differ from the consent screen. |
| CALC-016 | Public order, account, email and PDF expose discount breakdown | orders adapter, confirmation/account UI, email templates, invoice PDF | persisted order discounts → customer document totals | **FAIL** — first/saved fields are dropped, so components do not reconcile visibly. |
| CALC-017 | Checkout retry keyed by locked checkout session reuses one order | checkout API; checkout session/order/sequence/payment/stock transaction | session key + identical request → one order and side-effect set | **PASS** by code and existing acceptance structure; live mutation not rerun here. |
| CALC-018 | Cart merge sums quantities and clamps each SKU to 99 | `src/lib/api/cart.ts`, cart hook/store | local/server cart lines → normalized quantities | **PASS** — zero lines dropped and checkout still validates quantities. |
| CALC-019 | Voucher per-user limit applies only when `userId` exists | voucher API/DB | guest or user identity + redemptions → eligibility | **UNCERTAIN** — guest shoppers can reuse a nominally per-user voucher. |
| CALC-020 | GA4 purchase value allocates voucher across merchandise; shipping separate | `src/lib/analytics/ga4-ecommerce.ts`; browser analytics | order items, voucher, assembly → GA4 item price/discount/value | **FAIL** — first/saved discounts are omitted, overstating item/purchase value. |

### Payments, fiscalization, refunds and dispatch

| ID | Formula / rule | Modules and layers | Inputs → output / storage | Result and risk |
|---|---|---|---|---|
| CALC-021 | IPS amount formatted as positive fixed two decimals | `src/lib/payments/ips.ts`; gateway payload | order/refund amount → string | **PASS** — rejects non-positive/non-finite amounts and formats minor units consistently. |
| CALC-022 | IPS callback amount must textually equal formatted order total | IPS apply-result path | provider amount string, order total → accept/reject | **UNCERTAIN** — exact provider lexical contract is unavailable; numerically equal strings can fail. |
| CALC-023 | Paid IPS result confirms payment and order | IPS callback/status + `Payment`/`Order` | authentic `00` result → `PAID`, `POTVRDJENO`, jobs | **FAIL** — can confirm after expiry restored stock (FIN-P0-01). |
| CALC-024 | Pending-payment expiry restores stock once | `src/lib/payments/expiry.ts`; order reservations/inventory | expired pending order → cancelled order, failed payment, restored stock | **PASS** — conditional order update and idempotent movement keys prevent ordinary double restoration. |
| CALC-025 | IPS refund ≤ paid amount − pending/completed/review refunds | IPS provider; `PaymentRefund` serializable transaction | requested amount and prior refunds → durable reservation/status | **PASS** — durable pre-gateway record, unique key and review state handle ambiguity. |
| CALC-026 | Order discounts distributed across fiscal items in integer cents using largest remainder | `src/lib/fiscal/issue.ts`; fiscal lines | item gross bases, all order discounts → one-cent price tiers | **PASS** — exact allocation is designed to make fiscal items + shipping equal `Order.total`. |
| CALC-027 | Fiscal net = round2(gross / 1.2); VAT = gross − net; headers sum lines | fiscal issue/refund/PDF; `FiscalDocument*` | gross line values → net/VAT/header totals | **PASS** for 20%; read-only DB found 0/3 issued header/line mismatches. |
| CALC-028 | VAT rate is always 20% for goods, shipping, assembly and manual sales | fiscal, sales, dispatch, inbound invoice | gross or net amounts → tax components | **UNCERTAIN** — no product/service rate source, exemptions or mixed-rate support. |
| CALC-029 | Successful badi result followed by local `ISSUED` update | fiscal issue, badi adapter, retry job | provider response → durable fiscal receipt | **FAIL** — provider success/local failure is ambiguous and not automatically reconcilable. |
| CALC-030 | Automatic fiscal retry avoids ambiguous dispatched requests | `src/lib/fiscal/retry.ts` | status, error class, dispatch time, attempts → retry/skip | **PASS** — conservative retry prevents automatic duplicate fiscal receipts. |
| CALC-031 | Refundable quantity = sale-line qty − previously refunded qty | fiscal refund + DB guarded increment | selected lines → remaining full-line refund qty | **PASS** — update predicate and unique fiscal key prevent ordinary duplicate quantity refunds. |
| CALC-032 | Fiscal refund restores product qty once per refund line | fiscal refund + inventory movement | issued refund lines → stock increment/movement | **PASS** inside the local transaction; no negative stock and no current duplicate movements observed. |
| CALC-033 | Payment refund occurs after fiscal/stock transaction | fiscal refund + payment providers | issued refund total → money return | **FAIL** — non-durable gap can strand customer money (FIN-P0-02). |
| CALC-034 | Non-IPS refund row is immediately marked `COMPLETED` | fiscal `recordPaymentRefund` | cash/bank/card-on-delivery method + amount → internal completed row | **UNCERTAIN** — external/manual settlement evidence is not represented. |
| CALC-035 | Confirmation email formats money with zero fraction digits | order email template | Decimal order amounts → displayed currency | **FAIL** — contradicts two-decimal system precision and can break visible reconciliation. |
| CALC-036 | Dispatch totals = dispatched qty × item sale price, then 20% VAT split | dispatch note code/DB/print/UBL | order item snapshot + dispatch qty → document totals | **FAIL** for discounted web orders because order-level discounts are absent. |

### Inventory, availability, partner stock and reclamations

| ID | Formula / rule | Modules and layers | Inputs → output / storage | Result and risk |
|---|---|---|---|---|
| CALC-037 | Inventory adjustment updates warehouse and product aggregate by identical delta | `src/lib/inventory.ts`; `WarehouseStock`, `Product.stock`, movements | locked product/warehouse, integer delta → balances | **PASS** — transactional and centralised. |
| CALC-038 | Negative outgoing balance is rejected conditionally | inventory adjustment + DB | current qty, negative delta → success/error | **PASS** — tested with insufficient reservation. |
| CALC-039 | Movement idempotency key returns original movement | inventory + unique DB key | operation identity → exactly one mutation | **PASS** — unit test verifies retry behavior. |
| CALC-040 | Manual physical target = current net warehouse qty + active order reservations | inventory set/default logic; article-stock projection | counted physical, reservations → correction delta/net availability | **PASS** — preserves active reservations while correcting physical stock. |
| CALC-041 | Cancellation restore = remaining warehouse-reserved quantity, excluding dispatched/supplier portions | order reservation restore | item reservation/dispatched counters → restorable qty | **PASS** — movement keys and `stockRestoredAt` prevent ordinary duplicates. |
| CALC-042 | Rabalux supplier is eligible only if fresh/approved/operational and raw stock >10 | Rabalux availability, storefront query, channel sync | feed qty/time/approval → supplier eligibility | **FAIL** against two existing tests and the documented prior policy; business decision required. |
| CALC-043 | Rabalux sellable = DC + max(supplier − reserved − safety, 0) | `src/lib/rabalux/allocation.ts`, availability | DC/supplier/reserved/safety → sellable qty | **PASS** once supplier eligibility is decided. |
| CALC-044 | Checkout allocates DC first, then supplier | checkout + Rabalux allocation/fulfillment | requested qty, two pools → warehouse/supplier reservation split | **PASS** — sum is required to equal ordered quantity and DB constraint supports it. |
| CALC-045 | Auto channel availability thresholds: web 0, wholesale 10, export 20 | channel availability + admin settings/migration | DC available, manual flags → channel booleans | **PASS** for the documented thresholds; tests pass. |
| CALC-046 | Strict web auto-availability rollout | storefront query + Vercel environment | manual flag, auto flag, DC audit state → listed catalog | **NOT TESTABLE** — production must remain `ENFORCE_WEB_AUTO_AVAILABILITY=false` until DC stock is imported and audited. |
| CALC-047 | Incoming stock = sum max(ordered − received, 0) for eligible PO/invoice states | `src/lib/admin/incoming-stock.server.ts`; product/PO | open PO lines and received qty → `Product.incomingStock` | **PASS** for implemented status rules. |
| CALC-048 | Partner GET available = all warehouse balances − all active partner reservations; POST checks default warehouse | partner inventory/reservation API | multi-warehouse stock/reservations → reported/reservable qty | **FAIL** — scopes can disagree; field named physical is not true counted physical. |
| CALC-049 | Partner reservation serialized by product lock and client idempotency key | partner API + movement/channel sync | SKU, qty, client/key → one reservation | **PASS** by code and gated acceptance test design. |
| CALC-050 | Reclamation total quantity cannot exceed purchased quantity | reclamation API transaction | prior reclamations + requested qty → accept/reject | **PASS** — counter update serializes concurrent submissions. |
| CALC-051 | Stocktake dispatch posts positive integer quantities through inventory helper | stocktake dispatch server | draft lines + source warehouse → outgoing stock/movements | **PASS** — validated, idempotent and covered by unit tests. |

### Purchasing, inbound invoices, COGS and ERP sales

| ID | Formula / rule | Modules and layers | Inputs → output / storage | Result and risk |
|---|---|---|---|---|
| CALC-052 | Delivery date = loading date + transit days, else order date + supplier delivery days | PO calculation/UI/DB | UTC dates and day counts → delivery date | **PASS** — deterministic priority and tests. |
| CALC-053 | Unit volume/weight from container, pack, unit pack, then item fallback | PO calculator; product logistics fields | dimensions, pack/container qty/weight → m³/kg per unit | **PASS** — zero guards and six-decimal normalization tested. |
| CALC-054 | Freight RSD allocated by normalized max(volume share, weight share), with value fallback and last-cent reconciliation | PO calculation and goods receipt | freight/FX and line metrics → per-line/per-unit freight | **PASS** for the implemented rule and cent reconciliation; business rule still needs confirmation. |
| CALC-055 | Customs and BM use different customs bases across modules | PO financials, inbound defaults, receipt COGS | purchase, freight, customs rate → customs/COGS/margin | **FAIL** — controlled example differs by 60 RSD/unit. |
| CALC-056 | Total BM% is net-retail-value weighted | PO financial calculator/UI | per-line BM%, net retail, qty → header BM% | **PASS** assuming the customs base and fixed 20% retail-net rule are approved. |
| CALC-057 | PO capacity warns when total volume/weight exceeds transport payload | PO post action | header logistics vs payload → blocking warnings | **PASS** — exact boundary tested. |
| CALC-058 | PO totals = sums of line volume, weight and purchase price × qty | PO recomputation + stored header | line values → header totals/financial preview | **PASS** for normal ranges and cent rounding. |
| CALC-059 | Receive PO from any state except already received | PO receipt transaction | PO status/lines → received qty, stock, COGS | **FAIL** — draft/cancelled/unposted orders can be received. |
| CALC-060 | Weighted-average COGS processed independently for duplicate lines using stale product COGS | PO receipt + product COGS | current qty/COGS and each incoming line → final COGS | **FAIL** — duplicate SKU example ends at 200 instead of 150. |
| CALC-061 | Pure weighted average = `(oldQty×oldCost + newQty×newCost)/(oldQty+newQty)` | inbound/PO helpers | quantities and unit costs → rounded unit COGS | **PASS** — controlled client example returns 193.33. |
| CALC-062 | Inbound net = invoice + customs + transport + other; VAT = 20% of all net; gross = net + VAT | inbound invoice helper/server/UI/DB | cost components → net/VAT/gross | **UNCERTAIN** — fixed tax treatment may be invalid for foreign supplier/customs/transport components. |
| CALC-063 | Linked invoice adjustment allocated by PO value in cents, residual on last line | inbound invoice helper/server | adjustment and line values → per-line additional cost | **PASS** — positive and negative cent reconciliation tests pass. |
| CALC-064 | Complete linked invoices subtract one PO baseline; late adjustment divided by current remaining stock | inbound helper/server + product COGS | invoice set, baseline, current stock → added unit COGS | **UNCERTAIN** — multiple-full-invoice and post-sale accounting policy is not established. |
| CALC-065 | Manual sales gross = qty×unit gross; net = round2(gross/1.2); VAT = gross−net | sales order helper/server + `Order`/dispatch | integer qty, unit price, 20% rate → line/header totals | **PASS** for representable inputs; two-decimal tests pass. |
| CALC-066 | Manual-sales input maxima vs Decimal(12,2) aggregate | sales schema + Prisma columns | up to 999,999 × 999,999,999.99 → persisted totals | **FAIL** — accepted aggregate can exceed DB capacity by about 100,000×. |
| CALC-067 | Dispatch posting decrements source and, for internal transfer, increments destination | dispatch server + inventory movements | posted qty/source/destination → stock balances | **PASS** — transaction, status guards and movement idempotency are present. |
| CALC-068 | Physical packages = ceil(qty/packQty); GLS constraints: 40kg, side 200cm, longest+2×other sides ≤300cm | courier package/routing/payload | order qty and package measures → package count/validation | **PASS** — missing measurements block provider use and boundary tests pass. |

### Reports, feeds and operational metrics

| ID | Formula / rule | Modules and layers | Inputs → output / storage | Result and risk |
|---|---|---|---|---|
| CALC-069 | Dashboard fiscal turnover = issued SALE gross − issued REFUND gross | `src/app/admin/page.tsx`; fiscal DB | fiscal docs/date/warehouse → net turnover cards | **PASS** — correct sign treatment and period boundaries. |
| CALC-070 | Stock value = max(qty,0)×COGS; incoming value = remaining qty×purchase price×FX; volume prorated | admin dashboard SQL | warehouse/PO/product data → inventory cards | **PASS** for the chosen COGS and PO-state semantics. |
| CALC-071 | Product fiscal revenue sums issued SALE product gross less service gross | conversion report SQL | fiscal sale lines → per-product revenue | **FAIL** — issued refunds are not subtracted. |
| CALC-072 | Top products/funnel/cart conversion count non-cancelled or checkout-completed activity | dashboard and conversion SQL | order statuses and analytics events → qty, buyers, attributed value | **FAIL** — returned orders remain in top products; completed events can retain cancelled/expired orders; cart value omits order discounts. |
| CALC-073 | Reclamation rate = count / delivered items ×100; average resolution = mean non-negative resolved durations | `src/lib/admin/reclamation-analytics.ts`; ERP reclamation report | reclamations, deliveries, timestamps → totals/rates/age buckets | **PASS** — zero denominators and invalid negative durations are handled; unit tests pass. |
| CALC-074 | Feed price/sale price formatted to two decimals; sale emitted only below full price | `src/lib/feeds/source.ts`, Google/Meta/TikTok serializers | live product Decimal prices → channel feed money fields | **PASS** — positive full price and valid sale relationship are enforced at projection. |
| CALC-075 | Feed availability = stock >0, else incoming >0 means preorder | feed source + storefront availability query | product net stock/incoming stock → in stock/preorder/out of stock | **UNCERTAIN** — “preorder” is a channel policy, and non-Rabalux strict auto availability is rollout-gated. |
| CALC-076 | Supplier/import display discount = round((full−sale)/full×100) | Rabalux parser and Book12 import script | imported full/sale prices → integer discount badge | **PASS** as a display percentage; charged price remains the price value, not the badge. |
| CALC-077 | Courier routing expands ceil(qty/packQty); bulky if truck/assembly/side>60cm/weight>30kg | `src/lib/courier/routing.ts`, registry | shipment method and package measures → GLS/X Express route and labels | **PASS** against the documented routing comments and package tests. |
| CALC-078 | X Express measured mass distributed across packages to 0.001kg, last package gets residual, minimum 0.1kg | `src/lib/x-express/payload.ts` | item/pack weights and package count → provider masses | **PASS** for provider-safe positive masses; missing weight falls back deterministically. |
| CALC-079 | Advertising budget persisted with two decimal places | `src/lib/feeds/budget.ts`; `AdFlag` | optional numeric budget → Decimal money and API state | **PASS** for valid finite input supplied by its caller; storage precision is explicit. |
| CALC-080 | Delivery window uses DC when DC covers qty, supplier 5–8 when combined supplier stock is needed | `src/lib/delivery-windows.ts`; catalog/PDP/cart | requested qty, DC and supplier available → min/max working days | **PASS** once supplier-eligibility policy is resolved; bounds/defaults are validated and cached. |

## Independent controlled examples

| Scenario | Independent expected result | Application result | Assessment |
|---|---:|---:|---|
| One item, `125.50 RSD`, 10% loyalty | `112.95` | `113.00` | Rule conflict: whole RSD vs Decimal(12,2). |
| One item, subtotal 100, voucher 30 + first 5 + saved 5, cap 30% | `30` total discount | `28` (`22+3+3`) | Confirmed cap-allocation residual. |
| PO purchase 1,200 + freight 600, customs 10% | One approved customs base required | PO screen `180`; receipt/inbound `120` | Confirmed cross-module inconsistency. |
| Duplicate receipt lines `10@100` and `10@200`, no opening stock | `(1,000+2,000)/20 = 150` | Receipt loop can end at `200` | Confirmed stale-snapshot defect. |
| Gross sale 120 at 20% VAT | net `100`, VAT `20` | net `100`, VAT `20` | Pass. |
| Existing 100 units @200 plus 50 @180 | `193.333… → 193.33` | `193.33` | Pass. |
| Freight `100.01` split across heavy/bulky equal normalized maxima | exact sum `100.01` | `50.01 + 50.00` | Pass; cents reconcile. |
| Manual sales accepted max unit price × max qty | `999,998,999,990,000.00` | accepted by schema, cannot fit Decimal(12,2) | Confirmed bounds defect. |
| Rabalux DC 2, supplier 5, reserved 0, safety 1, fresh/approved | documented prior rule sellable `6`, mixed | current threshold ignores supplier, sellable `2`, DC | Current test failure/policy conflict. |
| Reclamation count 2 over 100 delivered | `2%` | `2%` | Pass. |

## Persisted database reconciliation

The configured database was queried inside `BEGIN TRANSACTION READ ONLY`; only aggregate counts were returned.

**Sample size**

| Entity | Count |
|---|---:|
| Orders | 7 |
| Payments | 6 |
| Fiscal documents | 3 |
| Fiscal refunds | 0 |
| Warehouse-stock rows | 258 |
| Purchase orders / items | 3 / 6 |
| Partner reservations | 0 |

**Checks**

| Reconciliation | Mismatches |
|---|---:|
| `Order.total` vs subtotal + shipping + assembly − voucher − first − saved | 0 |
| Settled `Payment.amount` vs `Order.total` | 0 |
| Paid order with `stockRestoredAt` populated | 0 |
| Issued fiscal header vs sum of fiscal lines | 0 |
| Issued fiscal refund without a `PaymentRefund` record | 0 |
| Negative warehouse balance | 0 |
| `Product.stock` vs sum of existing warehouse balances | 0 |
| Duplicate product groups within a PO | 0 |
| Active partner reservation above its warehouse balance | 0 |

These are useful pass signals, not proof that the risky paths are safe: the database contains no fiscal refunds, no partner reservations and no duplicate PO product group, so FIN-P0-02, FIN-P1-05 and FIN-P2-05 have no persisted example to reconcile.

## Automated test evidence

### Baseline suite

Command: `npm run test:unit`

- 104 test files discovered.
- 102 files passed; 2 failed.
- 472 tests passed; 2 failed.
- Both failures are availability-policy assertions:
  - `tests/unit/rabalux-availability.test.ts`
  - `tests/unit/web-storefront-availability.test.ts`

No arithmetic, purchase-order, invoice, inventory, sales, courier, GA4 or reclamation unit test failed in the baseline run.

### Focused financial suite

Command: targeted `vitest run` over pricing, cart, checkout store, inbound invoice, freight allocation, purchase order/PDF, inventory, channel availability, IPS callback/token, GA4, reclamation, courier, manual sales, dispatch and stocktake tests.

- 20/20 files passed.
- 89/89 tests passed.

### Deterministic audit probes

A temporary Vitest probe was created, executed, and removed so it would not leave a test that treats known defects as desired behavior. All three probes measured the current implementation exactly:

- capped discounts return 28 against a 30 RSD cap;
- 10% loyalty on 125.50 returns 113 instead of 112.95;
- PO planning returns 180 customs while inbound defaults return 120 for the same controlled inputs.

The probe file was removed after execution; the examples above are the durable audit record.

## Browser evidence

The in-app browser was used against a local Next.js 16.2.11 dev server at `127.0.0.1:3000`, with the app reading the configured database.

- Home/catalog rendered live full and loyalty prices without browser console warnings/errors.
- The hydrated empty-cart state correctly replaced the loading state.
- `/checkout` redirected to `/checkout/podaci` and correctly blocked progress with an empty cart.
- No homepage item was purchasable under the current availability state, so a real add-to-cart/checkout/save/reload scenario could not be performed without changing remote stock or business records.
- No checkout, admin, payment, fiscal, voucher, inventory or newsletter form was submitted.

The browser automatically emitted ordinary analytics events while pages loaded. No financial or inventory record was created.

## Passed controls worth preserving

- Server-authoritative checkout re-fetches product prices, delivery rules, payment-method enablement and stock.
- Checkout order/payment/item/stock/voucher creation is in one transaction and checkout-session reuse is locked.
- Voucher usage is revalidated under lock immediately before redemption.
- Inventory movements use unique idempotency keys and reject negative outgoing balances.
- Payment expiry restores reservations only after a conditional order-state claim.
- IPS refund requests create a durable pending record before the gateway call and reserve the refundable amount serializably.
- Fiscal item allocation uses integer cents and largest-remainder distribution, including one-cent price tiers for indivisible quantities.
- Fiscal automatic retries deliberately skip ambiguous badi requests.
- Reclamation quantity checks serialize concurrent attempts against the purchased quantity.
- Freight and linked-invoice allocations reconcile the final cent.
- Pure weighted-average COGS, VAT split, courier package limits, stocktake quantities and reclamation metrics have passing boundary tests.
- Current persisted order, payment, fiscal and stock aggregates reconcile in every read-only query run.

## Not tested / external prerequisites

The following require an isolated disposable database or live-provider sandbox and were not executed against the configured remote database:

- concurrent IPS success vs payment-expiry race;
- process termination at each fiscal-refund/payment-refund boundary;
- badi success followed by local database failure and provider-journal recovery;
- real IPS, badi, MyGLS, X Express, card, Google Pay or Apple Pay amounts and callbacks;
- saving/reloading admin purchase orders, inbound invoices, vouchers, sales orders, dispatches and stocktakes;
- duplicate-PO receipt and invalid-state receipt against persisted fixtures;
- multi-warehouse partner GET/POST mismatch with active reservations;
- successful cart/checkout browser reconciliation with first/saved discounts;
- fiscal refund documents because the audited database currently has none.

Run these only in an isolated schema/database with provider training/sandbox configuration. The existing E2E suites are gated for that reason and include destructive fixture setup/cleanup.

## Recommended remediation order

1. **Block release and fix FIN-P0-01 and FIN-P0-02.** Add failure-injection and concurrency tests before changing adjacent features.
2. **Fix saved-card eligibility and the authoritative checkout/document breakdown.** A customer must consent to exactly the amount and components persisted and charged.
3. **Unify purchasing customs/COGS formulas and harden PO lifecycle/duplicate lines.** Backfill or report any affected receipts after the rule is approved.
4. **Add badi provider reconciliation.** Ambiguous fiscal documents need a safe import/review path, never blind redispatch.
5. **Correct refund-aware analytics and report status filters.** Define whether returned/cancelled orders belong in each KPI.
6. **Resolve the ten business-rule questions** and encode each decision in named config, validation, tests and admin help text.
7. **Align numeric input maxima with Decimal precision** and add aggregate overflow tests.
8. **Create an isolated financial acceptance environment** and run the currently gated save/reload, race, retry and provider tests.
9. **Re-run this audit and all reconciliations** before changing the final answer from **NO**.

## Availability deployment note

Vercel Production currently uses `ENFORCE_WEB_AUTO_AVAILABILITY=false`. Keep it false until DC stock has been imported and audited. The safe rollback for any strict-availability experiment is to set it back to `false` and redeploy.

The currently documented operating model is the “two toy boxes” model: the DC box comes from CSV/XLSX and can be manually corrected; the Rabalux box is trusted for 30 minutes, subtracts reservations, keeps one unit in reserve, and exposes only “Dostupno kod dobavljača” plus the 5–8 day delivery window. The uncommitted `>10` supplier threshold is a policy change and must be confirmed with the client before tests or production enforcement are updated.
