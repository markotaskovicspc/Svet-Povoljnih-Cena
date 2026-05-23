# Mobile Comments V3

## Summary

Fix all 40 mobile comments as one mobile-polish pass across homepage, navigation, listing cards, PDP, cart/checkout, auth, pricing, vouchers, and content/admin data. The PDF had 40 visible numbered comments and no hidden annotation bubbles.

Key decisions:

- Loyalty pricing will be admin-managed per product.
- PDP extra information will be admin-managed per product.
- Typo fixes cover both visible UI labels and product-import copy.

## Key Changes

### Badges And Mini Banners

Comments: 1, 2, 11, 12, 17, 19, 31, 38

- Create one shared badge rule/helper used by product cards, PDP gallery, section headers, and action labels.
- Product image badge placement:
  - Top-left max 2 badges, priority: `Trajno niska cena`, `Heroj meseca`, discount percent.
  - Bottom-left max 1 badge, priority: `Dok traju zalihe`, `Novo`.
  - All other commercial/action mini badges appear only next to the action/section name.
- Rename every customer-facing limited-quantity label to `Dok traju zalihe`; keep internal DB fields if useful, but display text changes everywhere.
- Remove discount percent pills beside prices on cards/PDP price blocks; discount remains only as the image mini badge.
- Add/normalize badge art and colors, including changed `Trajno niska cena` color and `Sve do 999`.

### Homepage, Header, Footer

Comments: 3, 4, 5, 6, 7, 13, 14, 15, 20, 21, 22

- Render the four admin-controlled shortcut banners immediately below the main hero carousel using the first four active admin tabs by order.
- Increase mobile homepage logo by roughly 50% and use the same mobile logo size consistently in header, menu, and footer.
- Add account/login icon to the mobile header beside wishlist/cart.
- Ensure the area above the shortcut strip is white and product image/card backgrounds are clean white.
- Reduce homepage rail product card visual size by about 25%, then standardize card dimensions across rails and listing grids.
- Make the whole `Niske cene pod trajnom zaštitom` banner clickable and keep its title/subtitle/CTA text editable through admin banners.
- Standardize the two promo/editorial banner dimensions to match the first banner style.
- Leave footer link copy structurally ready; client said final link text comes later.

### Mobile Navigation And Categories

Comments: 8, 9, 10

- Change top category tiles in mobile menu to two per row.
- Change category tap behavior: tapping a parent category opens its groups/subcategories instead of navigating immediately; keep `Pogledaj sve` for direct category navigation, matching desktop behavior.
- Enlarge and clarify the menu logo so it matches the homepage header logo.

### Listing And Product Cards

Comments: 16, 18, 23, 24, 29, 30, 39

- Keep sort label as `Podrazumevano` everywhere and verify no old label remains.
- On every multi-product view, remove dimensions from cards.
- Add a reserved attribute row under product title; initially show color swatches/options there when available, otherwise keep the row empty to preserve layout.
- Add IKEA-style color options from product color fields/variants.
- Move/widen `Dodaj` on mobile cards so it sits cleanly beside the badge/price area where intended and can expand like desktop.
- Reduce vertical spacing between attribute row and price.
- On mobile product cards, support horizontal image swiping when multiple images exist; desktop keeps hover image swap.

### Product Detail Page

Comments: 29, 30, 32, 33, 34, 35, 36, 37, 38

- Convert PDP gallery mobile behavior to horizontal swipe/scroll carousel with dots/arrows similar to main hero.
- Keep dimensions visible on PDP only.
- Place `Dodaj u korpu` directly below price on PDP mobile and desktop.
- Normalize PDP benefit chips to one visual format.
- Replace long product description with first three sentences plus links: `Uslovi isporuke`, `Deklaracija`, `Uputstvo za sastavljanje`, `Kako održavati`.
- Add admin product fields for those PDP info sections; clicking a link opens a modal/overlay with the clicked section expanded and the others collapsed.
- Add loyalty price/admin discount fields for non-sale products; price display becomes unified:
  - Sale item: full price + active sale price.
  - Non-sale loyalty item: full price + loyalty price.
  - Discount badge on image calculates against sale or loyalty price.
- Fix mojibake and spelling in UI and imported product copy.

### Cart, Checkout, Auth, Vouchers

Comments: 25, 26, 27, 28, 40

- Remove inline `Predlog kupovine` from the cart drawer/page summary.
- Show `Predlog kupovine` as a modal when user clicks `Pregled korpe` or `Plati`, then continue to the intended destination.
- Replace placeholder social icons with original Google, Apple, and Facebook marks wherever auth/social login appears.
- Fix login and registration flows end to end: credentials, OAuth provider availability, callback URLs, error states, and customer session redirects.
- On registration page, show Google / Apple / Facebook registration first, then email/password form.
- Replace mocked voucher math in checkout store with the real `/api/voucher/validate` plus shared pricing engine result so voucher discount is calculated once and shown consistently in cart, checkout summary, review, and submitted order.

## Interfaces And Data Changes

- Add product/admin fields for loyalty pricing: `loyaltyPrice` or `loyaltyDiscountPct`, exposed through product DTOs and admin product form.
- Add product/admin fields for PDP info sections: delivery terms override, declaration, assembly instructions, maintenance content/URL.
- Add or derive permanent-price action metadata so `Trajno niska cena` is reliable in badge logic.
- Keep existing routes where possible; if a customer-facing URL/label uses `Ograničena ponuda`, add a redirect or alias while displaying `Dok traju zalihe`.

## Test Plan

- Run lint/build after changes.
- Add unit tests for badge priority/placement, effective sale/loyalty price display, and voucher discount totals.
- Mobile visual QA at 360px, 390px, and 430px for homepage, menu, category listing, promo listing, PDP, cart drawer, cart page, checkout, login, and registration.
- Manual flows:
  - Category menu parent opens groups, and `Pogledaj sve` navigates.
  - Product image swipes work on PDP and card galleries.
  - Cart suggestion modal appears on `Pregled korpe` and `Plati`.
  - Voucher discount updates totals correctly.
  - Registration social buttons appear first and login/register complete successfully.

## Assumptions

- The four shortcut banners below the hero are the first four active admin tabs by order.
- `Dok traju zalihe` is the customer-facing replacement for all old limited-quantity wording.
- Loyalty pricing will be admin-managed per product, not a fixed global percentage.
- PDP extra info content will be admin-managed per product.
