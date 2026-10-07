# Automatsko evidentiranje uplata na račun

Pripremljena integracija obrađuje Erste dinarske PDF izvode dostavljene na
`podrska@svetpovoljnihcena.rs`. Aktiviranje zahteva proverenu adresu pošiljaoca,
proveru autentičnog mejla i objavu ERP API-ja i chatbot servisa.

## Tok

1. Postojeći IMAP IDLE kolektor prepoznaje tačnu adresu banke iz
   `BANK_STATEMENT_SENDERS` (adrese razdvojene zarezima).
2. Proverava stvarni DKIM potpis celog mejla i usklađen domen. Ne veruje
   prepisanom `Authentication-Results` zaglavlju. Nepotpisan, prosleđen ili
   izmenjen mejl ide na proveru, ne menja plaćanje.
3. Lokalno čita tekst i pozicije u PDF-u, bez slanja izvoda AI modelu.
   Prihvata isključivo račun firme, PIB, RSD i poznati Erste raspored.
   Proverava ukupni zbir priliva i izdvaja samo kolonu „U korist“,
   SPC broj iz PBO i bankarsku referencu FT. Drugi prilivi i svi odlivi
   se ne povezuju sa porudžbinama.
   Broj `SPC2026001370` normalizuje u `SPC-2026-001370`. Isti broj ponovljen
   u PBO/PBZ poljima predstavlja jednu porudžbinu; različiti SPC brojevi,
   SPC broj samo u PBZ ili više FT referenci i dalje zaustavljaju obradu.
4. Potpisanim zahtevom dostavlja samo podatke izabrane uplate na
   `/api/integrations/bank-statements`. PDF, ime uplatioca i ostale
   transakcije ne šalje ERP API-ju ni dodatnim servisima.
5. Trajna BackgroundJob stavka identifikuje uplatu po računu i FT referenci.
   Zaključavanje reference i porudžbine sprečava paralelno duplo knjiženje.
6. Automatski se evidentira samo puna uplata koja tačno odgovara totalu
   postojeće porudžbine sa metodom `UPLATA_NA_RACUN`. Status plaćanja postaje
   PAID; KREIRANO prelazi u POTVRDJENO. Datum je datum izvoda (podne UTC,
   bez tvrdnje o tačnom vremenu transakcije). Upis i slanje potvrde kroz
   outbox zakazuju se u istoj transakciji.
7. ERP šalje kupcu potvrdu i kopiju podršci. Ako kupac nema mejl,
   potvrda ide samo podršci. Potvrda uplate je automatska; postojeći
   nacrti odgovora kupcima i dalje zahtevaju zaposlenog da ih pošalje.

Razlika iznosa, delimična/prevelika uplata, već plaćena/refundirana,
otkazana/vraćena ili nepostojeća porudžbina ne menja status: podrška dobija
jasan razlog, iznos, broj porudžbine, izvod i referencu. Kupcu se ne
šalje lažna potvrda. Ova verzija ne sabira više delimičnih uplata.
Greška PDF-a/potpisa šalje zasebno obaveštenje podršci.

## Puštanje

- Objaviti ERP kod pre chatbot koda, proveriti API kroz `--check`.
- U Railway `spc-chatbot` postaviti `BANK_STATEMENT_SENDERS` na adresu
  iz stvarnog bankarskog mejla i `BANK_STATEMENTS_ENABLED=true`.
- IMAP lozinka i postojeći SOCIAL_INTEGRATION_SECRET ostaju postojeće tajne.
- Proveriti potpis i jedan pravi prilog pre aktiviranja. Ne uklanjati DKIM
  proveru da bi prosleđeni izvod prošao; njega ručno proveriti.
- Kolektor obrađuje nove mejlove; stare ne uvozi automatski. Dati izvod se
  može eksplicitno uvesti CLI-jem posle provere porudžbine.
- BackgroundJob/EmailMessage outbox omogućavaju ponovne pokušaje nakon
  prekida. Ponovljeno dostavljanje istog FT broja ne pravi novu uplatu.
- Ulazni izvod ostaje u `bank_pending` dok ERP ne prihvati zapis; prekid
  mreže ga ne napušta posle tri pokušaja. Dalji pokušaji su na pet minuta.
- Isključivanje: `BANK_STATEMENTS_ENABLED=false` za nove ulazne mejlove.
  Već zakazane ERP stavke ostaju u outboxu za završetak.

## Ručna provera priloga

Iz `services/chatbot`:

```powershell
node scripts/bank-statement.mjs 'putanja/do/izvoda.pdf'
node --env-file=.env.local scripts/bank-statement.mjs 'putanja/do/izvoda.pdf' --check
```

Prva komanda samo čita PDF; druga proverava u ERP-u bez upisa i mejlova.
`--apply` se koristi isključivo za eksplicitno odobren unos proverenog izvoda.

## Ograničenja

Obrada podržava dati tekstualni Erste PDF raspored. Skenovi, drugi bankarski
formati, nepodudaranje zbira i promenjen raspored idu na proveru. Samo
evidentira status plaćanja porudžbine; nije zamena za računovodstveno knjiženje
glavne knjige. Originalni bankarski prilog ostaje u IMAP sandučetu.
