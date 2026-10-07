# SPC conversation audit fixes — 2026-10-04

- Preserve an explicitly supplied Belgrade borough in staff and customer order preparation. A unique exact active courier locality is still required; no postcode/email is invented.
- If photo processing fails after three attempts and no ERP write is uncertain, ask for a product name/crop, queue a support notice, and keep the conversation active. Uncertain complaint/order/cancellation writes still require reconciliation.
- Unavailable product cards show availability and reference prices without inviting a purchase.
- Persist the latest queued support request in conversation context. Instruct the agent to acknowledge follow-ups without a new handoff; identical support notices are suppressed for 24 hours, while new issues remain eligible.
- Search the full active courier locality dictionary without Serbian Latin diacritics, including d/dj spellings for đ and Cyrillic input. Queries remain parameterized, preserve ambiguity, and retain verified routing aliases.

Validation: 165 chatbot tests, 22 location/autocomplete tests, checkout guards and Next.js production build passed. Synthetic gpt-6.1-sol extraction preserved Vračar without email; synthetic support follow-up did not repeat handoff. No real conversation replay, customer message or order write used for tests.

Windows npm run build wrapper stops at the existing POSIX db:deploy:production shell expression. Equivalent Next.js production build plus email asset verification completed successfully; no database migration needed.
