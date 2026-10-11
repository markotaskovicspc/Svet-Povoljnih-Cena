# Kurirski obračun (zadatak 19)

ERP → Kurirski obračun, OPS/SUPER. Izabrati kurira, broj dokumenta i datum pa originalni GLS XLSX ili standardni CSV/XLSX. Pregled prikazuje broj i zbir stavki i povezivanje pre potvrde. Nepovezane stavke ostaju vidljive i mogu se povezati tačnim brojem pošiljke tog kurira. Višeznačne stavke blokiraju uvoz. Ponovljeni identičan dokument (čak i drugim imenom) ne duplira stavke, a promenjen dokument istog broja se odbija. Oba upisa imaju administrativni audit.

## Potvrđena poslovna pravila

Markove WhatsApp poruke 11.10.2026: povrat u jednom smeru, težina poslata kuriru, potvrda uplata iz specifikacije. Trošak se priznaje na prvi završni događaj (uručenje ili povrat), u jednom smeru. Kasniji povrat već uručene pošiljke ne pravi drugi osnovni trošak i ne briše prvobitni period. Osnovna procena je transport + pouzeće iz potpisanih GLS i X Express cenovnika; razlika je prema toj osnovi, nije automatski proglašena greškom kurira. Gorivo, dodatne usluge, osiguranje i prekomerne dimenzije zahtevaju posebne podatke za punu procenu. Uvek je vidljiv fakturisani stvarni trošak.

GLS težina se čuva iz stvarnog `ParcelPropertyList.Weight` u odgovoru naloga (poseban snapshot). X Express već čuva `Packages.Mass`. Istorijski nalog bez snapshot-a ne dobija izmišljenu težinu iz današnjeg kataloga. Ponovno umanjenje API težine nije dozvoljeno.

`courierPaidAt` se postavlja tek kada tačna suma uplaćenog pouzeća odgovara sumi svih aktivnih grupa porudžbine i nijedan očekivani iznos nije nepoznat. Delimična uplata, manjak i višak ostaju za kontrolu. Vraćena pošiljka nema očekivano pouzeće. Nalozi reklamacionog povrata i obrisane etikete se izuzimaju.

## Izvori i formati

Privatni dokumenti se ne čuvaju u Git-u. Sačuvani su u Codex-Media/svetpovoljnihcena/zadatak-19.

- GLS.pdf: potpisana ponuda 29.05.2026. Granice težine su doslovno `<2`, `<3`, itd. do `<40` kg. Cene zavise od broja paketa na istom odredištu. Pouzeće +50 RSD neto.
- X Express Prilog 1, 03.06.2026: 240/300/450/700/800 RSD neto za 5/10/20/30/50 kg; preko 50 kg dodatno 40,50 po započetom kg, pouzeće +50.
- Prvobitni GLS COD Excel i Payment Notice su uplate kupaca, a ne fakturisani trošak.
- Novi GLS mejl sadrži originalnu mesečnu fakturu i SettlementDocument troškova. Ukupni iznos prvog lista uključuje transport, gorivo, usluge i doplate. Drugi list razlaže već uračunate usluge/doplate i ne sabira se ponovo.

GLS XLSX export sa `x:` XML prefiksom se normalizuje u memoriji jer ga ExcelJS direktno ne prepoznaje. Original nije izmenjen. Brojevi paketa i reference povezuju naloge. Klijentski nastavak `-P1`/`-P2` se uklanja samo iz reference porudžbine. Ukupan iznos GLS troška je bez PDV-a. Eventualni nezavisni bankarski/kartični redovi se odbijaju sa zahtevom za standardni obrazac umesto da se prećute.

GLS COD import zahteva datum uplate; ne zamenjuje ga datumom dostave. GLS trošak zahteva obračunski datum (npr. 30.09.2026). Zbirni period koristi taj datum. Fiskalizovana dostava koristi ISSUED fiskalne stavke DOSTAVA i datum računa; refundacije umanjuju zbir. Stari FiscalReceipt bez fiskalnih stavki se broji kao nedostajući izvor, bez izmišljanja iznosa dostave iz sadašnje porudžbine. Porudžbine bez jedinstvenog kurira prikazane su kao neraspoređene, bez dupliranja među kuririma.

X Express original je zasad slika; Marko potvrđuje da XLSX nema, a PDF dobija na SEF-u. Podržan je standardni obrazac; direktna SEF integracija i automatski OCR nisu deo ovog uvoza. Nema automatskog uvoza iz privatnog mejla niti menjanja stvarnih podataka pri testovima.

## Provere i puštanje

Unit testovi pokrivaju tarifne granice, PDV, referencu/broj paketa, dupliranje, GLS namespace/breakdown, delimičnu/tačnu/nepoznatu uplatu. Dodatna lokalna provera originalnog XLSX (`COURIER_SOURCE_XLSX`) potvrđuje sve stavke i iznos fakture. Migracija proverena na privremenom PGlite-u. `npm run build` je obavezan.

Migracija dodaje CourierStatement i CourierStatementLine, sa RLS i bez API grantova. Pri puštanju koristiti postojeći db:deploy koji završava sa db:harden. Produkcija nije menjana samim lokalnim razvojem/testom.
