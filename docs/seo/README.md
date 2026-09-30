# SPC SEO cleanup — 2026-09-30

## Scope and baseline

The public audit found 124 main-store product SKUs, not 3,281 public product pages. The latter was the ERP article-list count. There were also 209 legacy `/svet-akcija/{sku}` URLs, including 34 overlapping SKUs. The initial sitemap contained 241 URLs, including 70 empty category/collection listings.

`catalog-worklist-2026-09-30.json` lists all 124 main-store products. Ten have pilot drafts in `pilot-2026-09-30.json`; the other 114 await editorial work. The user approved the pilot style on 2026-09-30. The GLASS MATE X and PURE STEAM PRO placeholder descriptions were replaced through the ERP with short descriptions using only the existing name, colour and dimensions. Seven other drafts are ready for review; BELLA has conflicting 12 L / 2 L capacity data and remains NEEDS_FACTS. Individual proposed meta descriptions remain drafts. POMPEA composition is omitted until the elastin/elastan declaration wording is confirmed.

## Technical changes

- Product titles no longer embed conditional/volatile prices. Metadata uses the model, colour and non-placeholder dimensions instead of the ERP item-type field. Imported free-form attributes are not automatically promoted into metadata.
- Product breadcrumbs use stored category paths. Old unique short category links redirect permanently to their full path.
- Main-store matches in the legacy catalogue redirect to the current product. Remaining legacy pages are noindex, follow and excluded from the sitemap.
- Empty categories, collections and simple product-list landing pages are noindex, follow and excluded from the sitemap. They are not deleted. Database failures propagate instead of being cached as empty inventory.
- Search results are noindex, follow. Listing and campaign pages have canonical URLs. Ignored listing query parameters use the base canonical.
- Plain-text previews decode visible HTML entities; exact internal description placeholders are hidden from the customer-facing description and replaced with basic structured facts.
- No changes to prices, discounts, stock, checkout, schema, migrations or supplier-availability policy. `ENFORCE_WEB_AUTO_AVAILABILITY=false` remains unchanged.

## Validation and release

31 tests passed across SEO routes/helpers, sitemap, rich text and checkout isolation. Next production compilation and its TypeScript check passed. Email PDF assets were verified in checkout/background bundles. Pilot HTML was checked at 1,400 px and 390 px without overflow.

The normal `npm run build` includes `db:deploy:production`. Local validation invoked Next directly after automatic review rejected an unapproved production migration step. Both Vercel previews subsequently built successfully using the standard build, which skips migrations outside production. The user explicitly approved production publication including the existing migration step on 2026-09-30. This SEO change adds no migrations.

The second preview returned 169 sitemap URLs, including all 124 products and none of the 70 previously empty listings. Smoke checks confirmed product metadata, canonical URLs, noindex rules, and HTTP 308 redirects for `/k/radna-soba` and `/svet-akcija/110082`. Three local daily audit runs succeeded; the final unchanged run reported zero new findings and zero changed product facts.

The broader standalone `tsc --noEmit` reports pre-existing test typing errors; the Next production build's TypeScript validation passes. Do not claim the whole unrelated test suite is clean.

## Daily audit and editorial queue

Run `node scripts/seo-daily-audit.mjs` from this checkout. It needs network access to the public SPC site but no credentials. It reads sitemap URLs, checks public product content through the existing lookup API in batches of at most 50, and checks a rotating sample of 20 rendered sitemap pages plus three regression URLs. Requests are paced. It does not write to the website or call an external AI service.

Results and fact snapshots are saved under ignored `tmp/seo-daily/`. `latest.json` is the latest attempt; `latest-complete.json` is replaced only when collection succeeds. Completeness refers to that run's declared coverage, not a full rendered crawl. Every report gives the number of product facts and rendered pages checked. Unknown new product URLs are prioritized; if a bound leaves unknown SKUs, the run is marked incomplete.

Use the installed `spc-humanize` skill for drafts. Keep SKU, family, source hash, before/after text, fact ledger and READY_FOR_REVIEW or NEEDS_FACTS. Group actual model variants; do not spin synonyms. Do not turn vague or contradictory data into confident claims. The pilot style is approved; continue batches of at most ten pending descriptions per daily run. Keep draft preparation separate from publishing. Audit flags indicate review candidates, not proof of AI authorship or plagiarism.

Local Codex scheduling requires the computer and desktop app to be running. Report meaningful new findings, completed draft batches or access failures; avoid repeated unchanged alerts.

## Still separate work

- Review and publish the pilot, then work through the other 114 products by real product family.
- Resolve missing specifications and contradictions with product documentation.
- Review the stale campaign slug/title mismatch in CMS and the original editorial content of category and company pages.
- Verify production output after deployment and compare it with the initial audit.
- Search Console indexing/performance and field Core Web Vitals were not verified by the public crawl. External phrase overlap does not establish plagiarism or an originality percentage.
