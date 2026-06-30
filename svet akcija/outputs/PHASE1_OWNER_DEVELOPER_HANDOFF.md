# Phase 1 Owner/Developer Handoff

## Store Owner Inputs

The owner must provide or confirm these values before a SKU is launchable:

- SKU-level stock quantity. Missing stock blocks import; zero stock imports as unavailable.
- Optional SKU-level catalog availability (`dostupnost`, `active`, `online`, `objavi`) when a product should stay offline even if stock exists.
- Current regular price and approved sale price.
- At least one usable product media URL per SKU for the manual import path.
- Real product description text. Git LFS pointer text is rejected.
- Barcode, brand/collection, primary color, and secondary color where available.
- Current promotion dates and business-policy content for shipping, returns/reclamations, privacy, terms, contacts, and company/fiscal details.

## Developer Controls Implemented In Phase 1

- Manual import reads owner-provided stock and optional catalog availability.
- Missing stock, invalid prices, missing required media URL, broken LFS descriptions, duplicate SKUs, and invalid core catalog fields are blocking validation issues.
- Zero stock and owner-disabled SKUs are preserved as owner data, but imported inactive instead of being published.
- Import reports include owner-action warnings for barcode, brand/collection, and color gaps.
- Product cards and PDP add-to-cart controls disable purchase for unavailable products before checkout.
- Admin product reporting now exposes launch-readiness filters and counts for owner-data issues.

## Admin Review Entry Point

Use `/admin/proizvodi?status=needsownerdata` to review SKUs that still need owner-supplied launch data.
