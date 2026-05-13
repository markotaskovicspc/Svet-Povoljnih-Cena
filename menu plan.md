# Desktop Category Menu And Missing Pages

## Summary
- Use the real app root: `/Users/luka/svet povoljnih cena` because `/Users/luka/svet povoljnih cena/svet akcija` is currently empty.
- Keep the existing Next 16 App Router pattern and use the already-present `/k/[...slug]` category listing route for all missing category pages.
- Rebuild the desktop menu to match photo 1: blue header, fixed left “AKTUELNO” column, clean right category/subcategory area, no text overlap, smooth open/close, keyboard-accessible links.
- Replace the category tree with the exact structure from photo 2 and add small dummy product coverage so every linked category page renders with products.

## Key Changes
- Update `primaryNav` in `src/data/site.ts` so every category/subcategory links to `/k/...` slugs, not direct broken paths like `/nameštaj`.
- Model the photo 2 taxonomy:
  - `Nameštaj`: Baštenski nameštaj, Kancelarija, Trpezarija, Dnevna soba, Predsoblje, Gejming, Spavaća soba.
  - `Sve za kuću`: Bazeni, Alat, Rasveta, Čišćenje i održavanje, Dekoracija, Kupatilo, Tepisi.
  - `Kućni aparati`: Kafe aparati, Lepota i nega, Hlađenje i grejanje, Priprema hrane, Kuvanje i pečenje, Pegle, Usisivači, Prečišćivači vazduha, Aparati za vodu.
  - `Moda i putovanja`: Ženske torbe, Ženske čarape, Aksesoari, Koferi.
- Refactor `src/components/layout/desktop-menu.tsx` into a wide, stable two-panel drawer:
  - Left panel width around 360-420px on desktop, matching photo 1 proportions.
  - Right panel uses a responsive grid/table-like category layout with top-level category labels and child links.
  - Preserve the existing `Sheet` behavior but override width/height, scrolling, close button placement, focus states, and spacing so long Serbian labels wrap cleanly.
- Add dummy products in `src/data/products.ts` with realistic names, prices, dimensions, stock, and Unsplash placeholder images.
  - Add at least one product per linked leaf subcategory.
  - Ensure parent category pages also work because `/k/[...slug]` matches descendant category paths.
- Do not create separate static route files for each category; `/k/[...slug]` remains the single category page system.

## Interfaces
- No new public route API beyond existing `/k/[...slug]`.
- `NavNode` stays compatible unless the implementation benefits from an optional display field such as `featured?: boolean`; default plan is no type change.
- Product dummy data must use existing `Product.categoryPath` strings so category matching continues to work without changing `src/app/(shop)/k/[...slug]/page.tsx`.

## Test Plan
- Run `npm run lint`.
- Run `npm run build`.
- Start `npm run dev` and verify in browser:
  - Desktop menu opens at desktop widths without overlapping text.
  - Left “AKTUELNO” links remain usable.
  - Right category/subcategory grid matches the photo 2 structure.
  - Each menu link opens a non-empty listing page.
  - Mobile navigation still works and is not visually regressed.
  - Check at desktop, tablet, and mobile widths.

## Assumptions
- Chosen URL style: `/k/...`, as confirmed.
- Dummy products are acceptable as temporary mock catalog data until real XML/admin data replaces them.
- The desktop menu should visually follow photo 1, but fix the broken overlap shown in the screenshot rather than reproducing it.
