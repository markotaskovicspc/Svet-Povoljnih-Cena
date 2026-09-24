# Email-only guest loyalty

Cart page and mini-cart offer membership and display additional loyalty savings
from the current product quotes. Consent plus an email request sends a 30-minute,
single-use confirmation link. Confirmation creates an HttpOnly, 30-day loyalty
session and opens a dedicated confirmation page. The requesting browser receives
a separate, initially inactive HttpOnly token. Only confirmation of that exact
request promotes it to a session; the cart refreshes status while pending and on
focus. Opening email in another browser activates both sessions, without copying
or replacing carts. The confirmation page directs the customer back to the
original browser when the current browser has no cart. It does not create or authenticate a User,
issue a card number, or subscribe the customer to marketing.

The server validates membership and requires the checkout email to match the
confirmed address. Existing product pricing rules still decide which lines have
a loyalty offer (currently 30%, excluding active product actions). A qualifying
guest receives the existing 15% first-purchase benefit on the discounted item
subtotal. Both guest and account order history are searched by email; the benefit
is consumed by an issued SALE fiscal receipt, as in the existing policy.

Order snapshots retain `guestLoyaltyEmail` and `guestLoyaltyConsentVersion` so
admin edits retain the applicable pricing. Membership consent is stored separately
from account/marketing consent. Tokens are hashed in VerificationToken; confirming
a link atomically claims it and creates a different session token.

## Release prerequisites

- Apply migration `20260924000100_guest_loyalty` through the normal db:deploy
  workflow (including db:harden). No production migration was run locally.
- Configure the existing email provider and canonical base URL. The request API
  refuses to report successful delivery when EMAIL_PROVIDER=none.
- Review the proposed SPC consent copy before publication, including its link to
  the privacy policy. No new marketing subscription is implied.
- Test actual mail delivery, confirmation, page reload, checkout and saved order
  against an isolated database before deploying to production.

## Verification

Unit coverage: guest-loyalty, guest-loyalty-checkout,
first-purchase-eligibility, cart-repricing, pricing-precedence and
checkout-order-summary; existing checkout isolation checks also pass.
Use `npx next build` on Windows after generation/isolation checks: the repository's
`npm run build` includes a POSIX-only conditional deployment command.
