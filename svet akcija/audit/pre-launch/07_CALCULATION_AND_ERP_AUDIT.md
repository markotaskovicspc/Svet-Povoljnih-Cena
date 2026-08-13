# Calculation and ERP audit

## Zaključak

Matematički integritet postojećih zapisa je dobar: šest read-only DB provera daju nula odstupanja ili duplikata. Međutim, baza je veoma mali i uglavnom otkazan uzorak (7 porudžbina), pa to nije dokaz da su svi popusti, PDV, refund i ERP lifecycle scenariji launch-ready. ERP je funkcionalno širok, ali realna non-SUPER role/mutation acceptance je BLOCKED bez izolovane QA baze.

## Canonical formula porudžbine

Kod i DB semantika potvrđuju:

```text
total = subtotal
      + shipping
      + assemblyTotal
      - voucherDiscount
      - firstPurchaseDiscount
      - savedCardDiscount
```

`subtotal` je već efektivni zbir stavki posle item-level cene/popusta. `savings` je informativna ukupna ušteda i **ne oduzima se ponovo**. Prva audit formula je zato ispravljena pre zaključka; završna provera koristi canonical checkout semantiku.

## Provereni primer iz produkcionog browser-a

| Element | Iznos |
|---|---:|
| RAB-79196 | 130 RSD |
| Dostava nakon izabrane adrese | 299 RSD |
| Ukupno | 429 RSD |

`130 + 299 = 429`; finalni checkout pregled se slaže sa korpom. Submit nije izvršen.

## DB integrity provere

| Provera | Rezultat |
|---|---:|
| `Order.total` vs canonical formula | 0 mismatch |
| PAID/AUTHORIZED payment amount vs order total | 0 mismatch |
| Aktivni invoice total vs order total | 0 mismatch |
| ISSUED SALE fiscal gross vs order total | 0 mismatch |
| Dupli payment provider reference | 0 |
| Dupli shipment tracking number | 0 |

Ograničenje: `payments` nema uspešan `PAID/AUTHORIZED` uzorak, `refunds` je prazan, pa nula mismatch-a u tim granama znači da nema kontradikcije, ne da je pozitivan tok dokazan.

## Cene, popusti i PDV

| Tema | Dokaz | Status | Rizik / obavezni scenario |
|---|---|---|---|
| Item/subtotal/total formula | code + DB query + browser primer | PASS | Dodati rounding fixture za više količina |
| 15% prva kupovina | noviji confirmed-client commit + UI | PASS kao specifikacija | Zaštititi source-of-truth od starog 5% dokumenta |
| Loyalty 30% | trenutna globalna rule/UI poruka | PARTIAL | Nema realnog order persistence dokaza |
| Voucher | formula i unit kod | PARTIAL | success/expired/limit/concurrency, stacking sa first/saved-card |
| Saved-card discount | formula/kod | PARTIAL | Provider kartice nije aktivan; nema realnog payment dokaza |
| Assembly | formula/kod | PARTIAL | per-item/quantity/PDV/export/fiscal scenario nije izveden |
| Dostava | browser 299 nakon adrese; 990 pre adrese na fresh mobile identity | PARTIAL | UI treba jasno da označi procenu pre adrese; puna zone/težina matrica |
| PDV | invoice/fiscal modeli i unit pokrivenost | PARTIAL | Multi-rate, rounding, discount allocation i storno acceptance |
| Refund/storno | modeli/kod postoje | BLOCKED | `Refund` tabela nema podatke; realan provider/fiscal chain nije testiran |

## Lager i rezervacije

Platforma ima dva različita izvora raspoloživosti:

- **DC lager:** uvozi se CSV/XLSX i može ručno da se koriguje.
- **Rabalux dobavljač:** stanje se veruje 30 minuta, umanjuje se za rezervacije i safety buffer 1; kupac ne vidi tačnu količinu, već supplier dostupnost i 5–8 dana.

Rabalux stock sync je svež i kupiv SKU je dokazan. Lokalni remediation `check:runtime-readiness` sada koristi isti DC/supplier model: approval, item-level svežinu 30 min, rezervacije i safety buffer 1. Read-only proba sa candidate Rabalux flagom daje 1.080 launch-spremnih supplier SKU-ova. Istovremeno je 669 proizvoda bez dimenzija, što ostaje stvaran rizik za kurirski obračun/ERP master data i više nije prikriveno false-negative-om.

## ERP moduli i persistence status

| Modul | Implementacija | Dokaz ovog audita | Status |
|---|---|---|---|
| Artikli/master data | detaljan CRUD, import, status/channel/stock polja | build + unit + statički inventar | PARTIAL |
| Dobavljači | CRUD, integracioni identitet, concurrent numbering test u gated suite-u | build/unit; Rabalux realan runtime | PARTIAL |
| Nabavne cene | CRUD/import/export i E2E suite | gated, nije pokrenut bez izolovane DB | BLOCKED |
| Narudžbenice | create/post/export/send | gated E2E | BLOCKED |
| Ulazni računi | edit/open/lock/receive/COGS | gated E2E | BLOCKED |
| Prodajne porudžbine | WEB/VP/INO pregled i ručni CRUD | build/unit; sve produkcione WEB otkazane | PARTIAL |
| Cenovnici/akcije | pricing engine i admin modul | unit; gated browser | PARTIAL |
| Magacini/DC import | warehouse/stock/reservation/movement | runtime 3 active warehouses; gated write E2E | PARTIAL |
| Otpremnice/popisi/transferi | CRUD, knjiženje, PDF/XLSX, inventory movements | build/unit; eOtpremnica provider blocked | PARTIAL |
| Pickup/kurir | batch, shipment/label/status | X/MyGLS runtime delimičan | FAIL/PARTIAL |
| Fakture/fiskal | invoice/fiscal dokumenti i retry | DB formula PASS; production fiscal blocked | FAIL |
| Reklamacije | intake/status/analytics/uploads | private storage policy PASS; email receipt broken | FAIL/PARTIAL |
| Newsletter | audience/campaign/consent | lokalni browser default 8/8; realan email i dalje broken | FAIL/PARTIAL |
| Izveštaji/analitika | admin metrike/export/GA4 | build/unit; live GA proof nema | PARTIAL |

## Idempotency i race-condition fokus

Pozitivno:

- Checkout ponovo proverava server-side cenu/dostupnost i transakcijski kreira poslovne zapise.
- Payment callback unit testovi i provider reference unique provera postoje; DB nema duplicate refs.
- E2E safety helper odbija mutacione suite-ove bez eksplicitne QA/test baze i dodatne potvrde za remote DB.

Otvoreno:

- Nije izvršen paralelni double-submit finalnog checkout-a.
- Nije izvršen dupli/out-of-order IPS/RaiAccept callback na realnom sandbox-u.
- Nije dokazan supplier reservation conflict i release posle otkazivanja/isteka.
- X Express webhook replay nije uspešan u produkcionom uzorku.
- Fiskalni retry/idempotency nema aktuelan production acceptance.

## Obavezna calculation acceptance matrica

Pre launch odluke izvršiti najmanje: 1/više količina; RSD rounding; jedna i više PDV stopa; voucher success/expired/limit; first-purchase sa/bez eligibility; loyalty/saved-card; assembly; free/paid/zone shipping; stale supplier stock; concurrent last-unit; COD/uplata; cancel pre/posle rezervacije; partial/full refund; fiscal sale/storno; invoice/fiscal/email iznosi identični UI/DB-u.
