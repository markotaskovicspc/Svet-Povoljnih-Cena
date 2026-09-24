# Guest loyalty: immediate consent (24 September 2026)

The cart panel activates loyalty after explicit consent, without collecting email or sending a confirmation link. A hashed, random HttpOnly session records consent version v3 and its timestamp for 30 days. No account or physical card is created.

Cart prices immediately use the existing loyalty offers; current catalog pricing is subsequently refreshed. The summary separates loyalty savings from sale savings. The existing 30% non-sale-item pricing rules remain authoritative on the server.

Checkout requires email. A session-authorized lookup previews the existing first-purchase eligibility (additional 15%, excluding delivery). Order creation checks eligibility again against fiscal sales history. Consent version and email are recorded on the order; membership consent and timestamp are upserted in the same transaction. An entered email is never marked verified by this flow.

Previously issued email confirmation links and verified sessions remain supported. New enrollment does not depend on email delivery or switching browsers. The consent contact remains office@svetpovoljnihcena.rs. Marketing consent is separate.
