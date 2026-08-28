# Implementacija zahteva iz klijentskog videa

Radna grana: `codex/client-video-erp-fixes`  
Worktree: `/Users/luka/svet povoljnih cena/svet akcija/.worktrees/client-video-erp-fixes`

| # | Zahtev | Status | Implementacija i provera |
|---:|---|---|---|
| 1 | Kapacitet 40-ft kontejnera 71 m³ | Urađeno | Migracija `0067_client_video_receiving_and_capacity`; migracija proverena od nule u izolovanom E2E okruženju. |
| 2 | Prekoračenje je upozorenje, ne blokada | Urađeno | Uklonjena serverska blokada; detalji porudžbenice i fakture traže potvrdu kada je kapacitet prekoračen. |
| 3 | Prioritetna formula `69 / količina za ceo kontejner` | Urađeno | `calculateUnitLogistics`; unit testovi formule prošli. |
| 4 | Rezervna formula iz dimenzija pojedinačnog pakovanja | Urađeno | Koriste se `unitPackWidthCm × unitPackDepthCm × unitPackHeightCm`; unit testovi prošli. |
| 5 | Komада na paleti у секцији појединачног паковања | Urađeno | Polje ostaje u traženoj sekciji matičnih podataka artikla. |
| 6 | Obavezan jedan od dva izvora zapremine | Urađeno | Validacija na formi, grid izmeni i Excel uvozu; otvorene porudžbenice se preračunavaju posle izmene. |
| 7 | `Proknjiži/Proknjižena` umesto `Zaključaj/Zaključana` | Urađeno | Izmenjene komande, statusi, poruke, tabele i detalji fakture; E2E potvrđuje prikaz i akciju. |
| 8 | Magacin se bira na ulaznoj fakturi | Urađeno | Novi `InboundInvoice.warehouseId`, obavezna aktivna vrednost na fakturi; polje uklonjeno sa porudžbenice. |
| 9 | Jedan klik završava porudžbenicu, fakturu i prijem | Urađeno | `postInboundInvoice` automatski knjiži oba dokumenta i prima robu; idempotent retry i stanje zaliha provereni E2E testom. |
| 10 | Posle knjiženja menja samo Super admin | Delimično — čeka odluku | Redovne izmene i storniranje proknjiženog dokumenta su blokirani. Nije nagađano kako Super admin promena magacina treba da utiče na već knjiženu zalihu. |
| 11 | `SP` se uvek objavljuje; ostali samo uz količinu | Urađeno | Izmenjeni storefront upit, runtime provera i blocker poruke; unit testovi prošli. |
| 12 | Numerički operator `veće od`, npr. `Fizičko > 0` | Urađeno/provereno | Operator `gt` je izložen u padajućem meniju; query unit test i browser E2E provera prošli. |
| 13 | Zamrznuto zaglavlje ERP tabele | Urađeno | Scroll kontejner i sticky `thead`; E2E proverava sticky klasu. |
| 14 | Bez stalnog desnog panela, tabela pune širine | Urađeno | Stari desni blok je uklonjen iz komponente, a raspored tabele proširen. |
| 15 | Kolone, Pogledi i Napomene u gornjem meniju | Urađeno | Novi meni `Prikaz tabele`; E2E otvara meni i proverava sve tri celine. |

## Završne provere

- `npm run test:unit`: 135 test fajlova, 636/636 testova prošlo.
- Ciljani ESLint svih izmenjenih TS/TSX/test fajlova: prošao bez izlaza.
- `npm run build`: Next.js 16.2.11 production build prošao, uključujući Prisma generate, TypeScript i 83/83 statičke strane.
- `npm run test:e2e:inbound-invoices:isolated`: 69 migracija primenjeno na novu privremenu Supabase šemu; desktop acceptance test prošao; privremena šema obrisana.

## Otvoreno pitanje bez nagađanja

Kada Super admin promeni magacin na već proknjiženoj ulaznoj fakturi, da li sistem treba automatski da prebaci već primljenu količinu iz starog u novi magacin (kontrolisani storno + novi robni prijem), ili magacin mora ostati nepromenljiv i za Super admina?
