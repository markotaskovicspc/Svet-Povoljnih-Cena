# Client video review — 2026-08-17

Source: `btx-espa-zka (2026-08-17 18_52 GMT+8).mp4`  
Duration: 16:57  
Review method: four audio chunks, timestamped Serbian transcript, and 34 screenshots at 30-second intervals.

## What the client approved

1. **The receipt header is the accounting source of truth** (`00:23–00:59`). Purchase-order amounts are projections; the final line COGS calculation must use the actual values entered on the receipt header (`02:57–03:24`).
2. **Related costs must be allocated by item volume** (`01:07–01:18`). If any item has no usable volume, posting must be blocked. Volume comes from full-container quantity first, otherwise from transport-package quantity and dimensions (`01:18–01:29`).
3. **The COGS correction/variance remains informational** (`02:42–03:24`). It is useful for measuring projection error, but must not replace or distort the final receipt figures used per item.
4. **Enter the invoice in its original currency** and select the currency plus the final/middle exchange rate (`03:55–04:14`, `06:14–06:27`). Customs and transport stay entered in RSD (`06:29–06:35`).
5. **Allocate the actual customs total proportionally to theoretical customs by line** (`11:30–12:54`): calculate each line's goods value × customs rate, total those theoretical amounts, then spread the customs authority's actual assessed total in the same proportions.
6. **Transport and all other related costs use volume** (`12:54–13:22`).
7. **Restore the previous product color/variant workflow** (`16:10–16:31`). After comparing the new linking/draft-SKU choices, the client explicitly chose the old interface.

## Repository findings and execution scope

- The current `main` already used actual header totals for line COGS, allocated actual customs proportionally by theoretical customs, and restored the legacy color-family interface.
- The remaining gaps were: original-currency invoice entry, forcing other related costs to volume, and hard-blocking posting when volume is missing.
- Implementation therefore targets those gaps and preserves the already-correct accounting behavior.

## Transcript files

The transcript is automatic and retains unclear spoken fragments rather than silently inventing wording. Use the SRT files for timestamps and the TXT files for quick reading:

- `transcript/part-01.srt` / `part-01.txt` — `00:00–05:00`
- `transcript/part-02.srt` / `part-02.txt` — `05:00–10:00`
- `transcript/part-03.srt` / `part-03.txt` — `10:00–15:00`
- `transcript/part-04.srt` / `part-04.txt` — `15:00–16:57`

Visual index: `contact-sheet.jpg`; individual screenshots are in `screenshots/`.
