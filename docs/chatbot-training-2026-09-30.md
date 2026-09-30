# Chatbot follow-up, 2026-09-30

Confirmed request: update from upstream; accept orders without email or customer-supplied postcode; put the exact conversation in support notifications; prevent duplicate complaints; clarify multi-product photos and find catalog candidates. Existing Agents SDK, model and deployment conventions retained.

Confirmed findings: sales/staff schemas required email and postcode; checkout required guest email; support notices contained only a conversation identifier; complaint idempotency covered one request ID but not a restarted report. Vision already described positions but a generic reference could still trigger catalog search before selection was clarified.

Implemented:
- Signed social checkout explicitly allows an absent guest email. Public website checkout retains its existing requirement. No invented email is stored. Buyer email job is suppressed without an address; contact phone remains required. Loyalty consent remains separate and never silently changes an agreed price.
- Missing postcode resolves from a unique courier dictionary town. Ambiguous names require locality clarification, not a guessed postcode. Email draft orders also use this resolver; email replies remain drafts.
- Facebook support notifications resolve Meta's conversation `link`, using the returned inbox identity instead of the PSID. Include a clickable Business Suite link and an authenticated SPC panel fallback for the exact conversation. Link failure must not block the support notification. Instagram currently uses the exact SPC panel fallback.
- Before preparing a complaint, check existing open cases for the purchased SKU. ERP repeats this check under the order row lock, including cases entered manually or via email. Return the existing number and route supplements to support; do not increment counters or queue duplicate receipts. Closed cases do not prevent later claims. Existing duplicate records are not deleted.
- Resolve ambiguous collage references before product search. Positional choice identifies an object, not a SKU. Candidate tool compares its description with up to six public catalog photos and returns only catalog SKUs, at most three; present candidates and require customer confirmation. Missing/ambiguous matches request a crop or support. No source image bytes or signed Meta URLs are persisted in conversation state.

Validation: synthetic actual-model sales and staff order flows without email/postcode passed, with zero real writes. Ambiguous two-chair image asks which position. Synthetic image smoke identifies top object and only prepares checkout after product confirmation. Relevant ERP tests, service tests and production Next build passed. Normal Windows npm build hits existing POSIX shell conditional; direct Next build verified separately.

Open verification: user has not yet identified the specific duplicate complaint. Business Suite mobile application routing requires a check on the colleague's phone; resolved web conversation identity was verified read-only through Meta. No claim that every mobile OS opens the native app automatically.
