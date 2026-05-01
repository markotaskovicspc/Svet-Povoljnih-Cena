# Plan: Svet Povoljnih Cena — Premium Furniture Ecommerce (Detailed) — v1

Build www.svetpovoljnihcena.rs as a premium-feeling furniture web shop covering every requirement in the spec. UI-first, then backend, integrations, admin. Stack: Next.js 15 (App Router) + TS + Tailwind + shadcn/ui + Framer Motion + Lenis. Backend: Postgres + Prisma + NextAuth. Language: Serbian Latin. Premium feel via warm typography, generous whitespace, soft shadows, subtle motion — no heavy WebGL.

---

## DESIGN SYSTEM (Premium look — applies across all phases)

**Mood:** editorial furniture catalog meets boutique ecommerce (think Otto.de × Norr11 × HAY).

1. **Color tokens** (Tailwind theme extension)
   - `bg.canvas` ivory `#FAF7F2`, `bg.surface` `#FFFFFF`, `bg.muted` `#F1ECE3`
   - `ink.900` charcoal `#1A1714`, `ink.700` `#3B342D`, `ink.500` `#6B6259`, `ink.300` `#A89F94`
   - `accent.walnut` `#6B4423`, `accent.olive` `#7A8450`, `accent.sand` `#D9C9A8`
   - `action.red` `#D7263D` (akcijska cena, per spec — must be red)
   - `state.success`, `state.warning`, `state.danger`, `state.info`
2. **Typography**
   - Display: Fraunces (variable serif) — H1/H2, hero quotes, section headers
   - Body: Inter (variable) — paragraph, UI, prices
   - Mono: JetBrains Mono — SKU, order numbers
   - Type scale 1.250 ratio; line-height 1.55 body, 1.15 display; tracking -0.02em on display
3. **Spacing & layout**
   - 8px base; container max 1440px; content max 1280px; reading max 72ch
   - Generous section padding (96–160px desktop, 48–80px mobile)
4. **Elevation & surfaces**
   - 5-step soft shadow scale (warm-tinted, not pure black)
   - Radii: 4 / 8 / 16 / 24; cards usually `rounded-2xl`
5. **Motion language** (Framer Motion)
   - Easing: `[0.22, 1, 0.36, 1]` (out-quint) for entrances; `[0.83,0,0.17,1]` for emphasis
   - Durations: 200ms (UI), 400ms (cards), 700ms (sections)
   - Hover: 1–2° tilt + 4–8px lift on product cards
   - Scroll-reveal: `whileInView` once, 12px Y offset, opacity 0→1
   - Lenis smooth scroll (lerp 0.1, wheel multiplier 1)
   - Always wrap in `prefers-reduced-motion` guard
6. **Imagery rules**
   - 4:5 portrait for product cards, 16:9 for banners, 1:1 for thumbs
   - Soft gradient floor under floating product images
   - next/image with blurDataURL placeholders
7. **Iconography:** lucide-react, 1.5px stroke
8. **States:** every interactive has hover, focus-visible (2px accent ring), active, disabled, loading (shimmer)

---

## PHASE 0 — Foundations & scaffold

1. `create-next-app@latest` — App Router, TS, Tailwind, ESLint, src/, alias `@/*`
2. Install deps: `framer-motion`, `lenis`, `zustand`, `zod`, `clsx`, `tailwind-merge`, `lucide-react`, `class-variance-authority`, `next-themes` (optional dark mode later), `@hookform/resolvers`, `react-hook-form`
3. Initialize shadcn/ui; pre-add: button, input, sheet, dialog, dropdown-menu, accordion, tabs, badge, separator, tooltip, toast (sonner), skeleton, scroll-area, command (for search), form, label, checkbox, radio-group, select, slider
4. Configure `next/font` for Fraunces + Inter; set CSS variables
5. Tailwind config: extend colors, fontFamily, boxShadow, borderRadius, container, animation
6. Add global providers in `app/layout.tsx`: LenisProvider, MotionConfig (reducedMotion="user"), Toaster, CartProvider (Zustand hydration)
7. Folder structure
   - `src/app/(shop)/` — home, listings, PDP, search
   - `src/app/(account)/nalog/` — profile, orders, wishlist, reclamations, addresses, cards
   - `src/app/(checkout)/checkout/` — korpa, podaci, placanje, potvrda
   - `src/app/(content)/` — kontakt, o-nama, uslovi-isporuke, uslovi-kupovine, pomoc, servis, reklamacije, komentari
   - `src/app/admin/` — admin panel (gated)
   - `src/components/{layout,product,cart,checkout,account,admin,ui,motion,forms}`
   - `src/lib/{api,auth,pricing,xml,email,format,hooks}`
   - `src/data/` — JSON mocks for Phase 1–2
   - `src/types/` — domain types
8. Define **TS domain types** mirroring future XML feed:
   - `Product` (sku, name, slug, group, collection, categoryPath[], description, dimensionsCm {w,d,h}, materials[], pictograms[], stock, incomingStock, supplierStock, isHero, isNew, newUntil, isLimited, isDtz, fullPrice, salePrice, discountPct, action {name, startsAt, endsAt, isHero}, deliveryDays, allowsAssembly, assemblyCities[], media {images[], video?, video3d?}, recommendedSkus[], frequentlyBoughtSkus[])
   - `Category`, `Banner`, `PromoBar`, `Tab`, `Pictogram`, `DeliveryRule`, `User`, `Address`, `Order`, `OrderItem`, `Voucher`, `Reclamation`, `WishlistItem`, `BackInStockAlert`, `AdSlot`
9. ENV scaffolding (`.env.example`): DATABASE_URL, NEXTAUTH_*, GOOGLE/APPLE/FB IDs, WSPAY_*, COURIER_*, RESEND_KEY, VIBER_*, CLOUD_BASE_URL, EFISKAL_*, GMERCHANT_*, META_*

---

## PHASE 1 — Premium UI on mocked data

### 1A. Global chrome

1. **Promo bar** (top of every page)
   - Editable text + link (admin field)
   - 72h countdown badge appearing only when `endsAt - now ≤ 72h`
   - Toggle "no bar" mode in admin
   - Subtle gradient background, dismissible (stored in localStorage), reappears on next session
2. **Header (desktop)**
   - Row 1: logo (left), instant-search (center, max 640px), right cluster: Login, Wishlist (heart, count badge), Cart (bag, count + animated wiggle on add)
   - Row 2: Primary nav tabs (Akcija / Nedeljna akcija / Heroji meseca / Ograničena ponuda — admin-driven, max 4)
   - Sticky on scroll, blur backdrop + soft shadow appears after 16px scroll
3. **Header (mobile)**
   - Hamburger (left), logo (center), search-icon + cart (right)
   - Hamburger sheet: 2–3 level nav, smooth nested transitions, current category highlighted
4. **Instant search**
   - Triggers at ≥3 chars, debounced 150ms
   - Sort within results: Heroji meseca → najveći popust → najniža cena
   - Result row: thumb, name, category breadcrumb, akcijska cena
   - Keyboard nav (↑↓, Enter), Cmd-K opens
   - "Vidi sve rezultate" → `/pretraga?q=...`
5. **Footer**
   - 4-column link grid: Kontakt, O nama, Uslovi isporuke, Korisnički nalog, Pomoć, Servis za kupce
   - Logo block, newsletter inline form, social row (FB, IG, TikTok)
   - Bottom strip: clickable payment-method icons (Visa, Master, Dina, IPS, Apple Pay, Google Pay)
   - Copyright + legal microlinks
6. **Newsletter band** (above footer): editorial layout, single email input + CTA, soft success state

### 1B. Home page

1. Hero **banner carousel**
   - Full-width, 16:9 desktop / 4:5 mobile
   - Arrows + dots + swipe; loops infinitely both directions
   - Autoplay 6s, pause on hover/focus, respects reduced-motion
   - Each slide: image + headline + subhead + CTA + click-through URL
   - Subtle Ken-Burns zoom on active slide; crossfade between slides
2. **Tabs strip** under hero (max 4 admin-controlled tabs); mobile = 2×2 grid
3. **Section: Heroji meseca** — section title + "Prikaži sve →"; horizontal snap rail of product cards
4. **Section: Mesečna akcija** — same pattern
5. **Section: Nedeljne akcije** — same pattern
6. **Section: Ostali tabovi** — one rail per remaining tab
7. **Editorial banner** between rails (full-bleed, copy + CTA) — admin-managed
8. **USP strip** (delivery, returns, secure pay, support) above footer
9. **Newsletter + social** before footer

### 1C. Product card (the workhorse)

1. Vertical layout, `rounded-2xl`, `bg-surface`, soft shadow, hover lifts + 2° tilt
2. Image: 4:5, soft floor gradient, blur placeholder
3. Badge stack (top-left, vertically stacked, max 3 visible + "+N"):
   - Auto `-{discountPct}%` (always when on sale)
   - "Heroj akcije" (gold)
   - Action name (e.g., "Black Friday")
   - "Novo" (olive)
   - "Ograničena količina" (amber)
   - "Dok traju zalihe" (red, when isDtz && stock < 15)
4. Wishlist heart top-right
5. Body: name (2-line clamp), dimensions ŠxDxV cm (mono, muted)
6. Price block: stara cena (ink.500, strikethrough) → akcijska cena (action.red, bold), discount pill
7. Microcopy: "Akcija do 30.06." + "Isporuka 3–5 dana"
8. Footer row: cart icon button (turns into qty stepper on add)
9. Skeleton variant for loading
10. Hover preview: secondary image swap + subtle scale

### 1D. Listing pages (Akcija, Nedeljna, Heroji, Outlet, Novo, kategorija)

1. Page header with title, subtitle, action period banner
2. Breadcrumbs
3. **Filter sidebar** (left desktop sticky / mobile sheet)
   - Fixed filters always: cena (slider), boja (swatches), materijal, dimenzije ŠxDxV (3 sliders), dostupnost
   - Per-group dynamic filters from XML (e.g., "broj vrata" for ormari)
   - Multi-select chips above grid showing active filters with × remove
4. Sort dropdown: podrazumevano / cena rast / cena opad / % popusta (right-aligned)
5. Result count + view toggle (3-col / 4-col)
6. Grid: responsive 2/3/4 columns
7. Pagination logic: 300 per page, "Učitaj još" button (cursor-based) + scroll-restore on back
8. Empty state with helpful copy + reset filters CTA
9. **"Novo" page extra:** sub-tabs row of category prostorija (from hamburger XML); sort logic = longest remaining "novo" status first
10. Default sort for akcija pages: Heroji meseca → % popusta → niža cena (admin can override via drag-reorder)

### 1E. Product Detail Page (12 rows from spec)

1. **Row I — Breadcrumbs:** Nameštaj / Police / Otvorene police / BS-N2212 (each level clickable)
2. **Row II — Hero info pair (desktop split, stacked mobile)**
   - Left: gallery
   - Right: name, short description, full MPC (black), akcijska MPC (red), discount %, period važenja popusta sentence
3. **Row III — Gallery / badges**
   - Main image with magnify-on-hover + lightbox click
   - Badges overlay top-left (same logic as card)
   - Right: vertical thumb strip (images, video icon, 3D icon)
4. **Row IV — Media extras:** primary image gallery + video player + 3D viewer slot (placeholder iframe in v1, real player in Phase 4); sourced by SKU pattern from cloud
5. **Row V — Pictogram strip:** icons + small captions; pulled from cloud, list from XML
6. **Row VI — Description:** rich text from cloud
7. **Row VII — Dimensions:** table (Širina / Dubina / Visina cm) + simple SVG diagram
8. **Row VIII — Materials:** photo strip with captions
9. **Row IX — Delivery & assembly**
   - Rok isporuke (admin-defined global)
   - City picker (autocomplete from address book if logged in) → shows whether kamionska + montaža available
   - Cenovnik kurirska / kamionska / montaža (admin)
10. **Row X — Često kupovano zajedno:** rail of items in same `collection`
11. **Row XI — Slični artikli:** rail of items in same `group`
12. **Row XII — Sticky add-to-cart**
    - Always-visible bottom bar on mobile, sticky right column on desktop
    - Qty stepper, "Dodaj u korpu", "Pregled korpe" link (Videnov-style)
    - Auto-hide if `stock=0 && incomingStock=0` (and product itself becomes inaccessible per spec — return 410 from product route)
13. **PDP polish:** parallax on hero image, fade-in sections on scroll, shared-layout transition from card image to PDP image

### 1F. Cart & wishlist UX (Zustand, localStorage-persisted)

1. **Add-to-cart flow**
   - Click "Dodaj u korpu" → button morphs into qty stepper (Framer layout animation)
   - Toast appears bottom-right with thumb + "Pogledaj korpu" CTA
   - **Predlog kupovine modal** (Otto-style): defined per group in admin, 3–6 cross-sell items in a horizontal rail
2. **Mini-cart drawer** (Sheet from right): items, qty editors, subtotal, ušteda, "Pregled korpe" + "Plati" CTAs
3. **/korpa page** (full pregled korpe)
   - Item rows: thumb, name, price (regular + akcijska), qty stepper, remove
   - Right rail: subtotal, ukupna ušteda (highlighted), delivery placeholder, voucher input, total
   - "Nastavi ka podacima za isporuku" CTA
4. **Wishlist** (drawer + `/nalog/lista-zelja` page)
   - Login-gated; mock for now
   - "Obavesti me kad bude na akciji" toggle per item
   - "Obavesti me kad bude na stanju" toggle per item

### 1G. Static content pages (Phase 1 to validate IA)

`Kontakt`, `O nama`, `Uslovi isporuke`, `Pomoć`, `Servis za kupce` (hub linking to Reklamacije / Uslovi kupovine / Komentari i sugestije), `Politika privatnosti` — all skinned with editorial layout, mock copy.

### 1H. Motion polish pass

1. Page transitions (Framer `AnimatePresence` on route changes — fade + 8px slide)
2. Shared element: card image → PDP image (`layoutId`)
3. Stagger children on rails first reveal (0.05s)
4. Cursor-follow hint on draggable rails (subtle)
5. Marquee for partner/payment logos in footer (slow, pauses on hover)
6. Scroll progress bar at top of long content pages
7. All animations behind reduced-motion guard

---

## PHASE 2 — Checkout flow (mocked, swap to real APIs in Phase 4)

1. **`/korpa`** — pregled korpe (built in 1F)
2. **`/checkout/podaci` Step 1: identity choice**
   - Three cards: "Prijavi se", "Registruj se" (with 5% prvi-put copy), "Nastavi kao gost"
   - Social login buttons (Google / Apple / Facebook) + phone OTP
3. **Step 2: podaci za isporuku**
   - Lice toggle: Fizičko / Pravno
   - Fields with * required: ime, prezime, email, telefon (formatted +381 6X XXX XXXX with mask), adresa, grad (autocomplete), poštanski broj
   - "Isporuka na drugu adresu?" checkbox → second address block expands (smooth height animation)
   - When Pravno: extra fields naziv kompanije, PIB
   - Inline validation (Zod), accessible error summary
4. **Step 3: način isporuke**
   - Radio cards: Kurirska služba (price shown), Kamionska isporuka (price shown, hidden if grad not in assembly cities)
   - If kamionska selected: per-item assembly add-on (toggle per cart line, shows price), totals update live
5. **Step 4: vaučer** (collapsible)
   - Input + apply, success/error states
6. **Step 5: način plaćanja**
   - Cards (admin-toggleable): IPS, Platna kartica, Google/Apple Pay, Uplata na račun, Pouzeće (gotovina), Pouzeće karticom
   - Selected card expands with helpful copy
7. **Step 6: napomene + saglasnost**
   - Free-text napomene
   - Required checkbox: "Saglasan sam sa Uslovima kupovine" (linked, opens dialog)
8. **`/checkout/potvrda`** — success
   - Order # (with copy button)
   - Payment-specific block:
     - IPS: QR code (generated client-side from issuer string)
     - Uplata na račun: prefilled uplatnica image + IBAN + poziv na broj
     - Kartica: redirect-to-WSPay placeholder (real in Phase 4)
   - "Šta dalje" timeline (kreirano → priprema → isporuka)
   - CTAs: nastavi kupovinu / pregled naloga
9. **Email preview templates** (built as React components for later Resend rendering): order confirmation, status changes, reclamation receipt, password reset, OTP

---

## PHASE 3 — Backend & data layer

### 3A. Database (Prisma schemas)
1. **Auth/account:** User, Account (NextAuth), Session, VerificationToken, Address, SavedCard (tokenized via WSPay), MarketingConsent
2. **Catalog:** Category (tree), Group, Collection, Product, ProductMedia, Variant (if needed for color), Pictogram, ProductPictogram (M:N), Material, ProductMaterial
3. **Promo:** Banner, PromoBar, Tab, Action, HeroOfMonth, Voucher, AdFlag, RecommendationRule (per group)
4. **Stock & supply:** Supplier, SupplierStockSnapshot, SafetyStockRule, ImportRun
5. **Delivery:** DeliveryCity, AssemblyAvailability, DeliveryPriceRule (kurir / kamion / montaža per item or category)
6. **Orders:** Order, OrderItem (with assembly flag), OrderStatusEvent, Payment, Shipment, ShipmentEvent, Invoice, FiscalReceipt
7. **Service:** Reclamation, ReclamationPhoto, ReclamationStatusEvent, Comment, NewsletterSubscriber, ViberAudienceQuery, ViberCampaign
8. **Wishlist & alerts:** WishlistItem, BackInStockAlert, OnSaleAlert
9. **Admin:** AdminUser, Role, AuditLog
10. Indexes on slug, sku, category path, search vectors (Postgres `tsvector` for name/description)

### 3B. Auth (NextAuth)
1. Providers: Google, Apple, Facebook, Email magic link, Phone OTP (custom credentials provider w/ SMS gateway)
2. Session: JWT, "Zapamti me" extends to 90 days
3. Role guards: middleware for `/admin`, `/nalog`
4. GDPR: consent tracking, data export, account deletion job

### 3C. Server APIs (route handlers + server actions)
1. Catalog reads (categories, products, search) — replace mock JSON loaders
2. Cart sync (logged-in users persist cart server-side)
3. Checkout: create order, reserve stock with supplier, apply discounts, create payment intent
4. Account: profile, addresses, saved cards, orders list/detail, wishlist, alerts
5. Reclamations: create, list (own), upload photos (presigned URL), status updates
6. Comments form submit
7. Newsletter subscribe
8. Search suggest endpoint (uses Postgres FTS or Meilisearch — start FTS)

### 3D. Pricing & promotion engine
1. Effective price = min(salePrice, base − vouchers, − first-purchase 5%, − saved-card 5%)
2. Stack rules: discounts not stackable beyond X% (admin)
3. Period validation: action expired → revert to fullPrice
4. Hero/badge derivation centralized (single source of truth)

### 3E. Account area pages (full real impl)
- `/nalog` dashboard (welcome, recent order, alerts)
- `/nalog/profil` (editable details, language)
- `/nalog/adrese` (CRUD)
- `/nalog/kartice` (saved cards via WSPay tokenization, +5% badge)
- `/nalog/porudzbine` (history with filters; click → detail with status timeline)
- `/nalog/lista-zelja` (with on-sale + back-in-stock toggles)
- `/nalog/reklamacije` (submitted reclamations, status; auto-hide solved after 10 days)
- `/nalog/obavestenja` (preferences: email / SMS / Viber)

### 3F. Reclamation flow (per spec section 4.1)
1. Click in Servis za kupce → text + saglasnost expander → checkbox enables form
2. Form Step 1: enter fiscal receipt # OR order #
3. Lookup → display receipt date + line items
4. Per item "Reklamiraj ovaj artikal" → opens prefilled customer block (editable) + problem fields
5. Validation: opis ≤ 250 chars, ≤ 5 photos × 5MB each
6. Notification choice: email XOR phone (single)
7. Auto-scroll to first invalid field on submit failure
8. Success: green confirmation, persists until user navigates away or starts another item
9. Send email to `reklamacije@svetpovoljnihcena.rs`, store in DB, generate # = `R-{n}-{orderNo}` where n = times reclaimed for that item
10. Customer sees own reclamations in account; auto-hide 10 days after resolution

---

## PHASE 4 — Integrations

### 4A. XML supplier feed
1. Per-supplier connector (URL + auth + schema mapper)
2. Cron every 15 minutes (Vercel cron or self-hosted scheduler)
3. Pulls: products, prices, actions, hero flags, badges, pictograms, dimensions, materials, delivery rules, stock, incoming stock
4. Diff & upsert; track ImportRun (success/failed records)
5. Auto-disable products when `stock=0 && incomingStock=0` OR below SafetyStockRule
6. Send reservation callback to supplier when order placed
7. Admin dashboard: per-supplier health, last run, per-item stock visibility, manual re-run button

### 4B. WSPay (cards + Apple/Google Pay)
1. Form-post redirect to WSPay form with signed payload
2. Return URL handler validates signature, marks order paid, triggers fiscal receipt + email
3. Webhooks for async statuses (3DS, refunds)
4. Token-storage flow for "saved cards"

### 4C. Couriers (two services: small parcel + bulky)
1. Per-service adapter (create waybill, label PDF, status webhooks)
2. Auto-route: if any item is bulky → bulky service, else small
3. Status webhooks → update OrderStatusEvent → trigger customer email/SMS/Viber

### 4D. Email (Resend or Postmark)
1. Templated React Email components
2. Order confirmation (with invoice PDF + odustajanje PDF attached, BCC predefined)
3. Status change notifications (per spec section 8)
4. Reclamation receipt
5. Account: magic link, password reset, OTP fallback
6. Inbound: `reklamacije@` and `komentar@` mailboxes

### 4E. Viber broadcasts
1. Viber Business Messages integration
2. Audience builder: filter by city + last-purchase date range
3. Campaign composer: text + image + CTA URL
4. Send + delivery report

### 4F. Elektronski fiskalni račun
1. Fiscalization API (Serbian eFiskal provider) integration
2. Trigger after warehouse pickup event (manual mark in admin or courier event)
3. Attach to order, email to customer, store PDF

### 4G. Google Merchant + Meta Catalog
1. Auto-generated product feed endpoint (GMC XML / Meta CSV)
2. Admin checkbox per product to include in paid ads
3. Budget input per channel + push to Google Ads / Meta Ads APIs (or manual export in v1, automated in v1.1)

---

## PHASE 5 — Admin panel (`/admin`)

1. **Auth:** separate AdminUser table, role-based (super, content, ops, ads)
2. **Dashboard:** today's revenue, orders, top products, low-stock alerts, supplier feed health
3. **Banners & PromoBar:** CRUD, drag reorder, schedule (startsAt/endsAt), preview
4. **Tabs & navigation:** edit max-4 tabs, hamburger structure (2–3 levels), drag reorder
5. **Categories:** tree editor (drag & drop)
6. **Products:** browse, search, filter; per-product overrides on top of XML; drag reorder for action sort; toggle hero/new/limited; manage media (cloud paths derived by SKU)
7. **Pictograms:** CRUD with cloud asset
8. **Actions (Akcija/Nedeljna/Heroji):** CRUD with date ranges + assigned products
9. **Delivery rules:** kurir price, kamion price, montaža price — per item/category, per city
10. **Vouchers:** CRUD, type (%/fixed), conditions, usage cap, per-user limit
11. **Payment methods:** toggle each method on/off
12. **Recommendations:** per-group "predlog kupovine" list editor
13. **Orders:** list, filter, detail with status timeline, manual actions (mark fiscalized, refund, cancel)
14. **Reclamations inbox:** list, photos lightbox, status update, message customer
15. **Comments inbox**
16. **Newsletter:** subscriber list, segment, send (or export to ESP)
17. **Viber audience builder & campaign composer**
18. **XML import dashboard:** suppliers, last run, errors, per-SKU snapshot
19. **Ads:** product checkbox grid for GMC/Meta inclusion, budget controls
20. **Reports:** sales by period/category, top SKUs, ad ROAS, reclamation rate
21. **Audit log:** every admin action stored

---

## PHASE 6 — Hardening, performance, launch

1. **SEO**
   - Metadata API per route (title/description/og)
   - Structured data: Organization, WebSite + Sitelinks Search, BreadcrumbList, Product (with Offer, AggregateRating), ItemList for category pages, FAQ on relevant pages
   - Dynamic sitemap.xml + robots.txt
   - Canonical URLs, hreflang only if multilang later
2. **Performance budget**
   - LCP < 2.5s on 4G, INP < 200ms, CLS < 0.1, TBT < 200ms
   - JS initial < 200KB; route-level code splitting; lazy product rails below fold
   - next/image with proper sizes; priority on hero only
   - Edge caching for catalog reads; ISR for listings (60s revalidate)
3. **Image pipeline**
   - Cloud bucket (Cloudinary or R2) with SKU-based paths (auto-pull rule per spec)
   - On-the-fly transforms (width, format webp/avif)
   - blurDataURL generation in import job
4. **Analytics & ads**
   - GA4 + ecommerce events (view_item, add_to_cart, begin_checkout, purchase)
   - Meta Pixel + Conversions API (server-side)
   - TikTok Pixel (per spec social presence)
   - Hotjar/Clarity for UX session insights (consent-gated)
5. **Accessibility (WCAG 2.1 AA)**
   - Keyboard navigable carousels, sheets, dialogs
   - ARIA labels on icon-only buttons
   - Focus traps in dialogs, focus return on close
   - Color contrast checked on action.red/ivory pair
   - Captions for videos
6. **GDPR & legal**
   - Cookie consent banner (granular: necessary / analytics / marketing)
   - Privacy policy page editable in admin
   - Data export & delete in account
   - Saglasnost log for marketing
7. **Security**
   - CSP, HSTS, X-Frame-Options, Referrer-Policy
   - Rate limit auth + checkout endpoints
   - Validate all inputs server-side with Zod
   - Sanitize rich text (admin descriptions)
   - Webhook signature verification (WSPay, couriers)
8. **Observability**
   - Sentry (frontend + backend) with release tracking
   - Structured logging (Pino)
   - Uptime monitoring (BetterStack or UptimeRobot)
   - DB backups daily + PITR
9. **QA & UAT**
   - Playwright E2E: search, add-to-cart, checkout (each payment), reclamation, admin product CRUD
   - Vitest unit on pricing engine + reducers
   - Lighthouse CI gate in PRs
   - Staging environment with anonymized data; client UAT sign-off checklist
10. **Launch**
    - Pre-launch checklist (DNS, SSL, env vars, sitemap submitted, GMC verified, Meta domain verified, fiscal cert installed, test orders on prod with each payment)
    - Soft launch → marketing announcement
    - Post-launch monitoring war room first 72h

---

## RELEVANT FILES (high-traffic targets)

- `src/app/layout.tsx` — providers, fonts, Lenis
- `src/app/(shop)/page.tsx` — home
- `src/app/(shop)/[...slug]/page.tsx` — listings + PDP routing
- `src/components/product/ProductCard.tsx` — premium card
- `src/components/product/ProductGallery.tsx` — PDP gallery
- `src/components/layout/{PromoBar,Header,Footer,MobileNav}.tsx`
- `src/components/cart/{MiniCart,QtyStepper,RecommendModal}.tsx`
- `src/components/checkout/{StepIdentity,StepDelivery,StepShipping,StepPayment,StepConfirm}.tsx`
- `src/lib/pricing.ts` — discount engine
- `src/lib/xml/import.ts` — supplier feed parser
- `src/lib/wspay.ts`, `src/lib/courier/*.ts`, `src/lib/efiskal.ts`, `src/lib/viber.ts`
- `prisma/schema.prisma`
- `src/app/admin/**` — admin panel

## VERIFICATION

1. After Phase 1: clickable demo on Vercel, design review with client (Figma-grade polish without Figma)
2. After Phase 2: full guest checkout flow recorded e2e with mock payment
3. After Phase 3: Playwright suite green; account ops covered
4. After Phase 4: live test orders with WSPay sandbox, courier sandbox, eFiskal sandbox; XML feed sync verified across 24h
5. After Phase 5: admin can run the store without dev intervention
6. After Phase 6: Lighthouse ≥ 95 perf/SEO/best-practices on home + PDP; WCAG audit clean; pen-test light pass

## DECISIONS

- Stack: Next.js 15 + TS + Tailwind + shadcn/ui + Framer Motion + Lenis; Postgres + Prisma + NextAuth
- Premium feel via typography (Fraunces+Inter), warm palette, soft shadows, subtle motion — no heavy WebGL in v1
- Language: Serbian Latin only
- UI-first (Phases 0–2 on JSON mocks) so client signs off look before backend work
- Out of scope v1: AR product viewer, multi-currency, marketplace seller portal, native mobile apps, real-time chat
