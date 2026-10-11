# Ananas fiscal inventory

Business rules confirmed by Stefan/Marko on 2026-10-11: use the separate warehouse named Ananas, start at 2025-06-01 Europe/Belgrade, no prior sales debits have been posted, allow temporary negative Ananas stock while 2025 receipts are entered, and credit refunds immediately.

The existing fiscal API mirror is retained. `AdminSetting[ananas-inventory]` enables posting and records the source-history checkpoint and short processing lease. Settings are disabled until explicitly enabled in the Ananas admin page. The negative-stock checkbox can be switched off without deleting or reapplying any historical movement.

Each fiscal document locks its row and posts all merchandise SKUs atomically. Delivery and assembly services do not move inventory. Unmapped/deleted SKUs or a failed debit leave the entire document unposted with a visible error. Ananas document ID plus SKU is the movement idempotency key. A stored quantity fingerprint prevents changed provider content from silently rewriting an already posted document. Repeated imports and concurrent attempts cannot consume stock twice.

Movements carry the original fiscal date; `inventoryPostedAt` records the actual posting time. Negative stock is allowed only for this Ananas caller and warehouse. Ordinary sales still require sufficient stock in their selected warehouse. The aggregate can be negative because of Ananas debt; it must not block an adequately stocked DC. If a legacy product has no warehouse rows, its existing quantity is preserved in DC and Ananas starts at zero.

History advances in seven-day source intervals, internally fetched using the existing bounded three-day API requests. The browser runner continues from its checkpoint, and the authenticated five-minute cron resumes after interruption. Each invocation first drains a bounded queue of unposted documents, then fetches another source interval. Errors rotate through retries and appear in the admin view; they do not imply complete reconciliation. The source checkpoint and posted/pending counts are separate indicators.

Once receipts are complete, clear “Privremeno dozvoli minus” and save. To pause all posting, clear “Automatsko knjiženje”. These switches preserve documents, movements, and the history checkpoint. The additive migration has no destructive rollback; disable posting to stop further changes. Corrections to already posted quantities require explicit compensating ledger entries rather than deleting movement evidence.

Verification includes real PostgreSQL concurrent replay, Ananas debit/refund, receipt recovery, strict stock after disabling minus, missing-SKU rejection, and preservation of DC stock and ability to sell from DC.
