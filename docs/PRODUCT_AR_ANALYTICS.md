# 3D i AR: test korišćenja

Aktivan proizvod: X DESK (`100010-9ce68e`), postojeći model v3. CUBE nema 3D/AR.

Na fotografiji je dugme „Pogledaj iz svih uglova · 3D”. U modelu su „Nazad na fotografije”, strelice galerije i prikaz preko celog ekrana. Ispod galerije je zaseban AR poziv. AR direktno koristi Scene Viewer na Androidu ili Quick Look/USDZ na iPhone-u; desktop prikazuje QR link za `/ar/[slug]`.

## Merenje

Admin → Analitika → **3D i AR**, ili `/admin/erp/3d-ar`. Dostupno ulozi ADS i SUPER.

- Prikaz kontrola: najmanje 50% kontrole u vidljivom delu aktivne stranice.
- Otvorili 3D: model učitan u aktiviranoj galeriji. Priprema modela u pozadini se ne broji.
- Koristili 3D: korisnička rotacija/zumiranje, bez programskih pomeranja kamere.
- AR klik: klik na zasebno dugme; na desktopu sledi QR, na telefonu pokušaj native AR-a.
- QR prikazan i QR otvoren telefonom su zasebni događaji.
- AR pokušaj: pozvan native link. Nije potvrda otvaranja kamere ili postavljanja predmeta — Scene Viewer/Quick Look ne pružaju tu potvrdu sajtu.
- Jedinstveni pregledači sa saglasnošću za analitiku; ista osoba na dva uređaja može biti prebrojana dvaput. Nema prenosa identiteta kroz QR.
- Korpa i poručivanje: isti proizvod/pregledač, do 30 dana nakon prikaza AR dugmeta. Poručivanje je završen checkout, ne potvrđena naplata; može obuhvatiti kasnije otkazanu porudžbinu.
- Kartica „Poručili posle korišćenja” koristi početak prve 3D interakcije ili AR pokušaja. Korelacija korišćenja i kupovine ne dokazuje uzročnost.

A/B eksperiment `ar-copy-v1`: A „Vidi u svojoj sobi”, B „Proveri kako se uklapa”. Nasumična 50/50 dodela ostaje u pregledaču uz analitičku saglasnost. Bez saglasnosti prikazuje se A bez praćenja i čuvanja eksperimenta. QR prenosi varijantu i UTM kontekst bez identifikatora posetioca. Izveštaj grupiše prvi kontekst proizvoda/pregledača u izabranom periodu. U poređenje konverzije ulaze i posetioci koji su videli dugme, a nisu ga koristili.

## Linkovi za oglase

Primer (zameniti vrednosti nazivima stvarne kampanje i oglasa):

`https://www.svetpovoljnihcena.rs/p/100010-9ce68e?utm_source=facebook&utm_medium=paid_social&utm_campaign=x_desk_ar&utm_content=video_01`

Svaki oglas treba svoj `utm_content`; isti oglas šalje posetioce u obe varijante. Ne stavljati lične podatke u UTM oznake. Ne proglašavati pobednika na osnovu nekoliko klikova; porediti stope uz broj izloženih pregledača, uređaj i kampanju, a za konačne porudžbine sačekati prozor pripisivanja.

## Provera

- `npx vitest run tests/unit/product-ar-analytics.test.ts tests/unit/product-ar.test.ts tests/unit/product-ar-manifest.test.ts tests/unit/tracking-consent.test.ts tests/unit/reports-hub.test.ts`
- Izolovani SQL test: `MYGLS_E2E_RUNNER=vitest MYGLS_E2E_SCHEMA_MODE=sql MYGLS_E2E_SPECS=tests/integration/product-ar-report.integration.test.ts node scripts/run-mygls-acceptance.mjs` (privremena šema, briše se po završetku).
- Browser testovi: `product-ar-analytics`, `product-ar`, `product-ar-touch`, `product-ar-warmup`, `product-ar-freshness`, `ar-launcher`, `x-desk-ar`. Analitički testovi presreću POST zahteve i ne pune stvarnu analitiku.
- `VERCEL_ENV=development npm run build`.

Migracija dodaje samo enum `PRODUCT_AR`; događaji koriste postojeću tabelu i rok čuvanja 13 meseci. Produkcioni build primenjuje migraciju i postojeći `db:harden`. Nema novih javnih tabela ili storage bucket-a. Fizička AR proba nije simulirana browser testovima.

## Rezultat provere — 12.09.2026.

Završni lokalni build je prošao van produkcionog režima. Prošla su 23 unit testa, 2 SQL testa u izolovanoj šemi i 53 browser scenarija na desktop i mobilnom Chromium-u; 5 scenarija preskače neodgovarajući uređaj. Jedan desktop test proizvoda bez modela je prvi put istekao čekajući navigaciju, zatim prošao bez izmene koda. Test prikaza preko celog ekrana čeka završetak animacije pre merenja dimenzija. Za stvarno postavljanje u sobu i podršku konkretnog telefona i dalje je potrebna fizička proba.
