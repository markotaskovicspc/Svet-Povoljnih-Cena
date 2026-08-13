# Performance, UX and accessibility

## Produkcioni browser presek

Testirani su desktop `1280×720` i mobile `390×844`: home, search, PDP, add-to-cart, cart persistence, checkout validacije i finalni pregled bez submit-a, mobile menu i route protection. Nije primećen horizontalni overflow na home/cart/checkout, sve 242 home slike su imale uspešan load i browser console nije prijavila error/warning.

## Performance

Jednokratni HTTP uzorak (nije zamena za p50/p75/p95/RUM):

| Ruta | Status | TTFB | Total | HTML |
|---|---:|---:|---:|---:|
| `/` | 200 | ~0,174 s | ~0,340 s | ~806 KB |
| `/pretraga?q=SMD-LED` | 200 | ~0,973 s | ~1,113 s | ~735 KB |
| testirani PDP | 200 | ~0,330 s | ~0,431 s | ~291 KB |
| `/korpa` | 200 | — | — | ~83 KB |
| `/api/products` uzorak | 200 | ~0,466 s | — | ~3,7 KB |

Ocena: **PARTIAL / P2**, sa P1 potencijalom na slabim mobilnim uređajima. Home/search server HTML je prevelik i home inicijalno ima 242 slike. Lokalni newsletter hydration/CSP kvar je zatvoren sa 8/8 browser testa, ali production performance budget nije ponovljen. Build/dev browser je dodatno prijavio da je `/logo.svg` LCP kandidat bez eager/high priority učitavanja.

Preporuka:

- postaviti HTML/JS/image request i CWV budžete u CI;
- smanjiti broj inicijalnih proizvoda/rail-ova i serializovane RSC podatke;
- paginacija/streaming/virtualization za search/listing;
- eksplicitno prioritetizovati stvarni above-the-fold LCP element, ostalo lazy;
- meriti production Lighthouse najmanje 3 puta i pratiti RUM p75 LCP/INP/CLS po desktop/mobile;
- testirati cold cache, spor 4G, 4× CPU i Rabalux/API degradaciju.

## UX nalazi

| Nalaz | Status | Prioritet |
|---|---|---|
| Add-to-cart, toast, badge i refresh persistence | PASS | — |
| Checkout obavezna polja i koraci do finalnog pregleda | PASS | — |
| Mobile bez horizontalnog overflow-a na ključnim tokovima | PASS | — |
| Mobile menu fokus ide na close kontrolu | PASS | — |
| `SMD` ne nalazi `SMD-LED` | LOCAL FIX / PROD RETEST | P2 |
| COD ekran tvrdi IPS/3DS | LOCAL FIX / PROD RETEST | P1 |
| SMS OTP mrtva kontrola | LOCAL CONTAINED / PROD RETEST | P1 |
| Pre adrese mobile summary pokazuje 990 RSD, posle adrese 299 RSD bez snažnog objašnjenja procene | PARTIAL | P2 |
| Newsletter form pre hydration može native GET submit | LOCAL PASS 8/8 | P2 |
| Finalna porudžbina/success/error/retry nije izvršena | BLOCKED | P0 gate |

## Accessibility

Pozitivno:

- Forme imaju vidljive/ARIA error poruke na auditovanim checkout koracima.
- Mobile menu kao dialog prima fokus na close.
- Fokus stilovi su prisutni u mnogim ključnim kontrolama.
- Image load je uspešan u uzorku.

Nedostaci:

- home source sada ima jedan sr-only `h1`; production retest čeka deploy;
- PDP template source ima jednu `h1` definiciju; raniji production DOM sa dve čeka retest;
- nije izvršen axe/WCAG automated scan za svih 101 ruta;
- nije izvršena kompletna keyboard-only/focus order/focus trap/escape matrica;
- nisu mereni contrast i screen-reader name/description za svih 1.566 statičkih kontrola;
- motion/reduced-motion i zoom 200–400% acceptance nisu dokazani.

Status je zato **PARTIAL**, ne PASS. Minimalni launch smoke: axe za reprezentativne template-e; bez critical/serious violation-a; Tab/Shift+Tab/Enter/Space/Escape checkout/menu/dialog; 200% zoom bez gubitka sadržaja; heading/landmark/name assertions.

## Responsive matrica

| Viewport/površina | Dokaz | Status |
|---|---|---|
| 1280×720 home/search/PDP/cart/checkout | screenshot + interaction | PASS/PARTIAL |
| 390×844 home/cart/checkout/menu | screenshot + overflow check | PASS/PARTIAL |
| Tablet landscape/portrait | build/CSS only | PARTIAL |
| 320 px narrow mobile | nije direktno testirano | BLOCKED — vreme/scope, nema posebnog dokaza |
| Firefox/WebKit storefront | newsletter default suite 8/8 kroz sva 4 projekta; ostale suite gated | PASS/PARTIAL |

## Evidence

Screenshot-i su u `evidence/production-*.jpg`; posebno home desktop/mobile, search, PDP, cart posle add/refresh i checkout final-no-submit. Playwright traces za newsletter ostaju u repo `test-results/`; sažetak je prenet u test matricu i bugs dokument.
