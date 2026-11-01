# Transport u spcAPP nabavnim porudžbenicama

`GET /api/partners/v1/spcapp/purchase-orders` zadržava postojeća polja,
autorizaciju, filtere i paginaciju. Svaka stavka dodatno sadrži:

```json
{
  "transportCost": 6000,
  "transportCurrency": "USD",
  "transportExchangeRate": "102"
}
```

`transportCost` je broj u valuti `transportCurrency` (`RSD`, `USD` ili `EUR`),
iz ERP polja `freightCost` i `freightCurrency`. `transportExchangeRate` je string
iz `freightExchangeRate`, odnosno kurs porudžbenice ako transportni kurs nedostaje.
Za RSD vraća se `"1"`. Nulti transport vraća se kao broj `0`.

ERP trenutno ne evidentira iznose, datume i statuse transportnih i avansnih
plaćanja po porudžbenici, pa se opciono polje `payments` izostavlja.
Trošak transporta nije dokaz plaćanja. Kada se evidencija plaćanja uvede,
`payments.transport` i `payments.advance` treba da sadrže stvarni iznos u RSD,
datum `YYYY-MM-DD` i boolean `paid`.

Za postojeće porudžbenice spcAPP treba ponovo da pročita sve stranice relevantnog
perioda i ažurira podatke po ID-u; ne postoji inkrementalni `updatedSince` filter.
