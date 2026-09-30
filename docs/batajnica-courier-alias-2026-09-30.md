# Batajnica courier address resolution

The active X Express dictionary returns no town for Batajnica or 11273. Its official Stevana Dubajića street is under active town 791059, Beograd (Zemun); street record 4950 (provider street ID 81286). The bot therefore rejected an otherwise complete order before ERP quotation.

The location API now exposes Batajnica (11273) as an explicit alias of that verified active provider town. Exact provider records take precedence if the dictionary later adds Batajnica. Missing/inactive parent records cannot yield fabricated IDs. Partial Latin names, Cyrillic and the postal code are searchable. The general city list also includes Batajnica.

Chat address matching accepts the API's explicit locality aliases and keeps strict postcode and uniqueness checks. Checkout retains Batajnica/11273 on the order, buyer snapshot and saved address while using the real courier town ID. ERP shipping-address edits recognize the same mapping, after first attempting an exact dictionary match.

Validation: 32 route/alias/shipping/social tests, 11 relevant chatbot tests and 7 checkout failure/isolation tests passed, including actual mocked checkout persistence of the customer locality with the courier ID. Standard Windows build passes Prisma and checkout checks, then encounters the pre-existing POSIX shell conditional. Production build and deployment verification recorded in the external status log.

No dictionary records, courier IDs or existing orders are rewritten by this change. The separately authorized Vesna order was completed once through the existing signed operator endpoint, with delivery instructions retained and no Messenger send.
