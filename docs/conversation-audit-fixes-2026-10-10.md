# Conversation audit fixes — 2026-10-10

Addresses unresolved audit findings from October 8–10:

- A later photo no longer invalidates a named product accepted in the current purchase. The cart evidence checker still verifies every item/quantity and subsequent changes, and excludes completed purchases.
- Image analysis groups repeated views of the same model; genuinely distinct products remain separate. Clarifications contain short positions, not truncated internal descriptions. The sales agent receives the clarification as context so it can also respond to the buyer's quality/warranty question.
- Equipment questions during an offer get an answer without repeating the entire quote. Offers change only for changed purchase details or expiration.
- The worker owns the optional support callback question, removes a duplicated model email question, and consistently calls the team korisnička podrška.
- Qualified locality text such as Bajevac, Lajkovac is resolved only through exact dictionary records sharing a verified municipality ID. Ambiguous or unmatched places are not guessed. Known city districts continue through their existing routing aliases.
- Address failures retain customer contacts and selected lines, invalidate a stale quote, and expose the unresolved address context to the agent. Repeated failures queue support rather than repeating the same question. Delivery-time questions remain answerable during an address investigation.

Confirmation text helpers are separated from webhook parsing to avoid a circular import through ad image analysis. No database migration, model change, historical command replay, customer send or order mutation is part of this release.

Validation: 198 chatbot cases reviewed (197 passed in the complete serial run; the remaining assertion was updated for the new optional-contact wording and passed in a focused rerun). 37 focused cases passed, plus the targeted handoff/address cases. Four real-model synthetic scenarios passed with fake ERP clients, including two-product checkout after a later photo and no email. Checkout isolation: 16 tests passed.

The Windows npm build wrapper stops at its existing POSIX production migration conditional. Next build and email asset validation are run directly; this release adds no schema changes.
