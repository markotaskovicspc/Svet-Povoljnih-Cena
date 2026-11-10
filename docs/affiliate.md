# Affiliate partneri

Admin → Marketing → Affiliate partneri (`/admin/affiliate`). Pristup: SUPER, ADS, OPS ili prilagođeni nalog sa tim modulom. Napravite partnera sa jedinstvenim kodom, npr. `promo-ime`, i prosledite link koji admin prikazuje. Link bilo koje stranice proizvoda može imati `?ref=promo-ime` (ili `&ref=promo-ime` ako već ima query parametre).

## Pravila

- Praćenje počinje tek uz postojeću saglasnost za analitiku. Bez nje nema affiliate kolačića niti pripisivanja prodaje. Ako korisnik napusti odredišnu stranicu pre davanja saglasnosti, dolazak se ne pamti.
- Poslednji aktivni partner ima atribuciju 30 dana. Ponovno otvaranje linka istog partnera tokom tog roka ne povećava broj dolazaka i ne produžava rok. Dolasci predstavljaju praćene atribucione prozore, nisu sirovi klikovi ili jedinstvene osobe.
- Nasumični HttpOnly kolačić sadrži samo ID dolaska. Checkout proverava bazu, rok i aktivnost partnera; ne prihvata affiliate ID iz JSON tela kupca. Veza se čuva u istoj transakciji sa novom porudžbinom. Ponovljeni checkout zadržava prvobitnu vezu postojeće porudžbine.
- Admin prikazuje sve pripisane WEB porudžbine kroz zbirne brojeve i poslednjih 100 kroz tabelu. Podaci kupaca nisu deo ovog pregleda.
- Isporučeno (`ISPORUCENO`) je odvojeno od porudžbina u obradi, otkazanih i vraćenih. Prikazan iznos uključuje dostavu i usluge i ne oduzima naknadne delimične refundacije. Ovo nije provizija ni potvrda naplate.
- Isključivanje partnera zaustavlja nove atribucije; istorija ostaje dostupna. Posle ponovnog uključivanja neistekli kolačići ponovo važe.

## Isporuka i provera

Pripremljena je aditivna migracija `20261110103000_affiliate_partners`. Nije primenjena na produkciju u ovoj izmeni. Koristite postojeći `npm run db:deploy` postupak (uključuje `db:harden`), ili redovan Vercel production build. Obe nove tabele imaju RLS i oduzete privilegije za anon/authenticated već u migraciji.

Provera: `npm run build` i `npx vitest run tests/unit/affiliate.test.ts tests/unit/affiliate-page.test.tsx tests/unit/affiliate-migration.test.ts`.

Na test bazi: napraviti partnera, otvoriti promo link uz saglasnost, ponoviti otvaranje (bez povećanja broja), završiti WEB checkout, proveriti pripisanu porudžbinu i promenu statusa; proveriti da bez saglasnosti i za isključenog partnera nema nove atribucije. Nisu potrebni pravi mejlovi niti plaćanja.

Za vraćanje prethodnog ponašanja vratiti aplikacioni kod; nove nullable kolone i tabele mogu ostati. Ne brisati istoriju atribucije.
