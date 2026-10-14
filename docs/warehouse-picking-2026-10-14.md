# Magacin: dopune pickinga

Zahtevi iz klijentovog dokumenta `Document (1).docx` i tri ugrađene slike:

- Kamera odmah skenira po otvaranju. Ispravan barkod se prihvata jednom, pogrešan se odbija i kamera nastavlja da traži. Kamera ne upisuje količinu; radnik je potvrđuje.
- Magacinski prikaz nudi preostalu traženu količinu, dugmad −/+ i unos nule. Potvrda nule ostaje u istoriji. Potvrda manje količine prelazi na sledeći nepotvrđen artikal, a manjak ostaje vidljiv u završnom pregledu.
- Kada su sve stavke proverene, manjak se prijavljuje dugmetom „Prijavi manje količine“. Izveštaj sadrži broj pickinga, šifre, potrebne/odvojene/nedostajuće količine i povezane brojeve porudžbina. Kod zajedničkog SKU ne dodeljuje manjak proizvoljno jednom kupcu.
- Kada su sve količine odvojene, pojavljuje se „Štampaj adresnice“. Radnik potvrđuje da su paketi spakovani i mere tačne; postojeće provere mera, uplata i kurirskih ograničenja ostaju. Postojeće adresnice se ponovo koriste pri ponavljanju. X Express adresnice se pripremaju bez najave preuzimanja; MyGLS kreiranje adresnice šalje podatke o pošiljci u njihov sistem, kao i ranije.
- PDF adresnica ide kao privatni prilog na `magacin@svetpovoljnihcena.rs`; manjak na `podrska@svetpovoljnihcena.rs`. Poruke koriste trajni red poslova i postojeći email tracking. U slučaju privremene greške posao se ponavlja; identična prijava ne pravi novi posao. Slanje iz reda može potrajati do sledećeg pokretanja postojećeg workera (svakih pet minuta).
- Povrati koriste isti modal sa kamerom. Sken samo pronalazi paket, bez automatskog prijema ili promene lagera.
- Pretraga je uklonjena iz pojednostavljenog spiska naloga za magacionera, kao na precrtanoj slici; ostaje u ERP-u.

## Automatska priprema

`/api/cron/warehouse-picking` je zakazan na `0 2,3 * * *` UTC. Provera `Europe/Belgrade` dozvoljava rad samo u lokalnom satu 04:00, i leti i zimi. Endpoint zahteva `CRON_SECRET` ili poseban `PICKING_CRON_SECRET`.

Za MYGLS i X_EXPRESS redom koristi postojeće `createPickupBatch` / `loadEligibleOrders`: otvoreni izmenjivi draft se ponovo koristi, novi podobni paketi dopunjavaju nalog, a postojeće zaključavanje kolekcije sprečava duple pakete. Koristi aktivnog OPS/SUPER administratora za postojeću evidenciju događaja. Ne kreira adresnice, ne najavljuje kurirsko preuzimanje i ne šalje robu u 04:00. Ostaju postojeće provere kanala, magacina, rezervacija, uplata, otkazanih i već obrađenih porudžbina.

Postojeća zaštita napretka se zadržava: promena sadržaja naloga menja planHash i traži novu fizičku proveru robe; promene picking pozicija same po sebi ne poništavaju napredak.

## Provere

Jedinični testovi pokrivaju količine, nulu, prijavu manjka, identične zahteve, zaključavanje naloga, izmenjen plan, privatni PDF prilog, greške email transporta, cron autorizaciju i letnje/zimsko vreme. Postojeći testovi podobnosti naloga, grupisanja i adresnica ostaju.

Lokalna Playwright provera stvarnih React komponenti sa simuliranim kamerom i server akcijama obuhvata automatsko skeniranje, odbijanje pogrešnog koda, unos nule, preostalu količinu, prikaz manjka/adresnica i modal povrata na telefonu. Testovi ne šalju stvarne mejlove, ne kreiraju kurirske pošiljke i ne menjaju poslovne podatke. Nije testirano fizičko očitavanje na telefonu ili slanje stvarnog PDF-a primaocima.

Nema novih Prisma migracija.
