# HTTP and browser baseline — production

> Ovo je produkcioni pre-deploy baseline. Lokalni search/heading/payment-copy fix-evi zahtevaju novi produkcioni retest posle deploy-a.

Base URL: `https://www.svetpovoljnihcena.rs`

## HTTP

- Home 200, cache HIT, približno 806.342 byte HTML-a.
- `/api/health` 200, `ok=true`, `database=up`, auditovani latency sample 28 ms, `no-store`.
- HTTP→HTTPS 308; apex HTTPS→www 308.
- `robots.txt` blokira admin/api/checkout/account/cart; sitemap postoji.
- Security: CSP, HSTS 63.072.000 s, COOP, Permissions-Policy, strict referrer, nosniff, frame DENY.
- CSP `script-src` i `style-src` sadrže `unsafe-inline`.
- Evil-origin GET/OPTIONS probe nije dobio ACAO na testiranoj stvarnoj površini.
- Anonimni `/admin` → 307 `/admin/prijava?callbackUrl=%2Fadmin`.
- Anonimni `/nalog` → 307 `/nalog/prijava?callbackUrl=%2Fnalog`.

Timing/size uzorak: home TTFB 0,174 s / total 0,340 s; exact search TTFB 0,973 s / total 1,113 s / ~735 KB; PDP TTFB 0,330 s / total 0,431 s / ~291 KB; cart ~83 KB; products API ~3,7 KB / ~0,466 s.

## Browser

- Desktop 1280×720 i mobile 390×844.
- Home: 242 image elementa, 0 broken; nema h1.
- Search: `SMD` = 0; `SMD-LED` = 35; exact SKU = 1.
- RAB-79196: dostupna supplier roba; PDP ima 2 h1.
- Add-to-cart 130 RSD, toast/badge i refresh persistence rade.
- Checkout nakon adrese: shipping 299, total 429; finalni submit nije izvršen.
- COD finalni pregled i dalje prikazuje IPS/3-D Secure trust copy.
- Mobile home/cart/checkout: nema horizontalnog overflow-a; menu fokus je na close kontroli.
- Console errors/warnings u ovim produkcionim tokovima: 0.

Browser je imao postojeću autentifikovanu SUPER sesiju i `/admin` je prikazao „Kontrolna tabla”. To nije dokaz drugih role niti anonimne zaštite; anonimni dokaz je zaseban curl bez cookie-ja.
