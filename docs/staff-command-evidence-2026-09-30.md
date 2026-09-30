# Staff order command: conversation evidence

The reported command had the complete eleven-message Meta conversation. It was not missing the customer's initial four-chair request. A synthetic reproduction showed the cart model returning matches=true and the correct SKU/quantity, but citing both the buyer's request and the seller's product identification under customerQuotes. The server required every citation to belong to a customer message and rejected the otherwise coherent choice. Serbian paired quotes also failed the evidence matcher.

Evidence now consists of exact conversationQuotes from either side, with at least one genuine customer citation per cart line. All citations must exist; seller-only recommendations, invented citations, wrong SKUs/quantities, customer cancellation and completed-order reuse remain blocked. Serbian typographic quotation marks and escaped newline formatting are normalized without changing substantive text. Staff error messages distinguish failed verification from an unclear customer choice.

The staff extractor uses medium reasoning effort for joining product, quantity, delivery details and the seller's corrected total, without requiring another customer DA for a seller-authorized command. Membership consent remains separate and is never fabricated. If it is missing, the tool reports that actual problem and does not create a higher-priced order.

Staff commands import up to 2,000 Meta messages, checking pagination coverage. If a larger history is incomplete, creation stops with an explicit history warning. The importer merges saved/local/remote messages, removes cross-source echoes and Meta auto-label notices, and retains genuine repeated messages. Existing idempotent checkout tokens, race checks and duplicate-order protection remain in place. No historical command is replayed during deployment.

Production inspection also found an older ERP deployment whose request schema did not support existing_loyalty. Merge the latest origin/main changes before publishing the compatible ERP and bot release; both services must run the matching protocol. No customer order was created as part of diagnostics.
