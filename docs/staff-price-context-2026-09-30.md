# Staff order context and price clarification

Read-only inspection of the reported conversation confirmed that its history was present. It contained an explicitly rejected product, a subsequent LOFT selection at 1,999 RSD, separately supplied contact details, and a later buyer message naming 1,990 RSD. The conversation was paused with reason `Odgovor zaposlenog u Meta inboxu`; ordinary new messages were therefore skipped. Staff commands remain eligible during that pause.

The screenshot's old email/postcode demands and failed command preceded the latest deployment. Optional email/postcode handling and full staff history import already exist in the approved base `66666d77`. This change does not resume a human-owned conversation or replay its command.

Changes:

- Extraction retains the known order input when the only unresolved question is price, returning a separate price conflict with two verbatim, chronological citations.
- The server validates the cited amounts and selected SKU before showing the two conflicting prices. It neither guesses a typo nor writes a discounted order.
- An explicit subsequent correction resolves the conflict without asking for contacts again. Rejected products and unit price versus basket totals are not price conflicts.
- Current catalog price mismatches name both amounts. Invalid evidence is reported as a verification failure rather than missing customer information.
- Normal sales instructions preserve context across a gap in conversation or a question about registering again.

Validation: 124 chatbot tests passed; synthetic model checks retained LOFT, quantity one, phone/address/email/postcode across separate messages, blocked a 1,999/1,990 conflict, then prepared exactly one stubbed quote after a price-only clarification. Real customer transcripts were not sent to an additional model call; no customer message or ERP order was created. Full repository build passed Prisma generation and 12 checkout tests, then hit the existing POSIX shell conditional on Windows before Next build.

Known separate limitation: the current shipping schema has no apartment/entrance field and the social route overwrites notes with its channel marker. The synthetic extraction did not retain those extra delivery directions. They must not be inserted into `houseNumber` as a workaround (the ERP validates that field). This needs a separate end-to-end delivery-notes change.

This branch starts from approved `66666d77`. It excludes unapproved `ae580475` (accepting an additional first-purchase discount during a staff order), which remains on `codex/spc-staff-order-command` pending the user's separate approval.
