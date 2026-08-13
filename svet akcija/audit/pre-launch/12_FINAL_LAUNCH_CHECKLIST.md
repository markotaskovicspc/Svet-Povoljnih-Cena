# Final launch checklist

Ovaj checklist je release gate, ne informativna lista. Polje se čekira samo uz link/ID dokaza i ime owner-a. Trenutno stanje: **NO-GO**.

## A. Source, CI i deploy candidate

- [x] Auditovani HEAD `df65e52eac8a63e24daee4cc6336a6207f561898` je 0/0 prema `origin/main`.
- [x] `npm run lint` prolazi.
- [x] `npm run test:unit` prolazi: 122 fajla / 573 testa.
- [x] `npm run build` prolazi.
- [x] `npm audit --omit=dev` prijavljuje 0 ranjivosti.
- [ ] Tačan finalni launch SHA je zamrznut posle P0/P1 popravki.
- [ ] GitHub CI, ne samo Vercel deploy check, zahteva lint/unit/build/selected E2E.
- [ ] Runtime `/api/health` ili `/version` potvrđuje deploy SHA.
- [ ] Dirty/untracked korisničke izmene su svesno uključene ili izostavljene iz launch candidate-a.

## B. Environment, baza i storage

- [ ] Sanitizovana Vercel Production env matrica je pregledana sa owner-om; local `.env` nije korišćen kao zamena.
- [ ] `npm run check:production-env` daje PASS bez greške/placeholder-a.
- [x] Canonical `check:runtime-readiness` koristi DC/supplier availability, rezervacije, safety buffer i freshness; read-only candidate retest daje PASS.
- [ ] Isti readiness PASS je ponovljen unutar stvarnog final deployment env-a, bez ručnog lokalnog flaga.
- [x] 64/64 migracije su completed, 0 pending/failed na audit preseku.
- [x] Sve public tabele imaju RLS; anon/auth grant count je 0.
- [x] PII/operativni bucket-i su private; samo `product-media` je public.
- [ ] Sve finalne migracije su prošle project script + `db:harden` post-proveru.
- [ ] Backup timestamp, restore rehearsal i migration forward-fix/rollback owner su zapisani.

## C. Catalog, cene i availability

- [x] Rabalux dnevni katalog je uspešan: 2.884/2.884.
- [x] Rabalux stock je svež: 2.883/2.883; interval 15 min.
- [x] Realan Rabalux SKU je vidljiv, kupiv i dodat u korpu.
- [ ] Rabalux media backlog je unutar SLO-a; nema tri nedelje starih retry jobova.
- [ ] DC stock je importovan i auditovan pre strict web enforcement-a.
- [x] `ENFORCE_WEB_AUTO_AVAILABILITY` ostaje `false` dok prethodna stavka nije završena.
- [ ] Stale >30 min, reservation i safety-buffer 1 acceptance prolazi.
- [x] Lokalni search kod/unit normalizuje `SMD`/`smd led` prema `SMD-LED` kandidatu.
- [ ] Production search retest posle deploy-a vraća očekivane rezultate.
- [ ] Business je odobrio supplier label „Dostupno kod dobavljača” i rok 5–8 dana.

## D. Checkout, order i calculation

- [x] Cart add/refresh persistence radi u produkcionom browser-u.
- [x] Obavezna checkout polja i prelazi rade do finalnog pregleda.
- [x] Provereni zbir 130 + 299 = 429 RSD je tačan.
- [x] DB integritet: 0 formula/payment/invoice/fiscal mismatch-a i 0 duplicate refs/tracking-a.
- [x] Lokalni payment trust copy odgovara izabranoj metodi; COD unit dokaz ne tvrdi IPS/3DS.
- [ ] Business/production browser je odobrio isti copy posle deploy-a.
- [ ] Double-submit/idempotency i concurrent last-unit test prolaze.
- [ ] Voucher/first-purchase/loyalty/saved-card/assembly/shipping/PDV matrica prolazi.
- [ ] Jedna odobrena produkciona porudžbina je kompletno reconciled.
- [ ] Cancellation/refund/reservation release/fiscal storno tok je dokazan.

## E. Email, payment i fiscal — hard P0

- [ ] **P0:** Resend domen je verifikovan; nema HTTP 403.
- [ ] **P0:** confirmation/reset/order/status/reclamation/newsletter/urgent-alert canary su prihvaćeni i isporučeni.
- [ ] Aktivne launch payment metode imaju po jedan success/fail/cancel scenario.
- [ ] IPS/RaiAccept su ili potpuno production-accepted ili dokazivo sakriveni/isključeni.
- [ ] **P0:** Badi režim, lokacija/kasa i production acceptance su eksplicitni.
- [ ] **P0:** fiskalni SALE + storno/refund + retry/idempotency su dokazani.

## F. Kuriri, supplier i background poslovi

- [x] Lokalni X Express parameter-limit kod koristi jedan parametrizovani array i prolazi 40.000-ID regresiju.
- [ ] Dva puna production/sandbox dictionary cron-a posle deploy-a su SUCCESS.
- [ ] X Express webhook valid/invalid/duplicate/replay matrica prolazi; backlog 0.
- [ ] X Express test account nije slučajno tretiran kao production.
- [ ] MyGLS production canary ili eksplicitno isključena launch putanja je odobrena.
- [x] X Express/MyGLS auto-create ostaje false do provider acceptance-a.
- [ ] Background queue nema stare kritične FAILED/RETRY poslove; password reset/buyer receipt prioritet nije gladovan.
- [ ] Dead-letter, replay i reconciliation postupak je dokumentovan i testiran.

## G. Auth, roles i security

- [x] Anonimni `/admin` i `/nalog` se preusmeravaju na odgovarajuću prijavu.
- [x] Security headers, HTTPS, HSTS i negativna CORS proba prolaze.
- [x] SessionVersion/deleted/disabled backend provere postoje.
- [ ] SUPER/CONTENT/OPS/ADS allow+deny+0-side-effect matrica prolazi na izolovanoj bazi.
- [x] SMS OTP je lokalno uklonjen iz launch UI-a; email/password vodi na stvarnu auth rutu.
- [ ] Production deploy potvrđuje da mrtva OTP kontrola više nije javna.
- [ ] Password reset/email confirmation realno rade posle email popravke.
- [ ] CSP nonce/hash plan je uveden ili je P2 rizik formalno prihvaćen.
- [ ] Upload/import/webhook/IDOR/CSRF negativni testovi prolaze.

## H. UX, accessibility i performance

- [x] Desktop i 390 px ključni tokovi nemaju horizontalni overflow/broken images.
- [x] Home source ima jedan smislen sr-only `h1`; PDP template source ima jednu `h1` definiciju.
- [ ] Production DOM posle deploy-a potvrđuje tačno jedan `h1` na home i PDP.
- [ ] Axe critical/serious = 0 za ključne template-e.
- [ ] Keyboard/focus/escape/zoom/reduced-motion matrica prolazi.
- [x] Newsletter default cross-browser testovi su 8/8 PASS i forma je inertna pre hydration-a.
- [ ] Dogovoreni Lighthouse/CWV i HTML/JS/image budžeti prolaze na mobile profilu.
- [ ] Support phone i legal/customer copy su poslovno odobreni.

## I. Monitoring, runbook i podrška

- [x] `/api/health` vraća 200 i DB up na preseku.
- [ ] Integration health prikazuje stvarne providere, last-success/fail/age i backlog; nije stale tabela od 18.07.
- [ ] Email/payment/fiscal/courier/Rabalux/job alert canary je primljen preko nezavisnog kanala.
- [ ] Dashboard i pragovi za prvih 60 min / 4 h / 24 h su spremni.
- [ ] Release commander i svi provider/business owner-i su imenovani.
- [ ] Incident, stop-launch i rollback tabletop je završen.
- [ ] Safe availability rollback (`false` + redeploy) je dokumentovan i dostupan dežurnom timu.
- [ ] Customer support ima skripte za email failure, payment pending, kurirsku adresu, fiskal i reklamaciju.

## Konačni potpis

- [ ] Tech lead: svi hard tehnički gate-ovi PASS.
- [ ] DB/security owner: podaci, migracije, RLS/storage i restore odobreni.
- [ ] Payment/fiscal/logistics owner-i: realni provider canary-i odobreni.
- [ ] Business owner: cene, popusti, availability, payment/delivery/support copy odobreni.
- [ ] Release commander: rollback/on-call/monitoring aktivni.
- [ ] Konačna odluka promenjena iz **NO-GO** u dokumentovani **GO**.
