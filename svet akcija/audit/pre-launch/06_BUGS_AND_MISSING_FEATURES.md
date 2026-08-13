# Bugs and missing features

## P0 — launch blocker-i

### P0-01 — Resend domen nije verifikovan; kritični email tokovi ne rade

- **Kategorija:** integracija / komunikacija / autentikacija
- **Opis:** Aplikacija je konfigurisana za Resend, ali produkcioni provider odbija poruke za domen `svetpovoljnihcena.rs` sa HTTP 403.
- **Reprodukcija:** pokrenuti bilo koji realan tok koji šalje email ili pregledati agregat `EmailLog`; poslednji `urgent_admin_alert` pokušaji 11.08. vraćaju `domain is not verified`.
- **Očekivano:** potvrda emaila, reset lozinke, potvrda/status porudžbine, reklamacija, newsletter opt-in i urgentni alarm budu prihvaćeni i isporučeni.
- **Stvarno:** 38 `FAILED`; pogođeno 9 email confirmation, 1 password reset, 5 order confirmation, 7 order status, 1 reclamation receipt, 2 newsletter opt-in i 13 urgent admin alert poruka. Četiri istorijska `SENT` nisu dokaz sadašnjeg Resend rada.
- **Uticaj:** kupac ne može pouzdano da potvrdi nalog/resetuje lozinku/primi ugovornu potvrdu, a operacije ne dobijaju urgentne alarme.
- **Dokaz:** `evidence/db-readonly-audit.json` → `email` i `recentOperationalFailures.emails`.
- **Predlog popravke:** verifikovati domen/DNS u Resend-u, potvrditi FROM adrese, webhook secret i delivery event obradu; kontrolisano ponoviti samo bezbedne/odobrene poruke.
- **Retest:** po jedan jedinstveni canary za svaku kritičnu vrstu; DB `SENT/DELIVERED`, provider accepted, inbox prijem, link/callback funkcionalan, 0 novih 403.

### P0-02 — produkciona fiskalizacija ne prolazi configuration gate

- **Kategorija:** fiskalizacija / env / compliance
- **Opis:** `npm run check:production-env` pada; nedostaju/ne važe `BADI_FISCAL_MODE` i `FISCAL_LOCATION_ID`, dok je auditovani Badi režim sandbox.
- **Reprodukcija:** pokrenuti `npm run check:production-env` iz repo root-a.
- **Očekivano:** exit 0, eksplicitno izabran javni ili VPFR režim, production acceptance i identitet lokacije/kase.
- **Stvarno:** exit 1; dve greške, uz upozorenja za IPS gate, X Express test account, Badi sandbox i support phone.
- **Uticaj:** nema pouzdanog zakonski ispravnog računa/storna i launch može kreirati nefiskalizovanu ili nereconciled prodaju.
- **Dokaz:** command baseline; `src/lib/fiscal/config.ts`; `evidence/db-readonly-audit.json` ima samo 2 istorijska issued i 1 stari placeholder failure.
- **Predlog popravke:** usaglasiti Badi public/VPFR plan sa fiskalnim timom; popuniti tačne env vrednosti; ne koristiti placeholder; obezbediti retry/idempotency/reconciliation.
- **Retest:** env checker PASS; aktuelan training canary, zatim odobren production SALE, REFUND/storno i simulirani transient retry; iznosi i fiskalni identifikatori reconciled.

### P0-03 — nema zatvorenog produkcionog order-to-cash-to-fiscal E2E dokaza

- **Kategorija:** release acceptance / commerce
- **Opis:** Storefront je bezbedno doveden do finalnog pregleda, ali submit nije izvršen jer bi napravio stvarnu porudžbinu i sporedne efekte bez odobrenja. U bazi su sve postojeće porudžbine otkazane.
- **Reprodukcija:** DB agregat: 7 WEB porudžbina = 5 COD + 1 kartica + 1 IPS, sve `OTKAZANO`; payments nema `PAID/AUTHORIZED`, refunds je prazan.
- **Očekivano:** najmanje jedan kontrolisan launch canary prolazi kreiranje, email, payment/COD, supplier/DC rezervaciju, kurira, fiskal, status i odobren cleanup/storno.
- **Stvarno:** nijedan uspešan kompletan lanac nije dokaziv.
- **Uticaj:** najveći poslovni tok može pasti tek posle javnog launch-a; unit/build ne potvrđuju provider i operativne handoff-e.
- **Dokaz:** `evidence/db-readonly-audit.json`; `evidence/production-checkout-final-no-submit.jpg`.
- **Predlog popravke:** poslovno odobriti jednu jasno označenu minimalnu porudžbinu i tačan cleanup/storno plan; pre testa zatvoriti email/fiskal gate.
- **Retest:** trace sa order brojem, audit logom, svim statusima i reconciliation-om; bez siročadi u payment/shipment/fiscal/job tabelama.

## P1 — kritično pre ili neposredno posle P0 gate-a

### P1-01 — X Express master-data cron delimično pada četiri run-a zaredom

- **Lokalni remediation status (11.08):** KOD ISPRAVLJEN / PRODUKCIONI RETEST ČEKA. Masovna deaktivacija ulica više ne generiše prošireni `NOT IN`; koristi statički SQL i jedan parametrizovani `integer[]` uz `ANY`. Regresioni test pokriva 40.000 jedinstvenih ID-jeva.

- **Kategorija:** kurir / background job / baza
- **Opis:** cron uspešno učita 169 i 4.721 location zapisa i 50 statusa, zatim `xExpressStreet.updateMany()` prelazi PostgreSQL parameter limit.
- **Reprodukcija:** pregled `CourierSyncRun` za 29.07, 30.07, 03.08. i 10.08.
- **Očekivano:** svaka faza cron-a završi `SUCCESS`, bez polu-ažuriranog šifarnika.
- **Stvarno:** svaki navedeni run ima završni `FAILED` segment.
- **Uticaj:** adresa/ulica može biti stara ili nedosledna, što vodi odbijenoj pošiljci i manualnom radu.
- **Dokaz:** `evidence/db-readonly-audit.json` → `courierSyncRuns`.
- **Predlog popravke:** implementirani array-parametar deploy-ovati, transakciono označiti faze i napraviti reconciliation count.
- **Retest:** dva uzastopna kompletna dictionary cron-a; nema RUNNING/FAILED segmenta; isti input je idempotentan.

### P1-02 — X Express webhook queue nije reconciled

- **Kategorija:** kurir / webhook
- **Opis:** postoje samo 2 webhook događaja; 1 je neobrađen, 1 failed, poslednji 02.07.
- **Reprodukcija:** DB agregat `xExpressWebhooks`.
- **Očekivano:** signed webhook bude idempotentno procesiran, status mapiran i greška retried/dead-lettered sa alarmom.
- **Stvarno:** nema uspešno obrađenog događaja u uzorku.
- **Uticaj:** statusi pošiljke/porudžbine i kupac mogu ostati zastareli.
- **Dokaz:** `evidence/db-readonly-audit.json`.
- **Predlog popravke:** replay endpoint sa guard-om, signature/duplicate test i reconciliation sa status poll-om.
- **Retest:** valid/invalid/duplicate/out-of-order payload; 1 business update, 0 duplih side-effect-a.

### P1-03 — Rabalux media queue je u dugotrajnom retry storm-u

- **Kategorija:** katalog / background jobs / observability
- **Opis:** `RABALUX_MEDIA_PRODUCT` ima 3.011 `RETRY`, 305 `FAILED`, 5 `QUEUED`; najstariji actionable job je od 21.07. i deo starih grešaka nosi schema mismatch, novije `fetch failed`.
- **Reprodukcija:** DB aggregate i oldest actionable jobs.
- **Očekivano:** transient retry se brzo oporavlja; permanent failure ide u dead-letter i ne troši worker bez kraja.
- **Stvarno:** tri nedelje star backlog i veliki retry obim.
- **Uticaj:** nepotpune slike, worker/DB opterećenje, zaklanjanje novih kritičnih poslova i alarm fatigue.
- **Dokaz:** `evidence/db-readonly-audit.json` → `backgroundJobs`, `oldestActionableJobs`.
- **Predlog popravke:** klasifikovati permanent/transient, zaustaviti/requeue-ovati stare schema greške posle validacije, backoff+jitter, circuit breaker, provider/domain metrike.
- **Retest:** backlog monotono opada, nema actionable job-a starijeg od SLO-a, nova greška ne blokira buyer receipt/password reset queue.

### P1-04 — SMS OTP je ponuđen, ali nije funkcionalno povezan

- **Lokalni remediation status (11.08):** CONTAINED. Mrtva SMS opcija je uklonjena iz launch UI-a; „E-pošta i lozinka” je stvarni link ka login/registration ruti sa checkout callback-om. Secure SMS flow nije implementiran niti se više obećava kupcu.

- **Kategorija:** missing feature / auth / UX
- **Opis:** checkout prikazuje „SMS kod (OTP)”. `issuePhoneOtp()` pravi plaintext code token i Auth credentials provider ume da validira kod, ali nema server action/API koji ga bezbedno pošalje, nema SMS adaptera i dugme samo poziva `onPick()`.
- **Reprodukcija:** otvoriti identity social panel i kliknuti SMS; statički pretražiti pozive `issuePhoneOtp` — nema caller-a van definicije/export-a.
- **Očekivano:** unos telefona → rate-limited send → maskirani rezultat → unos → one-time verify/consume → session.
- **Stvarno:** nema slanja ni forme za kod; kupac ostaje u istom stanju.
- **Uticaj:** javno obećana auth opcija je mrtva i može blokirati checkout korisnika koji je izabere.
- **Dokaz:** `src/components/checkout/identity-step.tsx:259`; `src/lib/auth/credentials.ts:89`; `src/lib/auth/auth.ts:134`.
- **Predlog popravke:** implementirati provider/send action, hashed token, consume/delete, brute-force limit i audit; ili sakriti dugme do završetka.
- **Retest:** send/expiry/wrong/replay/rate-limit/session E2E, bez koda u logovima/response-u.

### P1-05 — checkout trust copy netačno tvrdi IPS i 3-D Secure

- **Lokalni remediation status (11.08):** KOD ISPRAVLJEN / PRODUKCIONI RETEST ČEKA. Poruka se sada bira prema `paymentMethod`; COD gotovina/kartica, uplata na račun, IPS i card/wallet imaju odvojene tvrdnje. Unit regresija potvrđuje da COD ne sadrži IPS/3-D Secure.

- **Kategorija:** checkout / pravna i UX tačnost
- **Opis:** kada je izabran COD, a aktivne metode su samo uplata/COD, finalni pregled i sidebar prikazuju „Sigurna naplata preko IPS i 3-D Secure”.
- **Reprodukcija:** RAB-79196 → cart → guest checkout → COD → finalni pregled.
- **Očekivano:** copy odgovara izabranoj i zaista dostupnoj metodi; COD ne tvrdi online naplatu/3DS.
- **Stvarno:** generička tvrdnja ostaje vidljiva.
- **Uticaj:** kupac dobija materijalno netačnu informaciju o obradi novca i sigurnosnom mehanizmu.
- **Dokaz:** `evidence/production-checkout-final-no-submit.jpg`; produkcioni browser snapshot.
- **Predlog popravke:** mapirati copy po `paymentMethod` i provider capability; ne prikazivati IPS/3DS bez aktivnog provider-a.
- **Retest:** screenshot/assertion za svaku metodu i disabled/gated provider varijantu.

### P1-06 — admin role acceptance je operativno blokiran

- **Kategorija:** permissions / release testing
- **Opis:** Enabled produkcioni admin nalozi postoje samo za SUPER (3). CONTENT je disabled; OPS i ADS nema u enabled agregatu; sva 3 QA `.local` naloga su disabled.
- **Reprodukcija:** DB aggregate `adminRoles` i `qaAdminAccounts`; default `admin-roles.spec.ts` je gate-ovan.
- **Očekivano:** izolovani enabled test nalozi za SUPER/CONTENT/OPS/ADS i success+forbidden matrica svih kritičnih ruta/mutacija.
- **Stvarno:** realan E2E za non-SUPER role nije bezbedno moguć.
- **Uticaj:** permission regresija ili preširok SUPER-only operativni model može ostati neprimećen.
- **Dokaz:** `evidence/db-readonly-audit.json`; Playwright 140 skip rezultata.
- **Predlog popravke:** isolated QA DB + fixture role accounts; pokrenuti postojeći `admin-roles.spec.ts` i mutacione suite-ove.
- **Retest:** svaka rola ima expected allowed/403; svaki denial ostavlja 0 DB/audit side-effect-a.

### P1-07 — runtime readiness proverava pogrešan izvor web dostupnosti

- **Lokalni remediation status (11.08):** ISPRAVLJENO I READ-ONLY RETESTIRANO. Checker sada koristi DC/supplier raspoloživost, approval, rezervacije, prag `>10`, safety buffer `1` i item-level svežinu `30 min`. Sa privremenim `RABALUX_ENABLED=true` daje PASS: 1.617 published, 1.558 checkout-sellable i 1.080 launch-spremnih artikala; 669 bez dimenzija ostaje vidljiv stvarni dug.

- **Kategorija:** observability / release gate
- **Opis:** script traži `Product.stock > 0` i zaključuje da nema kupivog proizvoda, dok storefront validno kupuje svež Rabalux supplier stock po novoj availability politici.
- **Pre-fix reprodukcija:** `npm run check:runtime-readiness` → 0 purchasable; produkcioni browser uspešno dodaje RAB-79196.
- **Očekivano:** checker koristi isti `web availability` engine/policy kao checkout i odvojeno izveštava DC vs supplier box.
- **Stvarno:** false-negative readiness gate i 669 proizvoda bez dimenzija u istom izveštaju.
- **Uticaj:** tim može ignorisati crven checker kao „poznato netačan”, pa propustiti stvaran kvar.
- **Dokaz:** runtime command output; `evidence/production-cart-after-add.jpg`; `src/lib/web-storefront-availability.ts`.
- **Predlog popravke:** implementirano u checker-u; pre launch-a ga pokrenuti u stvarnom candidate deployment env-u, ne sa lokalnom pretpostavkom flaga.
- **Retest:** checker PASS za svež supplier SKU, FAIL kad observation pređe 30 min, zaseban DC import gate.

### P1-08 — support phone nije konfigurisan

- **Kategorija:** environment / customer support / legal UX
- **Opis:** production-env checker upozorava da javni support phone nedostaje.
- **Reprodukcija:** `npm run check:production-env`.
- **Očekivano:** dosledan support kontakt na footer/legal/checkout/order/reclamation površinama.
- **Stvarno:** returns/warehouse vrednosti postoje, ali globalni public support telefon nije potvrđen.
- **Uticaj:** kupac nema jasan operativni kontakt u kritičnom trenutku.
- **Dokaz:** env checker; `src/lib/merchant.ts`.
- **Predlog popravke:** potvrditi poslovni broj, postaviti env i pregledati sve renderovane lokacije.
- **Retest:** server render i email template matrica prikazuje isti broj.

## P2 — važno, nije samostalni launch blocker

### P2-01 — delimična pretraga ne normalizuje crticu

- **Lokalni remediation status (11.08):** KOD + UNIT PASS / PRODUKCIONI RETEST ČEKA. Query normalizuje punctuation i poredi alfanumerički oblik naziva, pa `SMD` može da kandiduje `SMD-LED`.

- **Reprodukcija:** `/pretraga?q=SMD` → 0; `q=SMD-LED` → 35; exact SKU → 1.
- **Očekivano:** korisnički prefiks/token bez crtice nalazi `SMD-LED`.
- **Stvarno:** relevantni proizvodi nestaju za prirodan upit.
- **Uticaj:** niža konverzija i utisak praznog kataloga.
- **Dokaz:** `evidence/production-full-search-smd.jpg` i browser rezultati.
- **Predlog:** normalizacija punctuation/token/prefix ili trigram/full-text strategija sa limitima.
- **Retest:** SMD, smd led, SMD-LED, dijakritika, SKU, typo i zero-result matrica.

### P2-02 — neispravna hijerarhija naslova

- **Lokalni remediation status (11.08):** HOME ISPRAVLJEN / PDP PRODUKCIONI RETEST ČEKA. Home dobija jedan opisni sr-only `h1`; statička inspekcija PDP template-a nalazi tačno jednu `h1` definiciju, pa ranija produkciona duplikacija nije bezbedno „popravljena” naslepo.

- **Opis/stvarno:** home nema `h1`; testirani PDP ima 2 `h1`.
- **Očekivano:** tačno jedan opisni `h1` po stranici, logičan h2/h3 sled.
- **Uticaj:** accessibility navigacija i SEO semantika.
- **Dokaz:** produkcioni DOM desktop/mobile i `evidence/production-pdp-available.jpg`.
- **Predlog/retest:** ispraviti template i dodati axe/DOM assertion za ključne rute.

### P2-03 — default newsletter E2E otkriva pre-hydration submit rupu

- **Lokalni remediation status (11.08):** ISPRAVLJENO I RETESTIRANO. Forma je inertna do hydration-a preko SSR-safe `useSyncExternalStore`; Playwright čeka enabled stanje. Dodatno je uklonjen dev-only CSP kvar koji je u WebKit-u pretvarao `http://127.0.0.1` assete u HTTPS zbog produkcionog URL-a u `.env.local`. Podrazumevani run sada daje 8 PASS / 140 namerno SKIP.

- **Kategorija:** progressive enhancement / test reliability
- **Opis:** form ima samo React `onSubmit`. Playwright na `domcontentloaded` može da popuni i pritisne Enter pre stabilne hydration; browser tada uradi native GET `/kontakt?`, API mock ne vidi zahtev.
- **Reprodukcija:** `npm run test:e2e`: success test timeout na sva 4 projekta; failure test pada na desktop/mobile/webkit, prolazi Firefox.
- **Očekivano:** submit pre i posle hydration ili bezbedno radi, ili kontrola nije interaktivna dok handler nije spreman.
- **Pre-fix stvarno:** 7 FAIL / 1 PASS; UI može izgubiti vrednost/zaobići očekivani fetch u uskom race prozoru.
- **Uticaj:** flaky CI i mogući izgubljen brzi submit na sporom uređaju.
- **Dokaz:** `test-results/**/trace.zip` i error-context; `src/components/layout/newsletter-band.tsx`.
- **Predlog:** progressive-enhancement server action/action endpoint ili hydration-ready disable/queue; test treba čekati stabilan handler bez maskiranja realnog race-a.
- **Retest:** cold dev/prod bundle, 4 browser projekta, throttled CPU/network; 8/8 PASS.

### P2-04 — veliki HTML payload i search TTFB

- **Stvarno:** približno 806 KB home, 735 KB search i 291 KB PDP HTML; search TTFB oko 0,97 s u jednom uzorku; home ima 242 slike.
- **Očekivano:** definisan payload/CWV budžet i ograničen SSR payload.
- **Uticaj:** sporiji parse/hydration/mobilni data cost i veći pre-hydration race.
- **Dokaz:** curl timing/size baseline i production browser.
- **Predlog:** paginacija/streaming, manje RSC/SSR podataka, kritični media budget, Lighthouse CI.
- **Retest:** ponovljen median/p95 i Lighthouse na launch hardware profilu.

### P2-05 — CSP i dalje koristi `unsafe-inline`

- **Stvarno:** `script-src` i `style-src` uključuju `'unsafe-inline'`.
- **Očekivano:** nonce/hash politika gde Next/runtime dozvoljava.
- **Uticaj:** slabija odbrana od XSS-a iako ostali header-i rade.
- **Dokaz:** produkcioni response headers.
- **Predlog/retest:** postepeno nonce/hash u report-only pa enforced; proveriti GTM/Next hydration bez regresije.

### P2-06 — `IntegrationHealth` daje lažno zastarelu sliku

- **Stvarno:** šest `NOT_CONFIGURED` redova, `checkedAt=null`, update 18.07; nedostaju aktivni Rabalux/Resend/MyGLS/Badi tokovi.
- **Očekivano:** last checked/success/failure, latency, backlog i mode za svaki launch provider.
- **Uticaj:** admin status ekran može sugerisati pogrešan prioritet i usporiti incident response.
- **Dokaz:** `evidence/db-readonly-audit.json`.
- **Predlog/retest:** izvedeni health iz stvarnih log/job tabela + stale alarm; simulirati provider fail i recovery.

## Specification conflict

- Stariji dokument je pominjao 5% popusta za prvu kupovinu.
- Noviji commit `78e0700` opisuje potvrđena client-launch pravila i implementira 15%; produkcioni UI prikazuje 15%.
- Zaključak: **nije bug**, ali zahtev/source-of-truth dokumentaciju treba konsolidovati kako se 5% ne vrati u kasnijoj „ispravci”.
