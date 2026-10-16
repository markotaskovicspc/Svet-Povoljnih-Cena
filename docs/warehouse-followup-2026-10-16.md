# Provera Markovih prijava — 16.10.2026.

## Popravke

- Završetak MyGLS pickinga knjiži nalog kroz postojeću potvrdu `PrintLabels`, uključujući oporavak već kreiranih adresnica bez novog kurirskog zahteva.
- Jedno dugme priprema adresnice i otvara PDF u istom prozoru, uključujući Safari bez dozvoljenih iskačućih prozora. Završeni picking ima jedan link za PDF.
- Kurirski obračun razlikuje neuvezenu uplatu od stvarnog manjka. Za stare GLS pošiljke koristi tačno povezane sačuvane težine i raspodelu pouzeća po paketima; nema procene po današnjem katalogu.

## Provera podataka

- PRE-2026-0081 potvrđen kao BOOKED u produkciji; četiri postojeća GLS paketa 9002892678–9002892681 ostala su ista.
- AAA0850301420–AAA0850301424 pripadaju SPC-2026-001088. Stare adresnice nisu imale packedQuantity, a PRE-2026-0050 ima pet sačuvanih pakovanja po 2 komada SKU 110087. Zaštićena, evidentirana dopuna nalazi se u scripts/repairs/20261016-return-packing.sql. Svih pet skenova provereno u produkciji; bez prijema robe ili refundacije.
- Za pet redova sa slike nema uvezenih COD uplata. AAA0850301609 nema ni uvezenu specifikaciju troška. Za GLS 9002787296 i 9002796534 postoje sačuvane povezane težine; osnovne procene su 425 i 705 RSD, fakturisani troškovi 489 i 1017 RSD.

## Istorija mejla

- e4b554af, 14.10.2026. 21:01: uvedeni PDF adresnica na magacin@svetpovoljnihcena.rs i dugme „Proveri slanje mejla“.
- 57548066, 15.10.2026. 13:52: uklonjeno samo dugme za proveru, automatski red WAREHOUSE_PICKING_EMAIL ostao aktivan.
- Produkcijska evidencija: PRE-2026-0079 isporučen 15.10; PRE-2026-0081 poslat 16.10. u 12:45, zatim povratna greška sa budo350.adriahost.com (Transient/General, SMTP 5.0.0). Evidencija ne daje precizniji uzrok; zahteva proveru prijemnog mail servera.
- U pregledanoj istoriji nema zasebnog uklonjenog mejla magacinu za povrate. Marko je 16.10. u 14:42 potvrdio da misli na jutarnji posao u 04:00. Taj posao od uvođenja 14.10. priprema naloge bez slanja mejla; dopuna uvodi jutarnji pregled kroz trajni red. Korisnik je potvrdio da je inbox pun i da će ga oni osloboditi.

## Objava i oporavak

Nema migracije šeme ili promene konfiguracije. Za povrat koda koristiti prethodno izdanje d4b05a64. Dopuna količina pet starih paketa je nezavisna od izdanja, sa sačuvanim pre/posle vrednostima u AuditLog; ne ponavljati fizički prijem robe radi provere.
