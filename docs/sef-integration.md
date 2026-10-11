# SEF fakture i eOtpremnice

ERP → SEF fakture (`/admin/erp/sef`, OPS/SUPER). SEF eFaktura i eOtpremnica su dva odvojena servisa i ključa. Poreklo ključa „sa SEF-a” nije dokaz okruženja: pregled proverava drugi ključ na oba zvanična eOtpremnica API-ja, bez slanja dokumenta. Samo dodavanje ključa ne uključuje automatsko slanje.

## Ulazni računi i zadatak 19

Izabrati period do 31 dan. Svaki dan ide u zaseban background posao, a XML dokumenti u grupe po pet. Pregled pokazuje neuspele i aktivne poslove; ponovno preuzimanje istog SEF ID-a ažurira original umesto dupliranja. Računi se proveravaju prema PIB-u SPC. XML i ugrađeni prilozi dostupni su samo prijavljenom OPS administratoru, bez javnog storage URL-a. Spoljni linkovi iz XML-a ne preuzimaju se automatski.

CSV/XLSX kurirski prilog ide u postojeći pregled zadatka 19 i potvrđeni uvoz, uz proveru da zbir neto troškova odgovara SEF fakturi. PDF se preuzima i koristi za standardni kurirski obrazac; nema izmišljenih redova niti OCR pretpostavki. Preuzimanje ne prihvata/odbija ulazne račune i ne evidentira uplatu — Marko je rekao da uplate idu preko banke. Knjižna odobrenja i fakture drugačijeg UBL tipa zahtevaju zasebnu obradu.

## Fakture za firme

Domaći MP/VP nalozi u RSD, sa PIB-om i adresom, koriste postojeće bruto cene sa PDV-om 20%. Uneti broj fakture i datume, pripremiti nacrt, pregledati kupca i iznose pa potvrditi slanje. SEF validira UBL pre prihvatanja; slanje ide bez CIR registracije. Izvozni promet, drugačije poreske stope, avansne fakture i promet koji već ima fiskalni dokument nisu deo ovog obrasca. Roba rezervisana kod dobavljača prvo mora biti primljena u magacin.

Nacrt ne blokira fiskalizaciju. Potvrđeno slanje zaključava nalog i blokira drugi fiskalni tok uz isti zaključani Order red. Stabilan requestId vezan je za sadržaj; HTTP timeout ili nejasan odgovor prelazi u UNKNOWN, bez automatskog ponavljanja finansijskog upisa. Za oporavak uneti SEF ID sa portala: pre promene statusa proveravaju se originalni XML, broj fakture, oba PIB-a, valuta i iznos.

Predato SEF-u nije isto što i prihvaćeno od kupca. Status se čita sa API-ja; tek stvarno Approved postavlja sefAcceptedAt. Produkcijsko knjiženje lagera ima zaseban marker, idempotentne StockMovement ključeve i transakciju. Ako ne uspe, faktura ostaje poslata i cron/provera statusa ponavljaju samo knjiženje, nikad slanje. Demo fakture ne menjaju lager.

## eOtpremnice

Knjiženje CUSTOMER otpremnice za firmu iz VP naloga dodaje pozadinski posao kada je EOTPREMNICA_AUTO_SEND=true. Mešani nalog koji sadrži drugi kanal se ne šalje automatski. Ručno slanje i provera statusa ostaju na otpremnici. Validator i slanje koriste zaseban eOtpremnica ključ i zvanični API, multipart RequestId/File.

SUBMITTED znači da je zahtev predat; CONFIRMED se postavlja tek na DocumentRequest.Succeeded iz changes API-ja. UNKNOWN/SENDING zahtev se proverava, ne šalje ponovo. REMOTE_ERROR zahteva pregled na portalu. Cron proverava aktivne zahteve i izlazne fakture; ne izdaje nove fakture.

## Konfiguracija i puštanje

- SEF_ENABLED=true, SEF_ENV=production (ili demo), SEF_PRODUCTION_ACCEPTED=true za produkciju, SEF_API_KEY. SEF_BASE_URL je opciona korenska adresa; podrazumevano https://efaktura.mfin.gov.rs ili https://demoefaktura.mfin.gov.rs.
- SEF_INBOX_SYNC_ENABLED=true uključuje satno preuzimanje današnjeg i jučerašnjeg perioda. CRON_SECRET ili SEF_CRON_SECRET štiti /api/cron/sef. Postojeći background worker obrađuje red.
- EOTPREMNICA_ENABLED=true, EOTPREMNICA_ENV=production (ili sandbox), EOTPREMNICA_PRODUCTION_ACCEPTED=true, EOTPREMNICA_API_KEY. EOTPREMNICA_BASE_URL je opciono https://api.eotpremnica.mfin.gov.rs ili https://api.demoeotpremnica.mfin.gov.rs. EOTPREMNICA_AUTO_SEND=true uključuje VP automatiku tek kada je okruženje potvrđeno.
- Migracija 20261011200000_sef_documents je aditivna, čuva privatni XML i snapshot rezervacija. Dodaje RLS i ukida anon/authenticated grantove. Produkcijski build koristi postojeći db:deploy sa db:harden; ručni Prisma CLI takođe mora biti praćen harden korakom.
- Rollback automatike: EOTPREMNICA_AUTO_SEND=false i SEF_INBOX_SYNC_ENABLED=false + redeploy. Poslati dokumenti i UNKNOWN zahtevi ostaju sačuvani za proveru. Ne brisati tabelu ili ključeve idempotencije.

## Zvanični ugovori

- https://efaktura.mfin.gov.rs/swagger/public_v1/swagger.json
- https://efaktura.gov.rs/extfile/en/5376/API%20dokumentacija%2030.04.2026.pdf
- https://www.eotpremnica.efaktura.gov.rs/tekst/6571/api-korisnici-najcesce-postavljana-pitanja.php

Lokalne provere pokrivaju UBL, iznose, privatnost migracije, SEF oblik odgovora, jednokratne upise i nejasan ishod, paginaciju eOtpremnica i ponavljanje knjiženja lagera. Pravi finansijski dokument nije testni zahtev.
