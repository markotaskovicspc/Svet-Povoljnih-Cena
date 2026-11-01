# Grad isporuke kupcu

`GET /api/partners/v1/spcapp/orders` dodatno vraća `deliveryCity` za svaku
porudžbinu, na primer `"deliveryCity": "Kragujevac"`.

Izvor je `Order.shipCity`: grad sačuvan u adresi isporuke konkretne porudžbine.
Ne koristi se grad za fakturisanje niti trenutni profil kupca. Ulice, kućni
brojevi i kontakt podaci se ne dodaju u izvoz.

Postojeća polja, autorizacija, filteri i paginacija ostaju isti. Migracija baze
nije potrebna. Za stare porudžbine ponovo pročitati sve stranice odgovarajućeg
perioda i ažurirati podatke po ID-u; `updatedSince` nije podržan.
