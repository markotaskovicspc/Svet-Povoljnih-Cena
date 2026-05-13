# Fix Mobile Search Results

## Summary

Fix the real root cause: on mobile, results are rendered but visually covered by the sheet backdrop because the search sheet behaves like a short top drawer. Also switch instant search to the real search API so live/admin/XML products can appear, not only mock products.

## Key Changes

- In the real repo root `/Users/luka/svet povoljnih cena`, update `InstantSearch` to support two presentations:
  - Desktop: current floating dropdown.
  - Mobile: inline/fullscreen result list below the input, not absolutely positioned.
- Update the mobile search sheet in `MobileNav` to be truly fullscreen:
  - use important full-height/full-width classes where needed, matching existing sheet patterns.
  - keep results inside the sheet content flow so the backdrop cannot cover them.
  - close the search sheet after selecting a product or "view all".
- Replace mock-product search in the header with `/api/search/suggest?q=...&limit=6`.
  - Keep the current 3-character minimum and 150ms debounce.
  - Use `AbortController` so fast typing does not show stale results.
  - Keep loading and empty states.
- Fix navigation:
  - Product hit route becomes `/p/${slug}`.
  - "Vidi sve rezultate" remains `/pretraga?q=...`.
  - Add a `/pretraga` page so that link resolves and shows matching products from the real search layer.

## Public Interfaces

- Add/adjust `InstantSearch` props:
  - `presentation?: "dropdown" | "inline"` with desktop default `"dropdown"`.
  - `onNavigate?: () => void` so mobile can close the sheet after navigation.
- Introduce a shared search hit type outside server-only files, reused by the API route and client component.

## Test Plan

- Desktop browser:
  - Type `luna`; product suggestions appear below the desktop search bar.
  - Click a product; URL goes to `/p/bastenska-garnitura-luna-l4200`.
  - Press Enter on a highlighted result and verify same behavior.
- Mobile browser at ~390px width:
  - Tap search icon, type `luna`; results appear directly under the input inside the fullscreen sheet.
  - Verify the blurred page/backdrop no longer covers the result list.
  - Tap a result; sheet closes and navigation succeeds.
- Search page:
  - Visit `/pretraga?q=luna`; matching products render.
  - Visit with fewer than 3 chars; show a clear minimum-character empty state.
- Run `npm run lint` and a production build if available.

## Assumptions

- The actual app root is `/Users/luka/svet povoljnih cena`; the currently opened `/Users/luka/svet povoljnih cena/svet akcija` folder is empty.
- Real API search is the desired source of truth.
- Mobile should use the recommended fullscreen inline-results UX, not a floating dropdown.
