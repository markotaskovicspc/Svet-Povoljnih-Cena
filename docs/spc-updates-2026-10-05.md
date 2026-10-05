# SPC updates, 2026-10-05

- Courier postage lookup needs only confirmed products and quantities; town is optional, and the server uses the nationwide checkout tariff without city-specific legacy rules. Truck delivery and actual order addresses still require a supplied town.
- Fiscalization combines imported Ananas sale/refund items and SPC issued sale/refund items, marks channel and document type, excludes delivery/assembly rows, and subtracts allocated services from SPC merchandise amounts. Refund values are negative. Existing SPC refund actions remain scoped to original SPC sale line IDs; imported Ananas rows cannot invoke local refund actions.
- COGS per unit and total come from the fiscal snapshot, never current catalogue cost. Missing historical cost (including Ananas mirror records) stays unknown. Older Ananas item net amounts remain unknown; subsequent imports retain provided per-item net.
- Website has a Messenger launcher at bottom right with SPC branding and a link to the actual Facebook Page inbox. This is an explicit handoff to Messenger, not an embedded simulated chat. The mobile loyalty gift is at bottom left; expanded gift stays above the launchers.
- New APR extract 7588852.pdf inspected. Meta Business verification is In review, with no edit/resubmit/upload control; no new submission claimed. Access verification is separately Not verified.

Validation: 166 chatbot tests, 29 focused delivery/fiscal/Ananas/refund tests, 15 checkout isolation tests. Windows npm build stops at its pre-existing POSIX database-deploy shell expression; equivalent direct Next build and email asset verification used. Standalone tsc includes existing test-suite errors; production build checks application types.
