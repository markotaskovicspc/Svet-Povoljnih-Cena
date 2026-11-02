# Grad isporuke kupcu

`GET /api/partners/v1/spcapp/orders` dodatno vraća `deliveryCity` za svaku
porudžbinu, na primer `"deliveryCity": "Kragujevac"`.

Izvor je `Order.shipCity`: grad sačuvan u adresi isporuke konkretne porudžbine.
Ne koristi se grad za fakturisanje niti trenutni profil kupca. Ulice, kućni
brojevi i kontakt podaci se ne dodaju u izvoz.

Postojeća polja, autorizacija, filteri i paginacija ostaju isti. Migracija baze
nije potrebna. Za stare porudžbine ponovo pročitati sve stranice odgovarajućeg
perioda i ažurirati podatke po ID-u; `updatedSince` nije podržan.

`GET /api/partners/v1/spcapp/ananas-orders` takođe uvek sadrži `deliveryCity`,
ali sa vrednošću `null` i `dataQuality.deliveryCity: "NOT_CAPTURED"`.
Ananas uvoz trenutno čuva samo adresu za fakturisanje; njen grad se ne predstavlja
kao mesto isporuke. Za stvarnu vrednost potrebno je proširiti uvoz podacima
o adresi isporuke iz Ananasa.

## Ananas adresa za fakturisanje

`ananas-orders` vraća i `billingAddress` (sačuvanu adresu za fakturisanje) i
`billingCity` (njen grad), na primer:

```json
{
  "billingAddress": { "city": "Kragujevac", "postcode": "34000", "streetName": "Test ulica", "streetNumber": "12" },
  "billingCity": "Kragujevac",
  "deliveryCity": null
}
```

Adresa sadrži samo postojeća polja `firstName`, `lastName`, `buyerName`, `buyerId`,
`buyerType`, `city`, `postcode`, `streetName` i `streetNumber`, kada su sačuvana.
Nepoznata JSON polja se izostavljaju. Bez adrese (uključujući FBA zapise uvezene
samo iz pošiljki) `billingAddress` i `billingCity` su `null`.
Ovo su podaci za fakturisanje, a ne potvrđena adresa isporuke. Dostupni su i za
stare porudžbine pri sledećem kompletnom čitanju odgovarajućeg perioda.

## PIB kupca sa porudžbine

`orders` i `ananas-orders` vraćaju i `pib` kao string, na primer
`"pib": "123456789"`. Bez evidentiranog PIB-a vraća se `null`.

SPC koristi sačuvani poslovni identitet porudžbine (`shipPib`/`billPib`), isti
izbor poslovne adrese kao dokumenti: zasebna poslovna adresa za fakturisanje
ima prednost kada je potpuna; u suprotnom koristi se postojeći poslovni
identitet prema pravilima ERP-a. Ne čita se trenutni profil kupca.

Ananas koristi `billingAddress.buyerId` samo kada je `buyerType` jednak `TIN`.
Drugi tipovi identifikatora se ne predstavljaju kao PIB. Vrednost ostaje string
da bi se sačuvale vodeće nule. Postojeće porudžbine dobijaju polje pri ponovnom
čitanju API-ja, bez migracije baze.
